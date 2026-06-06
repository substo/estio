import db from "@/lib/db";
import { securelyRecordAiUsage } from "@/lib/ai/usage-metering";
import {
  buildCanonicalContactName,
  extractPropertyRefsFromLeadText,
  hasContactPersonNameNoise,
  inferLeadContactRoleFromSignals,
  normalizeWhitespace,
  parseContactPersonNameFromDisplayName,
} from "@/lib/contacts/name-builder";
import {
  profileVerificationFields,
  withProfileVerificationInvalidation,
} from "@/lib/contacts/profile-verification";

type AnyRecord = Record<string, any>;

const CONTACT_VERIFICATION_MODEL = "contact-profile-name-agent-v1";
const CONTACT_VERIFICATION_PROVIDER = "deterministic";

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

export type ContactVerificationStatus =
  | "verified_lead"
  | "needs_review"
  | "likely_agent"
  | "likely_owner"
  | "not_a_lead";

export type ContactVerificationPatch = Partial<Record<typeof VERIFICATION_FIELDS[number], string | null>>;

function normalizeText(value: unknown, max = 4000): string | null {
  const normalized = String(value || "").trim();
  return normalized ? normalized.slice(0, max) : null;
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

  const normalizedPatch = normalizeContactVerificationPatch(patch);
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
  const assessment = buildContactVerificationAssessment({ contact, recentMessages });
  const assessmentMs = Date.now() - assessmentStartedAt;

  void securelyRecordAiUsage({
    locationId: args.locationId,
    userId: args.actorUserId || null,
    resourceType: "contact",
    resourceId: contact.id,
    featureArea: "contact_verification",
    action: "profile_scan",
    provider: CONTACT_VERIFICATION_PROVIDER,
    model: CONTACT_VERIFICATION_MODEL,
    inputTokens: 0,
    outputTokens: 0,
    metadata: {
      conversationId: args.conversationId || null,
      sourceType: args.sourceType || "manual_verification",
      status: assessment.status,
      inferredRole: assessment.inferredRole,
      hasChanges: assessment.hasChanges,
      recentMessageCount: recentMessages.length,
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
      model: CONTACT_VERIFICATION_MODEL,
      provider: CONTACT_VERIFICATION_PROVIDER,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    });
    return { success: true as const, created: false as const, reason: assessment.reasoning, assessment };
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
      model: CONTACT_VERIFICATION_MODEL,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: 0,
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
    model: CONTACT_VERIFICATION_MODEL,
    provider: CONTACT_VERIFICATION_PROVIDER,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  });

  return { success: true as const, created: true as const, proposal, assessment };
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
  return { success: true as const, contactId: contact.id };
}
