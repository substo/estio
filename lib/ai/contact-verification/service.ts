import { GoogleGenerativeAI } from "@google/generative-ai";
import db from "@/lib/db";
import { calculateRunCost } from "@/lib/ai/pricing";
import { securelyRecordAiUsage } from "@/lib/ai/usage-metering";
import { resolveLocationGoogleAiApiKey } from "@/lib/ai/location-google-key";
import { settingsService } from "@/lib/settings/service";
import { SETTINGS_DOMAINS } from "@/lib/settings/constants";
import { normalizeContactProfileVerificationConfig } from "@/lib/ai/contact-profile-verification/config";
import {
  buildCanonicalContactName,
  extractPropertyRefsFromLeadText,
  hasContactPersonNameNoise,
  inferLeadContactRoleFromSignals,
  normalizeWhitespace,
  parseContactPersonNameFromDisplayName,
  type InferredLeadContactRole,
} from "@/lib/contacts/name-builder";
import {
  profileVerificationFields,
  withProfileVerificationInvalidation,
} from "@/lib/contacts/profile-verification";

type AnyRecord = Record<string, any>;

const CONTACT_VERIFICATION_MODEL = "contact-profile-name-agent-v1";
const CONTACT_VERIFICATION_PROVIDER = "deterministic";
const CONTACT_VERIFICATION_AI_PROVIDER = "google_gemini";

const CONTACT_TYPES = new Set([
  "Lead",
  "Agent",
  "Partner",
  "Owner",
  "Associate",
  "Maintenance",
  "Contact",
  "Tenant",
  "WhatsAppGroup",
]);
const LEAD_GOALS = new Set(["To Buy", "To Rent", "To List", "Other"]);
const NON_LEAD_CONTACT_TYPES = new Set(["Owner", "Agent", "Partner", "Associate", "Maintenance"]);
const VERIFICATION_FIELDS = [
  "contactType",
  "leadGoal",
  "name",
  "firstName",
  "lastName",
  "qualificationStage",
  "requirementSummary",
] as const;
const NULLABLE_FIELDS = new Set(["leadGoal", "name", "firstName", "lastName", "qualificationStage", "requirementSummary"]);
const AUTO_APPLY_CONFIDENCE_THRESHOLD = 0.75;

export type ContactVerificationStatus =
  | "verified_lead"
  | "needs_review"
  | "likely_agent"
  | "likely_owner"
  | "not_a_lead";

export type ContactVerificationPatch = Partial<Record<typeof VERIFICATION_FIELDS[number], string | null>>;

type ContactVerificationAssessment = ReturnType<typeof buildContactVerificationAssessment>;

type ContactVerificationRunMetadata = {
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  fallbackReason?: string | null;
};

function normalizeText(value: unknown, max = 4000): string | null {
  const normalized = String(value || "").trim();
  return normalized ? normalized.slice(0, max) : null;
}

function extractJsonObject(text: string): any {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("Empty AI response.");
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("AI response did not contain JSON.");
    return JSON.parse(match[0]);
  }
}

function logContactVerificationTiming(event: string, fields: Record<string, unknown> = {}) {
  console.info("[AI Contact Verification Timing]", JSON.stringify({
    event,
    ts: new Date().toISOString(),
    ...fields,
  }));
}

function normalizeContactType(value: unknown): string | null {
  const text = normalizeWhitespace(String(value || ""));
  return CONTACT_TYPES.has(text) ? text : null;
}

function normalizeLeadGoal(value: unknown): string | null {
  if (value == null) return null;
  const text = normalizeWhitespace(String(value || ""));
  return LEAD_GOALS.has(text) ? text : null;
}

export function normalizeContactVerificationPatch(raw: unknown): ContactVerificationPatch {
  const patch: ContactVerificationPatch = {};
  if (!raw || typeof raw !== "object") return patch;

  for (const field of VERIFICATION_FIELDS) {
    if (!(field in raw)) continue;
    const value = (raw as AnyRecord)[field];
    if (value == null) {
      if (NULLABLE_FIELDS.has(field)) patch[field] = null;
      continue;
    }
    if (field === "contactType") {
      const normalized = normalizeContactType(value);
      if (normalized) patch.contactType = normalized;
      continue;
    }
    if (field === "leadGoal") {
      patch.leadGoal = normalizeLeadGoal(value);
      continue;
    }
    const text = normalizeText(value, field === "requirementSummary" ? 8000 : 300);
    if (text) patch[field] = text;
  }

  return patch;
}

function normalizedValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  if (value == null) return null;
  return String(value).trim();
}

export function getContactVerificationPatchChanges(snapshot: AnyRecord, patch: ContactVerificationPatch) {
  return Object.entries(patch).flatMap(([field, next]) => {
    const oldValue = normalizedValue(snapshot[field]);
    const newValue = normalizedValue(next);
    if (oldValue === newValue) return [];
    return [{ field, old: oldValue, new: newValue }];
  });
}

export function preserveStructuredLeadDisplayNamePatch(args: {
  contact: AnyRecord;
  patch: ContactVerificationPatch;
  inferredRole?: string | null;
}): ContactVerificationPatch {
  if (!("name" in args.patch)) return args.patch;
  const currentName = normalizeWhitespace(args.contact.name);
  const proposedName = normalizeWhitespace(args.patch.name);
  if (!currentName || !proposedName) return args.patch;

  const nextContactType = normalizeContactType(args.patch.contactType) || normalizeContactType(args.inferredRole) || normalizeContactType(args.contact.contactType);
  if (nextContactType !== "Lead") return args.patch;
  if (!hasContactPersonNameNoise(currentName)) return args.patch;

  const parsed = parseContactPersonNameFromDisplayName(currentName);
  if (!parsed.fullName || parsed.fullName !== proposedName) return args.patch;

  const { name: _name, ...rest } = args.patch;
  return rest;
}

function getContactVerificationSnapshot(contact: AnyRecord) {
  return {
    contactType: contact.contactType || null,
    leadGoal: contact.leadGoal || null,
    name: contact.name || null,
    firstName: contact.firstName || null,
    lastName: contact.lastName || null,
    qualificationStage: contact.qualificationStage || null,
    requirementSummary: contact.requirementSummary || null,
  };
}

function verificationStatusForPatch(patch: ContactVerificationPatch, inferredRole: string, contact: AnyRecord): ContactVerificationStatus {
  const role = patch.contactType || inferredRole;
  if (role === "Agent") return "likely_agent";
  if (role === "Owner") return "likely_owner";
  if (patch.qualificationStage === "not_a_lead") return "not_a_lead";
  if ((patch.contactType || contact.contactType) === "Lead" && ["To Buy", "To Rent"].includes(String(patch.leadGoal || contact.leadGoal || ""))) {
    return "verified_lead";
  }
  return "needs_review";
}

function normalizeContactVerificationStatus(value: unknown): ContactVerificationStatus | null {
  const status = String(value || "").trim();
  return [
    "verified_lead",
    "needs_review",
    "likely_agent",
    "likely_owner",
    "not_a_lead",
  ].includes(status) ? status as ContactVerificationStatus : null;
}

function normalizeInferredLeadContactRole(value: unknown): InferredLeadContactRole | null {
  const role = String(value || "").trim();
  return role === "Lead" || role === "Owner" || role === "Agent"
    ? role
    : null;
}

function normalizeEvidenceItems(value: unknown): AnyRecord[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const source = item as AnyRecord;
    const quote = normalizeText(source.quote, 800);
    const field = normalizeText(source.field, 120);
    if (!quote || !field) return [];
    return [{
      sourceId: normalizeText(source.sourceId, 120) || `ai_evidence_${index + 1}`,
      field,
      quote,
    }];
  });
}

function leadGoalProfileLabel(goal: unknown): string {
  if (goal === "To Buy") return "buyer";
  if (goal === "To Rent") return "renter";
  return "buyer/renter";
}

function buildRoleEvidenceText(args: {
  contact: AnyRecord;
  messages: Array<{ body?: string | null }>;
}) {
  return [
    args.contact.message,
    args.contact.notes,
    args.contact.requirementOtherDetails,
    args.contact.requirementSummary,
    ...args.messages.map((message) => message.body),
  ].map((item) => String(item || "").trim()).filter(Boolean).join("\n");
}

function inferLeadGoalFromText(args: {
  contact: AnyRecord;
  evidenceText: string;
}): { goal: "To Buy" | "To Rent" | null; ambiguous: boolean; reason: string | null } {
  const currentGoal = normalizeLeadGoal(args.contact.leadGoal);
  if (currentGoal === "To Buy" || currentGoal === "To Rent") {
    return { goal: currentGoal, ambiguous: false, reason: null };
  }

  const requirementStatus = String(args.contact.requirementStatus || "").toLowerCase();
  const combined = [
    args.contact.leadGoal,
    args.contact.requirementStatus,
    args.contact.requirementSummary,
    args.contact.requirementOtherDetails,
    args.evidenceText,
  ].map((item) => String(item || "")).join("\n").toLowerCase();

  const buyIntent = /\b(buy|buyer|buying|purchase|purchasing|for sale|sale)\b/.test(combined);
  const rentIntent = /\b(rent|renter|renting|rental|for rent|lease|leasing)\b/.test(combined);

  if (buyIntent && rentIntent) {
    if (/\brent\b/.test(requirementStatus)) {
      return { goal: "To Rent", ambiguous: false, reason: "Requirement status resolves mixed buy/rent evidence to rent." };
    }
    if (/\b(sale|buy)\b/.test(requirementStatus)) {
      return { goal: "To Buy", ambiguous: false, reason: "Requirement status resolves mixed buy/rent evidence to buy." };
    }
    return { goal: null, ambiguous: true, reason: "Contact has both buy and rent intent signals." };
  }

  if (buyIntent) return { goal: "To Buy", ambiguous: false, reason: "Strong text indicates buying intent." };
  if (rentIntent) return { goal: "To Rent", ambiguous: false, reason: "Strong text indicates renting intent." };
  return { goal: null, ambiguous: false, reason: null };
}

function addPersonNamePatch(args: {
  contact: AnyRecord;
  patch: ContactVerificationPatch;
  evidence: AnyRecord[];
}) {
  const parsed = parseContactPersonNameFromDisplayName(args.contact.name);
  if (!parsed.firstName) return;

  const currentFirstName = normalizeWhitespace(args.contact.firstName);
  const currentLastName = normalizeWhitespace(args.contact.lastName);
  const nextLastName = parsed.lastName || null;
  let changed = false;

  if (parsed.firstName && currentFirstName !== parsed.firstName && (!currentFirstName || hasContactPersonNameNoise(currentFirstName))) {
    args.patch.firstName = parsed.firstName;
    changed = true;
  }

  if ((nextLastName || currentLastName) && currentLastName !== (nextLastName || "")) {
    if (!currentLastName || hasContactPersonNameNoise(currentLastName)) {
      args.patch.lastName = nextLastName;
      changed = true;
    }
  }

  if (changed) {
    args.evidence.push({
      sourceId: "display_name_parser",
      field: "firstName",
      quote: `Parsed person name from display name "${args.contact.name}".`,
    });
  }
}

export function buildContactVerificationAssessment(args: {
  contact: AnyRecord;
  recentMessages?: Array<{ body?: string | null }>;
}) {
  const recentMessages = args.recentMessages || [];
  const evidenceText = buildRoleEvidenceText({ contact: args.contact, messages: recentMessages });
  const inferredRole = inferLeadContactRoleFromSignals({
    contactType: args.contact.contactType,
    name: args.contact.name,
    texts: [
      args.contact.message,
      args.contact.notes,
      args.contact.requirementOtherDetails,
      args.contact.requirementSummary,
      evidenceText,
    ],
  });
  const snapshot = getContactVerificationSnapshot(args.contact);
  const patch: ContactVerificationPatch = {};
  const evidence: AnyRecord[] = [];

  addPersonNamePatch({ contact: args.contact, patch, evidence });
  const inferredLeadGoal = inferLeadGoalFromText({ contact: args.contact, evidenceText });

  if (inferredRole !== "Lead" && String(args.contact.contactType || "") !== inferredRole) {
    patch.contactType = inferredRole;
    patch.leadGoal = null;
    patch.qualificationStage = "not_a_lead";
    const refs = extractPropertyRefsFromLeadText(`${args.contact.name || ""}\n${evidenceText}`);
    const proposedName = buildCanonicalContactName({
      contact: args.contact,
      contactType: inferredRole,
      rawLeadText: `${args.contact.name || ""}\n${evidenceText}`,
      propertyRefs: refs,
    });
    if (proposedName && proposedName !== args.contact.name) patch.name = proposedName;
    evidence.push({
      sourceId: "role_inference",
      field: "contactType",
      quote: `Name or context indicates ${inferredRole}.`,
    });
  } else if (String(args.contact.contactType || "") === "Lead" && ["To Buy", "To Rent"].includes(String(args.contact.leadGoal || ""))) {
    const leadProfileLabel = leadGoalProfileLabel(args.contact.leadGoal);
    evidence.push({
      sourceId: "lead_verification",
      field: "contactType",
      quote: `Contact type and lead goal are consistent with ${leadProfileLabel} outreach.`,
    });
  } else if (NON_LEAD_CONTACT_TYPES.has(String(args.contact.contactType || ""))) {
    if (args.contact.leadGoal) patch.leadGoal = null;
    if (args.contact.qualificationStage !== "not_a_lead") patch.qualificationStage = "not_a_lead";
    evidence.push({
      sourceId: "stored_contact_type",
      field: "contactType",
      quote: `Stored contact type is ${args.contact.contactType}.`,
    });
  } else if (String(args.contact.contactType || "") === "Lead" && inferredLeadGoal.goal && inferredLeadGoal.goal !== args.contact.leadGoal) {
    patch.leadGoal = inferredLeadGoal.goal;
    evidence.push({
      sourceId: "lead_goal_inference",
      field: "leadGoal",
      quote: inferredLeadGoal.reason || `Text indicates ${leadGoalProfileLabel(inferredLeadGoal.goal)} intent.`,
    });
  } else if (String(args.contact.contactType || "") === "Lead" && inferredLeadGoal.ambiguous) {
    evidence.push({
      sourceId: "lead_goal_inference",
      field: "leadGoal",
      quote: inferredLeadGoal.reason || "Buy/rent intent is ambiguous.",
    });
  }

  const normalizedPatch = preserveStructuredLeadDisplayNamePatch({
    contact: args.contact,
    patch: normalizeContactVerificationPatch(patch),
    inferredRole,
  });
  const status = inferredLeadGoal.ambiguous && !normalizedPatch.leadGoal
    ? "needs_review"
    : verificationStatusForPatch(normalizedPatch, inferredRole, args.contact);
  const leadProfileLabel = leadGoalProfileLabel(normalizedPatch.leadGoal || args.contact.leadGoal);
  const reasoning = status === "verified_lead"
    ? `Contact fields are consistent with a ${leadProfileLabel} lead.`
    : inferredRole !== "Lead"
      ? `Name or context indicates this contact is ${inferredRole}, not a buyer/renter lead.`
      : "Contact profile needs review before it can be treated as a verified lead.";

  return {
    status,
    inferredRole,
    snapshot,
    proposedPatch: normalizedPatch,
    evidence,
    confidence: inferredRole === "Lead" ? 0.8 : 0.9,
    reasoning,
    hasChanges: getContactVerificationPatchChanges(snapshot, normalizedPatch).length > 0,
  };
}

async function getContactProfileVerificationModel(locationId: string, modelOverride?: string | null): Promise<string> {
  const override = String(modelOverride || "").trim();
  if (override) return override;
  const doc = await settingsService.getDocument<any>({
    scopeType: "LOCATION",
    scopeId: locationId,
    domain: SETTINGS_DOMAINS.LOCATION_AI,
  }).catch(() => null);
  const rawConfig = doc?.payload?.contactProfileVerification;
  const config = normalizeContactProfileVerificationConfig(rawConfig);
  const configured = String(rawConfig?.model || "").trim();
  if (configured) return configured;
  return String(doc?.payload?.googleAiModelExtraction || doc?.payload?.googleAiModel || "").trim() || config.model;
}

function buildContactVerificationPrompt(args: {
  contact: AnyRecord;
  recentMessages: Array<{ body?: string | null; direction?: string | null; createdAt?: Date | string | null }>;
  deterministicAssessment: ContactVerificationAssessment;
}) {
  const snapshot = getContactVerificationSnapshot(args.contact);
  const messages = args.recentMessages.map((message) => ({
    direction: message.direction || null,
    createdAt: message.createdAt
      ? new Date(message.createdAt).toISOString()
      : null,
    body: normalizeText(message.body, 2000),
  })).filter((message) => message.body);

  return `You classify real-estate CRM contacts before buyer/renter requirement automation runs.

Return JSON only:
{
  "status": "verified_lead"|"needs_review"|"likely_agent"|"likely_owner"|"not_a_lead",
  "inferredRole": "Lead"|"Agent"|"Owner"|"Partner"|"Associate"|"Maintenance"|"Contact"|"Tenant"|"WhatsAppGroup",
  "proposedPatch": {
    "contactType": string|null,
    "leadGoal": "To Buy"|"To Rent"|"To List"|"Other"|null,
    "name": string|null,
    "firstName": string|null,
    "lastName": string|null,
    "qualificationStage": string|null,
    "requirementSummary": string|null
  },
  "evidence": [{"sourceId": string, "field": string, "quote": string}],
  "confidence": number,
  "reasoning": string
}

Rules:
- Classify buyer/renter leads as verified_lead only when the contact is a real buyer or renter lead.
- Classify agents, owners, partners, associates, maintenance contacts, tenants, groups, and unrelated contacts as non-leads.
- Use likely_agent or likely_owner when the strongest correction is agent or owner.
- Use not_a_lead for other non-lead contacts.
- Use needs_review when buy/rent intent or role is ambiguous.
- Propose only fields that should change. Use null only to clear allowed nullable fields.
- Do not invent personal names, budgets, or requirements.
- Preserve structured CRM display names generated by Paste Lead, such as "Kristina Grüße Lead Sale DT2937 2Bdr Town House Peyia"; do not propose "name" just to strip role, goal, reference, bedroom, property type, or location tokens. Use "firstName" and "lastName" for the clean person name.
- If changing contactType away from Lead, clear leadGoal and set qualificationStage to not_a_lead.
- Keep evidence quotes short and grounded in the input.

Current contact snapshot:
${JSON.stringify(snapshot, null, 2)}

Additional contact context:
${JSON.stringify({
    rawName: args.contact.name || null,
    message: normalizeText(args.contact.message, 2000),
    notes: normalizeText(args.contact.notes, 2000),
    requirementStatus: args.contact.requirementStatus || null,
    requirementSummary: normalizeText(args.contact.requirementSummary, 2000),
    requirementOtherDetails: normalizeText(args.contact.requirementOtherDetails, 2000),
  }, null, 2)}

Recent messages:
${JSON.stringify(messages, null, 2)}

Deterministic baseline for comparison:
${JSON.stringify({
    status: args.deterministicAssessment.status,
    inferredRole: args.deterministicAssessment.inferredRole,
    proposedPatch: args.deterministicAssessment.proposedPatch,
    reasoning: args.deterministicAssessment.reasoning,
  }, null, 2)}`;
}

function normalizeAiContactVerificationAssessment(args: {
  raw: any;
  contact: AnyRecord;
  deterministicAssessment: ContactVerificationAssessment;
}): ContactVerificationAssessment {
  let proposedPatch = normalizeContactVerificationPatch(args.raw?.proposedPatch || {});
  const inferredRole = normalizeInferredLeadContactRole(args.raw?.inferredRole)
    || normalizeInferredLeadContactRole(proposedPatch.contactType)
    || args.deterministicAssessment.inferredRole;
  proposedPatch = preserveStructuredLeadDisplayNamePatch({
    contact: args.contact,
    patch: proposedPatch,
    inferredRole,
  });
  const status = normalizeContactVerificationStatus(args.raw?.status)
    || verificationStatusForPatch(proposedPatch, inferredRole, args.contact);
  const confidence = Number(args.raw?.confidence);
  const reasoning = normalizeText(args.raw?.reasoning, 4000)
    || args.deterministicAssessment.reasoning;
  const evidence = normalizeEvidenceItems(args.raw?.evidence);
  const snapshot = getContactVerificationSnapshot(args.contact);
  const hasChanges = getContactVerificationPatchChanges(snapshot, proposedPatch).length > 0;

  if (!normalizeContactVerificationStatus(status)) {
    throw new Error("AI response did not include a valid contact classification status.");
  }
  if (!hasChanges && status === "needs_review" && evidence.length === 0) {
    throw new Error("AI response did not include usable classification evidence.");
  }

  return {
    status,
    inferredRole,
    snapshot,
    proposedPatch,
    evidence: evidence.length > 0 ? evidence : args.deterministicAssessment.evidence,
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : args.deterministicAssessment.confidence,
    reasoning,
    hasChanges,
  };
}

async function buildModelBackedContactVerificationAssessment(args: {
  locationId: string;
  contact: AnyRecord;
  recentMessages: Array<{ body?: string | null; direction?: string | null; createdAt?: Date | string | null }>;
  deterministicAssessment: ContactVerificationAssessment;
  modelOverride?: string | null;
}): Promise<{
  assessment: ContactVerificationAssessment;
  metadata: ContactVerificationRunMetadata;
}> {
  const modelName = await getContactProfileVerificationModel(args.locationId, args.modelOverride);
  const apiKey = await resolveLocationGoogleAiApiKey(args.locationId);
  if (!apiKey) {
    throw new Error("No AI API key configured.");
  }

  const prompt = buildContactVerificationPrompt({
    contact: args.contact,
    recentMessages: args.recentMessages,
    deterministicAssessment: args.deterministicAssessment,
  });
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.1,
    },
  });
  const result = await model.generateContent(prompt);
  const parsed = extractJsonObject(result.response.text());
  const assessment = normalizeAiContactVerificationAssessment({
    raw: parsed,
    contact: args.contact,
    deterministicAssessment: args.deterministicAssessment,
  });
  const usage = (result.response.usageMetadata || {}) as Record<string, unknown>;
  const promptTokens = Number(usage.promptTokenCount || 0);
  const completionTokens = Number(usage.candidatesTokenCount || 0);
  const totalTokens = Number(usage.totalTokenCount || promptTokens + completionTokens);
  const estimatedCostUsd = calculateRunCost(modelName, promptTokens, completionTokens);

  return {
    assessment,
    metadata: {
      provider: CONTACT_VERIFICATION_AI_PROVIDER,
      model: modelName,
      promptTokens,
      completionTokens,
      totalTokens,
      estimatedCostUsd,
      fallbackReason: null,
    },
  };
}

async function resolveContactVerificationAssessment(args: {
  locationId: string;
  contact: AnyRecord;
  recentMessages: Array<{ body?: string | null; direction?: string | null; createdAt?: Date | string | null }>;
  modelOverride?: string | null;
}): Promise<{
  assessment: ContactVerificationAssessment;
  metadata: ContactVerificationRunMetadata;
}> {
  const deterministicAssessment = buildContactVerificationAssessment({
    contact: args.contact,
    recentMessages: args.recentMessages,
  });

  try {
    return await buildModelBackedContactVerificationAssessment({
      locationId: args.locationId,
      contact: args.contact,
      recentMessages: args.recentMessages,
      deterministicAssessment,
      modelOverride: args.modelOverride,
    });
  } catch (error: any) {
    const fallbackReason = error?.message || "Gemini contact classification failed.";
    console.warn("[contact-verification] Falling back to deterministic classification:", {
      locationId: args.locationId,
      contactId: args.contact.id,
      reason: fallbackReason,
    });
    return {
      assessment: deterministicAssessment,
      metadata: {
        provider: CONTACT_VERIFICATION_PROVIDER,
        model: CONTACT_VERIFICATION_MODEL,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
        fallbackReason,
      },
    };
  }
}

function profileVerificationDataForAssessment(args: {
  assessment: ReturnType<typeof buildContactVerificationAssessment>;
  sourceType?: string;
}) {
  return profileVerificationFields({
    status: args.assessment.status,
    source: args.sourceType || "manual_verification",
    confidence: args.assessment.confidence,
    summary: args.assessment.reasoning,
  });
}

export function shouldAutoApplyContactVerificationAssessment(assessment: {
  status?: string | null;
  confidence?: number | null;
  snapshot?: AnyRecord | null;
  proposedPatch?: ContactVerificationPatch | null;
}) {
  const status = normalizeContactVerificationStatus(assessment.status);
  const currentContactType = normalizeContactType(assessment.snapshot?.contactType);
  const proposedContactType = normalizeContactType(assessment.proposedPatch?.contactType);
  if (currentContactType === "Lead" && proposedContactType === "Contact") {
    return false;
  }

  return Boolean(status)
    && status !== "needs_review"
    && Number(assessment.confidence || 0) >= AUTO_APPLY_CONFIDENCE_THRESHOLD;
}

async function applyContactVerificationAssessment(args: {
  locationId: string;
  contact: AnyRecord;
  assessment: ContactVerificationAssessment;
  sourceType: string;
  actorUserId?: string | null;
  proposalId?: string | null;
  reprocessCampaignBlocks?: boolean;
}) {
  const changes = getContactVerificationPatchChanges(args.assessment.snapshot, args.assessment.proposedPatch);
  const changedPatch = changes.reduce((data, change) => {
    (data as AnyRecord)[change.field] = change.new;
    return data;
  }, {} as ContactVerificationPatch);

  await db.$transaction(async (tx) => {
    await tx.contact.update({
      where: { id: args.contact.id },
      data: {
        ...withProfileVerificationInvalidation(changedPatch as any),
        ...profileVerificationDataForAssessment({
          assessment: args.assessment,
          sourceType: args.sourceType,
        }),
      },
    });
    if (changes.length > 0) {
      await tx.contactHistory.create({
        data: {
          contactId: args.contact.id,
          userId: args.actorUserId || null,
          action: "AI_CONTACT_VERIFICATION_AUTO_APPLIED",
          changes: {
            proposalId: args.proposalId || null,
            status: args.assessment.status,
            confidence: args.assessment.confidence,
            changes,
          } as any,
        },
      });
    }
    if (args.proposalId) {
      await tx.contactRequirementProposal.update({
        where: { id: args.proposalId },
        data: {
          status: "approved",
          approvedAt: new Date(),
          approvedByUserId: args.actorUserId || null,
        },
      });
    }
    await tx.contactRequirementProposal.updateMany({
      where: {
        contactId: args.contact.id,
        proposalType: "verification",
        status: "pending",
        ...(args.proposalId ? { id: { not: args.proposalId } } : {}),
      },
      data: { status: "superseded" },
    });
  });

  if (args.assessment.status === "verified_lead") {
    if (args.reprocessCampaignBlocks !== false) {
      await reprocessCampaignBlocksForVerifiedContact({
        locationId: args.locationId,
        contactId: args.contact.id,
      });
    }
    await queueRequirementsForVerifiedContact({
      locationId: args.locationId,
      contactId: args.contact.id,
    });
  }
}

async function reprocessCampaignBlocksForVerifiedContact(args: {
  locationId: string;
  contactId: string;
}) {
  try {
    const { reprocessVerifiedContactProfileBlocks } = await import("@/lib/property-match-campaigns/service");
    await reprocessVerifiedContactProfileBlocks({
      locationId: args.locationId,
      contactId: args.contactId,
      limit: 100,
    });
  } catch (error) {
    console.warn("[contact-verification] Failed to reprocess campaign profile blocks:", error);
  }
}

async function queueRequirementsForVerifiedContact(args: {
  locationId: string;
  contactId: string;
  conversationId?: string | null;
}) {
  try {
    const { queueRequirementProposalForNewActivity } = await import("@/lib/ai/requirements-intelligence/service");
    queueRequirementProposalForNewActivity({
      locationId: args.locationId,
      contactId: args.contactId,
      conversationId: args.conversationId || null,
      sourceType: "verification",
    });
  } catch (error) {
    console.warn("[contact-verification] Failed to queue requirements intelligence:", error);
  }
}

async function collectRecentMessages(args: {
  locationId: string;
  contactId: string;
  conversationId?: string | null;
}) {
  const conversationWhere: AnyRecord = args.conversationId
    ? { id: args.conversationId, locationId: args.locationId, contactId: args.contactId }
    : { locationId: args.locationId, contactId: args.contactId, deletedAt: null };
  const conversation = await db.conversation.findFirst({
    where: conversationWhere,
    orderBy: { lastMessageAt: "desc" },
    select: {
      messages: {
        orderBy: { createdAt: "desc" },
        take: 12,
        select: { id: true, body: true, direction: true, createdAt: true },
      },
    },
  });
  return [...(conversation?.messages || [])].reverse();
}

export async function verifyContactProfile(args: {
  locationId: string;
  contactId: string;
  conversationId?: string | null;
  sourceType?: string;
  sourceIds?: string[];
  actorUserId?: string | null;
  contactSnapshot?: AnyRecord | null;
  reprocessCampaignBlocks?: boolean;
  modelOverride?: string | null;
}) {
  const startedAt = Date.now();
  logContactVerificationTiming("scan_start", {
    locationId: args.locationId,
    contactId: args.contactId,
    conversationId: args.conversationId || null,
    sourceType: args.sourceType || "manual_verification",
    model: CONTACT_VERIFICATION_MODEL,
    provider: CONTACT_VERIFICATION_PROVIDER,
  });

  const contactLookupStartedAt = Date.now();
  const contact = args.contactSnapshot && args.contactSnapshot.id === args.contactId
    ? args.contactSnapshot
    : await db.contact.findFirst({
      where: { id: args.contactId, locationId: args.locationId },
    });
  const contactLookupMs = Date.now() - contactLookupStartedAt;
  if (!contact) {
    logContactVerificationTiming("scan_failed", {
      locationId: args.locationId,
      contactId: args.contactId,
      conversationId: args.conversationId || null,
      elapsedMs: Date.now() - startedAt,
      reason: "Contact not found.",
    });
    return { success: false as const, error: "Contact not found." };
  }

  const pendingStartedAt = Date.now();
  const messagesStartedAt = Date.now();
  const [pendingProposal, recentMessages] = await Promise.all([
    db.contactRequirementProposal.findFirst({
      where: {
        locationId: args.locationId,
        contactId: contact.id,
        proposalType: "verification",
        status: "pending",
      },
      select: { id: true },
    }),
    collectRecentMessages({
      locationId: args.locationId,
      contactId: contact.id,
      conversationId: args.conversationId || null,
    }),
  ]);
  const pendingMs = Date.now() - pendingStartedAt;
  const messagesMs = Date.now() - messagesStartedAt;

  if (pendingProposal) {
    logContactVerificationTiming("scan_skipped_pending", {
      locationId: args.locationId,
      contactId: contact.id,
      conversationId: args.conversationId || null,
      proposalId: pendingProposal.id,
      elapsedMs: Date.now() - startedAt,
      contactLookupMs,
      pendingMs,
      messagesMs,
    });
    return { success: true as const, created: false as const, reason: "A pending contact verification proposal already exists." };
  }

  const assessmentStartedAt = Date.now();
  const { assessment, metadata } = await resolveContactVerificationAssessment({
    locationId: args.locationId,
    contact,
    recentMessages,
    modelOverride: args.modelOverride,
  });
  const assessmentMs = Date.now() - assessmentStartedAt;

  void securelyRecordAiUsage({
    locationId: args.locationId,
    userId: args.actorUserId || null,
    resourceType: "contact",
    resourceId: contact.id,
    featureArea: "contact_verification",
    action: "profile_scan",
    provider: metadata.provider,
    model: metadata.model,
    inputTokens: metadata.promptTokens,
    outputTokens: metadata.completionTokens,
    metadata: {
      conversationId: args.conversationId || null,
      sourceType: args.sourceType || "manual_verification",
      status: assessment.status,
      inferredRole: assessment.inferredRole,
      hasChanges: assessment.hasChanges,
      recentMessageCount: recentMessages.length,
      totalTokens: metadata.totalTokens,
      estimatedCostUsd: metadata.estimatedCostUsd,
      fallbackReason: metadata.fallbackReason || null,
      durationMs: Date.now() - startedAt,
      contactLookupMs,
      pendingMs,
      messagesMs,
      assessmentMs,
    },
  });

  if (!assessment.hasChanges) {
    await db.contact.update({
      where: { id: contact.id },
      data: profileVerificationDataForAssessment({
        assessment,
        sourceType: args.sourceType || "manual_verification",
      }),
    });
    if (assessment.status === "verified_lead" && args.reprocessCampaignBlocks !== false) {
      await reprocessCampaignBlocksForVerifiedContact({
        locationId: args.locationId,
        contactId: contact.id,
      });
    }
    if (assessment.status === "verified_lead") {
      await queueRequirementsForVerifiedContact({
        locationId: args.locationId,
        contactId: contact.id,
        conversationId: args.conversationId || null,
      });
    }
    logContactVerificationTiming("scan_complete", {
      locationId: args.locationId,
      contactId: contact.id,
      conversationId: args.conversationId || null,
      elapsedMs: Date.now() - startedAt,
      contactLookupMs,
      pendingMs,
      messagesMs,
      assessmentMs,
      recentMessageCount: recentMessages.length,
      status: assessment.status,
      inferredRole: assessment.inferredRole,
      hasChanges: false,
      proposalCreated: false,
      model: metadata.model,
      provider: metadata.provider,
      promptTokens: metadata.promptTokens,
      completionTokens: metadata.completionTokens,
      totalTokens: metadata.totalTokens,
      fallbackReason: metadata.fallbackReason || null,
    });
    return { success: true as const, created: false as const, reason: assessment.reasoning, assessment };
  }

  if (shouldAutoApplyContactVerificationAssessment(assessment)) {
    await applyContactVerificationAssessment({
      locationId: args.locationId,
      contact,
      assessment,
      sourceType: args.sourceType || "manual_verification",
      actorUserId: args.actorUserId || null,
      reprocessCampaignBlocks: args.reprocessCampaignBlocks,
    });
    logContactVerificationTiming("scan_complete", {
      locationId: args.locationId,
      contactId: contact.id,
      conversationId: args.conversationId || null,
      elapsedMs: Date.now() - startedAt,
      contactLookupMs,
      pendingMs,
      messagesMs,
      assessmentMs,
      recentMessageCount: recentMessages.length,
      status: assessment.status,
      inferredRole: assessment.inferredRole,
      hasChanges: true,
      autoApplied: true,
      proposalCreated: false,
      model: metadata.model,
      provider: metadata.provider,
      promptTokens: metadata.promptTokens,
      completionTokens: metadata.completionTokens,
      totalTokens: metadata.totalTokens,
      fallbackReason: metadata.fallbackReason || null,
    });
    return { success: true as const, created: false as const, autoApplied: true as const, reason: assessment.reasoning, assessment };
  }

  const proposal = await db.contactRequirementProposal.create({
    data: {
      locationId: args.locationId,
      contactId: contact.id,
      conversationId: args.conversationId || null,
      sourceType: args.sourceType || "manual_verification",
      sourceIds: args.sourceIds || [],
      proposalType: "verification",
      status: "pending",
      currentSnapshot: assessment.snapshot,
      proposedPatch: assessment.proposedPatch,
      proposedSummary: assessment.status,
      evidence: assessment.evidence,
      confidence: assessment.confidence,
      reasoning: assessment.reasoning,
      model: metadata.model,
      promptTokens: metadata.promptTokens,
      completionTokens: metadata.completionTokens,
      totalTokens: metadata.totalTokens,
      estimatedCostUsd: metadata.estimatedCostUsd,
    },
  });

  logContactVerificationTiming("scan_complete", {
    locationId: args.locationId,
    contactId: contact.id,
    conversationId: args.conversationId || null,
    elapsedMs: Date.now() - startedAt,
    contactLookupMs,
    pendingMs,
    messagesMs,
    assessmentMs,
    recentMessageCount: recentMessages.length,
    status: assessment.status,
    inferredRole: assessment.inferredRole,
    hasChanges: true,
    proposalCreated: true,
    proposalId: proposal.id,
    model: metadata.model,
    provider: metadata.provider,
    promptTokens: metadata.promptTokens,
    completionTokens: metadata.completionTokens,
    totalTokens: metadata.totalTokens,
    fallbackReason: metadata.fallbackReason || null,
  });

  return { success: true as const, created: true as const, proposal, assessment };
}

export async function autoApplyConfidentContactVerificationProposals(args: {
  locationId: string;
  actorUserId?: string | null;
  limit?: number;
}) {
  const limit = Math.max(1, Math.min(200, Number(args.limit || 100)));
  const rows = await db.contactRequirementProposal.findMany({
    where: {
      locationId: args.locationId,
      proposalType: "verification",
      status: "pending",
      proposedSummary: { not: "needs_review" },
      confidence: { gte: AUTO_APPLY_CONFIDENCE_THRESHOLD },
    },
    include: { contact: true },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  let applied = 0;
  let skipped = 0;
  let failures = 0;

  for (const proposal of rows) {
    const proposedPatch = normalizeContactVerificationPatch(proposal.proposedPatch);
    const status = normalizeContactVerificationStatus(proposal.proposedSummary);
    if (!status || status === "needs_review") {
      skipped += 1;
      continue;
    }
    const assessment = {
      status,
      inferredRole: normalizeInferredLeadContactRole(proposedPatch.contactType) || "Lead",
      snapshot: getContactVerificationSnapshot(proposal.contact),
      proposedPatch,
      evidence: Array.isArray(proposal.evidence) ? proposal.evidence as AnyRecord[] : [],
      confidence: Number(proposal.confidence || 0),
      reasoning: normalizeText(proposal.reasoning, 4000) || "Confident contact classification auto-applied.",
      hasChanges: getContactVerificationPatchChanges(getContactVerificationSnapshot(proposal.contact), proposedPatch).length > 0,
    } satisfies ContactVerificationAssessment;
    if (!shouldAutoApplyContactVerificationAssessment(assessment)) {
      skipped += 1;
      continue;
    }

    try {
      await applyContactVerificationAssessment({
        locationId: args.locationId,
        contact: proposal.contact,
        assessment,
        sourceType: String(proposal.sourceType || "manual_verification"),
        actorUserId: args.actorUserId || null,
        proposalId: proposal.id,
      });
      applied += 1;
    } catch (error) {
      failures += 1;
      console.error("[contact-verification] Failed to auto-apply pending proposal:", proposal.id, error);
    }
  }

  return {
    success: true as const,
    checked: rows.length,
    applied,
    skipped,
    failures,
    remainingBatchAvailable: rows.length === limit,
  };
}

export async function listPendingContactVerificationProposals(args: {
  locationId: string;
  contactId: string;
  limit?: number;
}) {
  return db.contactRequirementProposal.findMany({
    where: {
      locationId: args.locationId,
      contactId: args.contactId,
      proposalType: "verification",
      status: "pending",
    },
    orderBy: { createdAt: "desc" },
    take: Math.max(1, Math.min(20, Number(args.limit || 5))),
  });
}

export async function approveContactVerificationProposal(args: {
  locationId: string;
  proposalId: string;
  actorUserId: string | null;
  editedPatch?: ContactVerificationPatch | null;
}) {
  const proposal = await db.contactRequirementProposal.findFirst({
    where: { id: args.proposalId, locationId: args.locationId, proposalType: "verification" },
    include: { contact: true },
  });
  if (!proposal) return { success: false as const, error: "Contact verification proposal not found." };
  if (proposal.status !== "pending") return { success: false as const, error: `Cannot approve a ${proposal.status} proposal.` };

  const patch = normalizeContactVerificationPatch(args.editedPatch || proposal.proposedPatch);
  const snapshot = getContactVerificationSnapshot(proposal.contact);
  const changes = getContactVerificationPatchChanges(snapshot, patch);
  const sourceType = String(proposal.sourceType || "manual_verification");
  if (changes.length === 0) {
    const assessment = buildContactVerificationAssessment({ contact: proposal.contact });
    await db.$transaction(async (tx) => {
      await tx.contact.update({
        where: { id: proposal.contactId },
        data: profileVerificationDataForAssessment({ assessment, sourceType }),
      });
      await tx.contactRequirementProposal.update({
        where: { id: proposal.id },
        data: {
          status: "approved",
          approvedAt: new Date(),
          approvedByUserId: args.actorUserId,
        },
      });
      await tx.contactRequirementProposal.updateMany({
        where: {
          id: { not: proposal.id },
          contactId: proposal.contactId,
          proposalType: "verification",
          status: "pending",
        },
        data: { status: "superseded" },
      });
    });
    if (assessment.status === "verified_lead") {
      await reprocessCampaignBlocksForVerifiedContact({
        locationId: args.locationId,
        contactId: proposal.contactId,
      });
      await queueRequirementsForVerifiedContact({
        locationId: args.locationId,
        contactId: proposal.contactId,
      });
    }
    return { success: true as const, updated: false as const };
  }

  const changedPatch = changes.reduce((data, change) => {
    (data as AnyRecord)[change.field] = change.new;
    return data;
  }, {} as ContactVerificationPatch);
  const assessment = buildContactVerificationAssessment({
    contact: {
      ...proposal.contact,
      ...changedPatch,
    },
  });

  await db.$transaction(async (tx) => {
    await tx.contact.update({
      where: { id: proposal.contactId },
      data: {
        ...withProfileVerificationInvalidation(changedPatch as any),
        ...profileVerificationDataForAssessment({ assessment, sourceType }),
      },
    });
    await tx.contactHistory.create({
      data: {
        contactId: proposal.contactId,
        userId: args.actorUserId,
        action: "AI_CONTACT_VERIFICATION_UPDATED",
        changes: {
          proposalId: proposal.id,
          changes,
        } as any,
      },
    });
    await tx.contactRequirementProposal.update({
      where: { id: proposal.id },
      data: {
        status: "approved",
        approvedAt: new Date(),
        approvedByUserId: args.actorUserId,
      },
    });
    await tx.contactRequirementProposal.updateMany({
      where: {
        id: { not: proposal.id },
        contactId: proposal.contactId,
        proposalType: "verification",
        status: "pending",
      },
      data: { status: "superseded" },
    });
  });

  if (assessment.status === "verified_lead") {
    await reprocessCampaignBlocksForVerifiedContact({
      locationId: args.locationId,
      contactId: proposal.contactId,
    });
    await queueRequirementsForVerifiedContact({
      locationId: args.locationId,
      contactId: proposal.contactId,
    });
  }

  return { success: true as const, updated: true as const, contactId: proposal.contactId };
}

export async function rejectContactVerificationProposal(args: {
  locationId: string;
  proposalId: string;
  actorUserId: string | null;
  reason?: string | null;
}) {
  const proposal = await db.contactRequirementProposal.findFirst({
    where: { id: args.proposalId, locationId: args.locationId, proposalType: "verification" },
    select: { id: true, status: true },
  });
  if (!proposal) return { success: false as const, error: "Contact verification proposal not found." };
  if (proposal.status !== "pending") return { success: false as const, error: `Cannot reject a ${proposal.status} proposal.` };

  await db.contactRequirementProposal.update({
    where: { id: proposal.id },
    data: {
      status: "rejected",
      rejectedAt: new Date(),
      rejectedByUserId: args.actorUserId,
      rejectedReason: normalizeText(args.reason, 1000),
    },
  });

  return { success: true as const };
}

export async function markContactVerified(args: {
  locationId: string;
  contactId: string;
  actorUserId: string | null;
}) {
  const contact = await db.contact.findFirst({
    where: { id: args.contactId, locationId: args.locationId },
    select: { id: true, qualificationStage: true },
  });
  if (!contact) return { success: false as const, error: "Contact not found." };
  await db.$transaction(async (tx) => {
    await tx.contact.update({
      where: { id: contact.id },
      data: profileVerificationFields({
        status: "verified_lead",
        source: "manual_mark_verified",
        confidence: 1,
        summary: "Contact manually marked as a verified buyer/renter lead.",
      }),
    });
    await tx.contactHistory.create({
      data: {
        contactId: contact.id,
        userId: args.actorUserId,
        action: "CONTACT_VERIFIED",
        changes: { qualificationStage: contact.qualificationStage || null } as any,
      },
    });
    await tx.contactRequirementProposal.updateMany({
      where: { contactId: contact.id, proposalType: "verification", status: "pending" },
      data: { status: "superseded" },
    });
  });
  await reprocessCampaignBlocksForVerifiedContact({
    locationId: args.locationId,
    contactId: contact.id,
  });
  await queueRequirementsForVerifiedContact({
    locationId: args.locationId,
    contactId: contact.id,
  });
  return { success: true as const, contactId: contact.id };
}
