import { GoogleGenerativeAI } from "@google/generative-ai";
import db from "@/lib/db";
import { calculateRunCost } from "@/lib/ai/pricing";
import { securelyRecordAiUsage } from "@/lib/ai/usage-metering";
import { resolveLocationGoogleAiApiKey } from "@/lib/ai/location-google-key";
import { GEMINI_FLASH_STABLE_FALLBACK } from "@/lib/ai/models";
import { settingsService } from "@/lib/settings/service";
import { SETTINGS_DOMAINS } from "@/lib/settings/constants";
import {
  resolvePropertyEvidenceForContactActivity,
  type PropertyEvidenceInput,
  type PropertyEvidenceInterestSource,
} from "@/lib/ai/property-evidence-resolver/service";

export const REQUIREMENTS_INTELLIGENCE_MODES = [
  "off",
  "manual_only",
  "new_activity",
  "daily_and_new_activity",
] as const;

export type RequirementsIntelligenceMode = typeof REQUIREMENTS_INTELLIGENCE_MODES[number];

type RequirementPatch = {
  requirementStatus?: string | null;
  requirementDistrict?: string | null;
  requirementBedrooms?: string | null;
  requirementMinPrice?: string | null;
  requirementMaxPrice?: string | null;
  requirementCondition?: string | null;
  requirementPropertyTypes?: string[] | null;
  requirementPropertyLocations?: string[] | null;
  requirementOtherDetails?: string | null;
  requirementSummary?: string | null;
};

type RequirementEvidenceItem = {
  id: string;
  type: "message" | "activity_note" | "transcript";
  direction?: string | null;
  propertyInterestSource: PropertyEvidenceInterestSource;
  createdAt: string | null;
  text: string;
};

const STRUCTURED_REQUIREMENT_FIELDS = [
  "requirementStatus",
  "requirementDistrict",
  "requirementBedrooms",
  "requirementMinPrice",
  "requirementMaxPrice",
  "requirementCondition",
  "requirementPropertyTypes",
  "requirementPropertyLocations",
  "requirementOtherDetails",
  "requirementSummary",
] as const;

const REQUIREMENT_SIGNAL_PATTERNS = [
  /\b(budget|price|range|maximum|max|min|afford|stretch)\b/i,
  /\b(apartment|flat|house|villa|detached|semi[-\s]?detached|townhouse|maisonette|studio|penthouse|bungalow)\b/i,
  /\b(bed|beds|bedroom|bedrooms|bdr|br)\b/i,
  /\b(area|location|district|village|town|city|near|walking distance|sea|beach|school|amenities)\b/i,
  /\b(rent|rental|buy|purchase|sale|investment|holiday home|relocation)\b/i,
  /\b(prefer|preference|must|need|needs|want|wants|looking for|changed|instead|open to|not interested)\b/i,
  /\b(garden|pool|parking|furnished|unfurnished|new build|resale|off[-\s]?plan|condition)\b/i,
];

function normalizeMode(value: unknown): RequirementsIntelligenceMode {
  const normalized = String(value || "").trim();
  return REQUIREMENTS_INTELLIGENCE_MODES.includes(normalized as RequirementsIntelligenceMode)
    ? normalized as RequirementsIntelligenceMode
    : "manual_only";
}

export async function getRequirementsIntelligenceSettings(locationId: string): Promise<{
  mode: RequirementsIntelligenceMode;
  model: string;
}> {
  const doc = await settingsService.getDocument<any>({
    scopeType: "LOCATION",
    scopeId: locationId,
    domain: SETTINGS_DOMAINS.LOCATION_AI,
  }).catch(() => null);
  const config = doc?.payload?.requirementsIntelligence || {};
  return {
    mode: normalizeMode(config.mode),
    model: String(config.model || doc?.payload?.googleAiModelExtraction || GEMINI_FLASH_STABLE_FALLBACK).trim() || GEMINI_FLASH_STABLE_FALLBACK,
  };
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? Array.from(new Set(value.map((item) => String(item || "").trim()).filter(Boolean)))
    : [];
}

function normalizeText(value: unknown, max = 4000): string | null {
  const normalized = String(value || "").trim();
  return normalized ? normalized.slice(0, max) : null;
}

function normalizePatch(raw: any): RequirementPatch {
  const patch: RequirementPatch = {};
  if (!raw || typeof raw !== "object") return patch;

  for (const field of STRUCTURED_REQUIREMENT_FIELDS) {
    const value = raw[field];
    if (value == null) continue;
    if (field === "requirementPropertyTypes" || field === "requirementPropertyLocations") {
      const arrayValue = toStringArray(value);
      if (arrayValue.length > 0) patch[field] = arrayValue;
      continue;
    }
    const text = normalizeText(value);
    if (text) patch[field] = text;
  }

  return patch;
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

function getRequirementSnapshot(contact: any): RequirementPatch {
  return {
    requirementStatus: contact.requirementStatus || null,
    requirementDistrict: contact.requirementDistrict || null,
    requirementBedrooms: contact.requirementBedrooms || null,
    requirementMinPrice: contact.requirementMinPrice || null,
    requirementMaxPrice: contact.requirementMaxPrice || null,
    requirementCondition: contact.requirementCondition || null,
    requirementPropertyTypes: toStringArray(contact.requirementPropertyTypes),
    requirementPropertyLocations: toStringArray(contact.requirementPropertyLocations),
    requirementOtherDetails: contact.requirementOtherDetails || null,
    requirementSummary: contact.requirementSummary || null,
  };
}

function normalizeAssessmentList(value: unknown, maxItems = 8): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value
    .map((item) => normalizeText(item, 500))
    .filter(Boolean) as string[]))
    .slice(0, maxItems);
}

function normalizeRequirementAssessment(raw: any) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    confirmedRequirements: normalizeAssessmentList(source.confirmedRequirements),
    possiblePreferences: normalizeAssessmentList(source.possiblePreferences),
    historicalInquiries: normalizeAssessmentList(source.historicalInquiries),
    changedOrContradicted: normalizeAssessmentList(source.changedOrContradicted),
    needsHumanClarification: normalizeAssessmentList(source.needsHumanClarification),
  };
}

function formatRequirementAssessmentForReasoning(assessment: ReturnType<typeof normalizeRequirementAssessment>): string | null {
  const sections = [
    assessment.confirmedRequirements.length ? `Confirmed: ${assessment.confirmedRequirements.join("; ")}` : null,
    assessment.possiblePreferences.length ? `Possible preferences: ${assessment.possiblePreferences.join("; ")}` : null,
    assessment.historicalInquiries.length ? `Historical inquiries: ${assessment.historicalInquiries.join("; ")}` : null,
    assessment.changedOrContradicted.length ? `Changed/contradicted: ${assessment.changedOrContradicted.join("; ")}` : null,
    assessment.needsHumanClarification.length ? `Needs clarification: ${assessment.needsHumanClarification.join("; ")}` : null,
  ].filter(Boolean);
  return sections.length > 0 ? sections.join("\n") : null;
}

async function recordRequirementsIntelligenceUsage(args: {
  locationId: string;
  contactId: string;
  conversationId?: string | null;
  actorUserId?: string | null;
  sourceType?: string | null;
  proposalId?: string | null;
  action: "assess_no_change" | "generate_requirement_proposal";
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}) {
  await securelyRecordAiUsage({
    locationId: args.locationId,
    userId: args.actorUserId || null,
    resourceType: "contact",
    resourceId: args.contactId,
    featureArea: "requirements_intelligence",
    action: args.action,
    provider: "google_gemini",
    model: args.model,
    inputTokens: args.promptTokens,
    outputTokens: args.completionTokens,
    metadata: {
      contactId: args.contactId,
      conversationId: args.conversationId || null,
      proposalId: args.proposalId || null,
      sourceType: args.sourceType || null,
      totalTokens: args.totalTokens,
      estimatedCostUsd: args.estimatedCostUsd,
    },
  });
}

function hasPatchChanges(snapshot: RequirementPatch, patch: RequirementPatch): boolean {
  return getRequirementPatchChanges(snapshot, patch).length > 0;
}

export function getRequirementPatchChanges(snapshot: RequirementPatch, patch: RequirementPatch) {
  return Object.entries(patch).filter(([key, value]) => {
    const previous = (snapshot as any)[key];
    if (Array.isArray(value) || Array.isArray(previous)) {
      return JSON.stringify(toStringArray(previous)) !== JSON.stringify(toStringArray(value));
    }
    return String(previous || "").trim() !== String(value || "").trim();
  }).map(([field, value]) => ({
    field,
    old: (snapshot as any)[field] ?? null,
    new: value,
  }));
}

export function classifyRequirementSignal(text: string): boolean {
  const source = String(text || "").trim();
  if (source.length < 12) return false;
  return REQUIREMENT_SIGNAL_PATTERNS.some((pattern) => pattern.test(source));
}

function propertyInterestSourceForEvidence(input: {
  type: "message" | "activity_note" | "transcript";
  direction?: string | null;
}): PropertyEvidenceInterestSource {
  if (input.type === "message") {
    return input.direction === "inbound" ? "client_inquired_property" : "agent_sent_option";
  }
  if (input.type === "activity_note") return "agent_note";
  if (input.type === "transcript") return "transcript";
  return "unknown";
}

async function collectRequirementEvidence(args: {
  locationId: string;
  contactId: string;
  conversationId?: string | null;
}): Promise<RequirementEvidenceItem[]> {
  const conversationWhere = args.conversationId
    ? { id: args.conversationId, locationId: args.locationId }
    : { contactId: args.contactId, locationId: args.locationId };

  const conversations = await db.conversation.findMany({
    where: conversationWhere,
    select: { id: true },
    orderBy: { lastMessageAt: "desc" },
    take: args.conversationId ? 1 : 4,
  });
  const conversationIds = conversations.map((item) => item.id);

  const [messages, historyRows, transcripts] = await Promise.all([
    conversationIds.length > 0
      ? db.message.findMany({
        where: { conversationId: { in: conversationIds }, direction: { in: ["inbound", "outbound"] } },
        orderBy: { createdAt: "desc" },
        take: 40,
        select: { id: true, body: true, direction: true, createdAt: true },
      })
      : Promise.resolve([]),
    db.contactHistory.findMany({
      where: { contactId: args.contactId },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, action: true, changes: true, createdAt: true },
    }),
    conversationIds.length > 0
      ? db.messageTranscript.findMany({
        where: { message: { conversationId: { in: conversationIds } }, status: "completed" },
        orderBy: { completedAt: "desc" },
        take: 8,
        select: { id: true, text: true, completedAt: true },
      })
      : Promise.resolve([]),
  ]);

  const messageEvidence = messages
    .reverse()
    .map((message) => ({
      id: message.id,
      type: "message" as const,
      direction: message.direction,
      propertyInterestSource: propertyInterestSourceForEvidence({
        type: "message",
        direction: message.direction,
      }),
      createdAt: message.createdAt.toISOString(),
      text: `${message.direction === "inbound" ? "Client" : "Agent"}: ${(message.body || "").trim()}`,
    }))
    .filter((item) => item.text.trim().length > 8);

  const historyEvidence = historyRows
    .reverse()
    .map((row) => ({
      id: row.id,
      type: "activity_note" as const,
      propertyInterestSource: propertyInterestSourceForEvidence({ type: "activity_note" }),
      createdAt: row.createdAt.toISOString(),
      text: JSON.stringify(row.changes || {}),
    }))
    .filter((item) => item.text.trim().length > 8);

  const transcriptEvidence = transcripts
    .reverse()
    .map((row) => ({
      id: row.id,
      type: "transcript" as const,
      propertyInterestSource: propertyInterestSourceForEvidence({ type: "transcript" }),
      createdAt: row.completedAt ? row.completedAt.toISOString() : null,
      text: String(row.text || "").trim(),
    }))
    .filter((item) => item.text.trim().length > 8);

  return [...messageEvidence, ...historyEvidence, ...transcriptEvidence].slice(-60);
}

function formatRequirementEvidenceLine(item: RequirementEvidenceItem): string {
  const direction = item.direction ? ` direction=${item.direction}` : "";
  return `[${item.type}${direction} interestSource=${item.propertyInterestSource} ${item.createdAt || ""} ${item.id}] ${item.text}`;
}

function toPropertyEvidenceInputs(
  evidence: RequirementEvidenceItem[]
): PropertyEvidenceInput[] {
  return evidence.map((item) => ({
    id: item.id,
    text: item.text,
    interestSource: item.propertyInterestSource,
  }));
}

export async function generateRequirementProposal(args: {
  locationId: string;
  contactId: string;
  conversationId?: string | null;
  sourceType?: string;
  sourceIds?: string[];
  actorUserId?: string | null;
}) {
  const contact = await db.contact.findFirst({
    where: { id: args.contactId, locationId: args.locationId },
  });
  if (!contact) return { success: false as const, error: "Contact not found." };

  const pendingProposal = await db.contactRequirementProposal.findFirst({
    where: {
      locationId: args.locationId,
      contactId: contact.id,
      proposalType: "requirements",
      status: "pending",
    },
    select: { id: true },
  });
  if (pendingProposal) {
    return { success: true as const, created: false as const, reason: "A pending requirement proposal already exists." };
  }

  const evidence = await collectRequirementEvidence(args);
  const evidenceText = evidence.map(formatRequirementEvidenceLine).join("\n");
  const propertyEvidence = await resolvePropertyEvidenceForContactActivity({
    locationId: args.locationId,
    contactId: contact.id,
    conversationId: args.conversationId || null,
    actorUserId: args.actorUserId || null,
    text: evidenceText,
    evidence: toPropertyEvidenceInputs(evidence),
    source: args.sourceType || "manual",
  });
  if (!classifyRequirementSignal(evidenceText) && propertyEvidence.items.length === 0) {
    return { success: true as const, created: false as const, reason: "No requirement changes detected." };
  }

  const settings = await getRequirementsIntelligenceSettings(args.locationId);
  const apiKey = await resolveLocationGoogleAiApiKey(args.locationId);
  if (!apiKey) return { success: false as const, error: "No AI API key configured." };

  const snapshot = getRequirementSnapshot(contact);
  const prompt = `You maintain client property requirements for a real-estate CRM.

Return JSON only:
{
  "hasChanges": boolean,
  "proposedPatch": {
    "requirementStatus": string|null,
    "requirementDistrict": string|null,
    "requirementBedrooms": string|null,
    "requirementMinPrice": string|null,
    "requirementMaxPrice": string|null,
    "requirementCondition": string|null,
    "requirementPropertyTypes": string[]|null,
    "requirementPropertyLocations": string[]|null,
    "requirementOtherDetails": string|null,
    "requirementSummary": string|null
  },
  "proposedSummary": string|null,
  "requirementAssessment": {
    "confirmedRequirements": string[],
    "possiblePreferences": string[],
    "historicalInquiries": string[],
    "changedOrContradicted": string[],
    "needsHumanClarification": string[]
  },
  "evidence": [{"sourceId": string, "quote": string, "field": string}],
  "confidence": number,
  "reasoning": string
}

Rules:
- Propose updates only when evidence clearly says the client's requirements changed or became more specific.
- Classify every meaningful signal into requirementAssessment:
  - confirmedRequirements: explicit current criteria from the client or agent notes/transcripts.
  - possiblePreferences: weak wording, one-off mentions, or preferences that are not firm.
  - historicalInquiries: properties/URLs/refs the client originally inquired about.
  - changedOrContradicted: evidence that replaces or conflicts with older requirements.
  - needsHumanClarification: unclear, missing, or conflicting criteria that should be asked about.
- Only confirmedRequirements may update hard CRM filter fields such as status, district, bedrooms, budget, condition, types, and locations.
- Treat evidence with interestSource=agent_sent_option as properties the agent/user sent to the client, not as contact interest.
- Never update hard CRM fields from agent_sent_option by itself. Use it only as "options already sent" context in summary/other details.
- Treat evidence with interestSource=client_inquired_property as contact-shown interest, but classify a one-property inquiry as historicalInquiries unless the client confirms it as a broader current requirement.
- Treat agent_note and transcript as usable requirement evidence only when they describe what the contact said or asked for.
- Put possiblePreferences, historicalInquiries, changedOrContradicted, and needsHumanClarification into requirementSummary or requirementOtherDetails instead of hard fields.
- Preserve useful history in requirementSummary, including original property inquiry and how preferences evolved.
- Use property evidence to understand what the client originally inquired about, what the agent already sent, and which properties were only system-resolved.
- If newer evidence contradicts older evidence, prefer the newer explicit client statement for hard fields and record the old signal in changedOrContradicted or historicalInquiries.
- If a property import is queued or unavailable, mention the reference/link in requirementSummary instead of inventing details.
- Do not erase existing requirements unless the evidence explicitly replaces them.
- Use concise field values compatible with CRM filters.`;

  const userContent = `Current contact requirements:
${JSON.stringify(snapshot, null, 2)}

Recent evidence:
${evidenceText.slice(-16000)}

Resolved property evidence:
${propertyEvidence.text || "None"}`;

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: settings.model,
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.1,
    },
  });
  const result = await model.generateContent([prompt, userContent]);
  const parsed = extractJsonObject(result.response.text());
  const proposedPatch = normalizePatch(parsed.proposedPatch || {});
  const requirementAssessment = normalizeRequirementAssessment(parsed.requirementAssessment);
  const proposedSummary = normalizeText(parsed.proposedSummary || proposedPatch.requirementSummary, 8000);
  if (proposedSummary && !proposedPatch.requirementSummary) {
    proposedPatch.requirementSummary = proposedSummary;
  }

  const usage = result.response.usageMetadata || {};
  const promptTokens = Number(usage.promptTokenCount || 0);
  const completionTokens = Number(usage.candidatesTokenCount || 0);
  const totalTokens = Number(usage.totalTokenCount || promptTokens + completionTokens);
  const estimatedCostUsd = calculateRunCost(settings.model, promptTokens, completionTokens);
  const hasMaterialChanges = Boolean(parsed.hasChanges && hasPatchChanges(snapshot, proposedPatch));

  if (!hasMaterialChanges) {
    await recordRequirementsIntelligenceUsage({
      locationId: args.locationId,
      contactId: contact.id,
      conversationId: args.conversationId || null,
      actorUserId: args.actorUserId || null,
      sourceType: args.sourceType || "manual",
      action: "assess_no_change",
      model: settings.model,
      promptTokens,
      completionTokens,
      totalTokens,
      estimatedCostUsd,
    });
    return { success: true as const, created: false as const, reason: "No requirement changes detected." };
  }

  const requirementAssessmentEvidence = {
    sourceId: "requirement_assessment",
    field: "requirementAssessment",
    quote: "Requirement signal classification",
    assessment: requirementAssessment,
  };
  const proposalEvidence = [
    requirementAssessmentEvidence,
    ...(Array.isArray(parsed.evidence) ? parsed.evidence : evidence.slice(-10)),
    ...propertyEvidence.items.map((item) => ({
      sourceId: item.publicReference || item.url || item.propertyId || "property_evidence",
      quote: item.title || item.url || item.reason || item.publicReference || "Property evidence resolved.",
      field: "propertyEvidence",
      status: item.status,
      propertyId: item.propertyId || null,
      publicReference: item.publicReference || null,
      oldCrmPropertyId: item.oldCrmPropertyId || null,
      url: item.url || null,
      interestSource: item.interestSource || null,
      sourceTextId: item.sourceTextId || null,
      extracted: item.extracted || null,
    })),
  ].slice(0, 20);
  const assessmentReasoning = formatRequirementAssessmentForReasoning(requirementAssessment);
  const reasoning = normalizeText([
    assessmentReasoning,
    parsed.reasoning,
  ].filter(Boolean).join("\n\n"), 4000);

  const proposal = await db.contactRequirementProposal.create({
    data: {
      locationId: args.locationId,
      contactId: contact.id,
      conversationId: args.conversationId || null,
      sourceType: args.sourceType || "manual",
      sourceIds: args.sourceIds || [],
      proposalType: "requirements",
      status: "pending",
      currentSnapshot: snapshot as any,
      proposedPatch: proposedPatch as any,
      proposedSummary,
      evidence: proposalEvidence,
      confidence: Number.isFinite(Number(parsed.confidence)) ? Number(parsed.confidence) : null,
      reasoning,
      model: settings.model,
      promptTokens,
      completionTokens,
      totalTokens,
      estimatedCostUsd,
    },
  });

  await recordRequirementsIntelligenceUsage({
    locationId: args.locationId,
    contactId: contact.id,
    conversationId: args.conversationId || null,
    actorUserId: args.actorUserId || null,
    sourceType: args.sourceType || "manual",
    proposalId: proposal.id,
    action: "generate_requirement_proposal",
    model: settings.model,
    promptTokens,
    completionTokens,
    totalTokens,
    estimatedCostUsd,
  });

  return { success: true as const, created: true as const, proposal };
}

export async function resolveContactPropertyEvidence(args: {
  locationId: string;
  contactId: string;
  conversationId?: string | null;
  actorUserId?: string | null;
  sourceType?: string;
}) {
  const contact = await db.contact.findFirst({
    where: { id: args.contactId, locationId: args.locationId },
    select: { id: true },
  });
  if (!contact) return { success: false as const, error: "Contact not found." };

  const evidence = await collectRequirementEvidence({
    locationId: args.locationId,
    contactId: contact.id,
    conversationId: args.conversationId || null,
  });
  const evidenceText = evidence.map(formatRequirementEvidenceLine).join("\n");
  const propertyEvidence = await resolvePropertyEvidenceForContactActivity({
    locationId: args.locationId,
    contactId: contact.id,
    conversationId: args.conversationId || null,
    actorUserId: args.actorUserId || null,
    text: evidenceText,
    evidence: toPropertyEvidenceInputs(evidence),
    source: args.sourceType || "manual_property_resolution",
  });

  return {
    success: true as const,
    count: propertyEvidence.items.length,
    items: propertyEvidence.items,
  };
}

export async function listPendingRequirementProposals(args: {
  locationId: string;
  contactId: string;
  limit?: number;
}) {
  return db.contactRequirementProposal.findMany({
    where: {
      locationId: args.locationId,
      contactId: args.contactId,
      proposalType: "requirements",
      status: "pending",
    },
    orderBy: { createdAt: "desc" },
    take: Math.max(1, Math.min(20, Number(args.limit || 5))),
  });
}

export async function approveRequirementProposal(args: {
  locationId: string;
  proposalId: string;
  actorUserId: string | null;
  editedPatch?: RequirementPatch | null;
}) {
  const proposal = await db.contactRequirementProposal.findFirst({
    where: { id: args.proposalId, locationId: args.locationId, proposalType: "requirements" },
    include: { contact: true },
  });
  if (!proposal) return { success: false as const, error: "Requirement proposal not found." };
  if (proposal.status !== "pending") return { success: false as const, error: `Cannot approve a ${proposal.status} proposal.` };

  const patch = normalizePatch(args.editedPatch || proposal.proposedPatch);
  const snapshot = getRequirementSnapshot(proposal.contact);
  if (!hasPatchChanges(snapshot, patch)) {
    await db.contactRequirementProposal.update({
      where: { id: proposal.id },
      data: { status: "superseded" },
    });
    return { success: true as const, updated: false as const };
  }

  const changes = getRequirementPatchChanges(snapshot, patch);
  const changedPatch = changes.reduce((data, change) => {
    (data as any)[change.field] = change.new;
    return data;
  }, {} as RequirementPatch);

  await db.$transaction(async (tx) => {
    await tx.contact.update({
      where: { id: proposal.contactId },
      data: changedPatch as any,
    });
    await tx.contactHistory.create({
      data: {
        contactId: proposal.contactId,
        userId: args.actorUserId,
        action: "AI_REQUIREMENTS_UPDATED",
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
        proposalType: "requirements",
        status: "pending",
      },
      data: { status: "superseded" },
    });
  });

  return { success: true as const, updated: true as const, contactId: proposal.contactId };
}

export async function rejectRequirementProposal(args: {
  locationId: string;
  proposalId: string;
  actorUserId: string | null;
  reason?: string | null;
}) {
  const proposal = await db.contactRequirementProposal.findFirst({
    where: { id: args.proposalId, locationId: args.locationId, proposalType: "requirements" },
    select: { id: true, status: true },
  });
  if (!proposal) return { success: false as const, error: "Requirement proposal not found." };
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

type RequirementsIntelligenceRunStatus = {
  status: "completed" | "failed" | "skipped";
  source: "cron" | "manual";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  mode: RequirementsIntelligenceMode;
  batchSize: number;
  stats: {
    locationsChecked: number;
    contactsTotal: number;
    contactsWithRecentActivity: number;
    contactsWithoutNewActivity: number;
    contactsChecked: number;
    skippedPending: number;
    proposalsCreated: number;
    noChanges: number;
    failures: number;
  };
  error?: string | null;
};

async function persistRequirementsIntelligenceRunStatus(args: {
  locationId: string;
  status: RequirementsIntelligenceRunStatus;
}) {
  const doc = await settingsService.getDocument<any>({
    scopeType: "LOCATION",
    scopeId: args.locationId,
    domain: SETTINGS_DOMAINS.LOCATION_AI,
  }).catch(() => null);
  if (!doc?.payload) return;

  const existingRequirements = doc.payload.requirementsIntelligence || {};
  await settingsService.upsertDocument({
    scopeType: "LOCATION",
    scopeId: args.locationId,
    domain: SETTINGS_DOMAINS.LOCATION_AI,
    payload: {
      ...doc.payload,
      requirementsIntelligence: {
        ...existingRequirements,
        lastRun: args.status,
      },
    },
    schemaVersion: doc.schemaVersion || 1,
  });
}

export async function runRequirementsIntelligenceCron(args?: {
  locationId?: string;
  batchSize?: number;
  now?: Date;
  source?: "cron" | "manual";
}) {
  const now = args?.now || new Date();
  const since = new Date(now.getTime() - 36 * 60 * 60 * 1000);
  const batchSize = Math.max(1, Math.min(100, Number(args?.batchSize || 40)));
  const source = args?.source || "cron";
  const locations = await db.location.findMany({
    where: args?.locationId ? { id: args.locationId } : {},
    select: { id: true },
    take: args?.locationId ? 1 : 200,
  });

  const stats = {
    locationsChecked: 0,
    contactsTotal: 0,
    contactsWithRecentActivity: 0,
    contactsWithoutNewActivity: 0,
    contactsChecked: 0,
    skippedPending: 0,
    proposalsCreated: 0,
    noChanges: 0,
    failures: 0,
  };

  for (const location of locations) {
    const locationStartedAt = new Date();
    const settings = await getRequirementsIntelligenceSettings(location.id);
    const locationStats = {
      locationsChecked: 0,
      contactsTotal: 0,
      contactsWithRecentActivity: 0,
      contactsWithoutNewActivity: 0,
      contactsChecked: 0,
      skippedPending: 0,
      proposalsCreated: 0,
      noChanges: 0,
      failures: 0,
    };

    if (settings.mode !== "daily_and_new_activity") {
      await persistRequirementsIntelligenceRunStatus({
        locationId: location.id,
        status: {
          status: "skipped",
          source,
          startedAt: locationStartedAt.toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs: Date.now() - locationStartedAt.getTime(),
          mode: settings.mode,
          batchSize,
          stats: locationStats,
          error: "Requirements Intelligence mode is not daily_and_new_activity.",
        },
      });
      continue;
    }
    stats.locationsChecked += 1;
    locationStats.locationsChecked += 1;

    const recentActivityWhere = {
      locationId: location.id,
      contactType: { in: ["Lead", "Contact"] },
      OR: [
        { conversations: { some: { lastMessageAt: { gte: since } } } },
        { history: { some: { createdAt: { gte: since } } } },
      ],
    } as const;

    const [totalContacts, contactsWithRecentActivity] = await Promise.all([
      db.contact.count({
        where: {
          locationId: location.id,
          contactType: { in: ["Lead", "Contact"] },
        },
      }),
      db.contact.count({
        where: recentActivityWhere,
      }),
    ]);
    const contactsWithoutNewActivity = Math.max(0, totalContacts - contactsWithRecentActivity);
    stats.contactsTotal += totalContacts;
    stats.contactsWithRecentActivity += contactsWithRecentActivity;
    stats.contactsWithoutNewActivity += contactsWithoutNewActivity;
    locationStats.contactsTotal = totalContacts;
    locationStats.contactsWithRecentActivity = contactsWithRecentActivity;
    locationStats.contactsWithoutNewActivity = contactsWithoutNewActivity;

    const contactRows = await db.contact.findMany({
      where: recentActivityWhere,
      select: {
        id: true,
        conversations: {
          orderBy: { lastMessageAt: "desc" },
          take: 1,
          select: { id: true },
        },
        requirementProposals: {
          where: { status: "pending" },
          take: 1,
          select: { id: true },
        },
      },
      take: batchSize,
    });

    for (const contact of contactRows) {
      stats.contactsChecked += 1;
      locationStats.contactsChecked += 1;
      if (contact.requirementProposals.length > 0) {
        stats.skippedPending += 1;
        locationStats.skippedPending += 1;
        continue;
      }
      try {
        const result = await generateRequirementProposal({
          locationId: location.id,
          contactId: contact.id,
          conversationId: contact.conversations[0]?.id || null,
          sourceType: "cron",
        });
        if (result.success && result.created) stats.proposalsCreated += 1;
        else if (result.success) stats.noChanges += 1;
        else stats.failures += 1;
        if (result.success && result.created) locationStats.proposalsCreated += 1;
        else if (result.success) locationStats.noChanges += 1;
        else locationStats.failures += 1;
      } catch (error) {
        stats.failures += 1;
        locationStats.failures += 1;
        console.error("[requirements-intelligence:cron] Contact failed:", contact.id, error);
      }
    }

    await persistRequirementsIntelligenceRunStatus({
      locationId: location.id,
      status: {
        status: locationStats.failures > 0 ? "failed" : "completed",
        source,
        startedAt: locationStartedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - locationStartedAt.getTime(),
        mode: settings.mode,
        batchSize,
        stats: locationStats,
        error: locationStats.failures > 0 ? `${locationStats.failures} contact(s) failed.` : null,
      },
    });
  }

  return stats;
}

export function queueRequirementProposalForNewActivity(args: {
  locationId: string;
  contactId: string;
  conversationId?: string | null;
  sourceType: "message" | "activity_note" | "transcript";
  sourceIds?: string[];
  actorUserId?: string | null;
}) {
  void (async () => {
    const settings = await getRequirementsIntelligenceSettings(args.locationId);
    if (settings.mode !== "new_activity" && settings.mode !== "daily_and_new_activity") return;
    await generateRequirementProposal({
      locationId: args.locationId,
      contactId: args.contactId,
      conversationId: args.conversationId || null,
      sourceType: args.sourceType,
      sourceIds: args.sourceIds || [],
      actorUserId: args.actorUserId || null,
    });
  })().catch((error) => {
    console.error("[requirements-intelligence:new-activity] Failed:", error);
  });
}
