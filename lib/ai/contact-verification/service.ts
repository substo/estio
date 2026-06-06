import db from "@/lib/db";
import {
  buildCanonicalContactName,
  extractPropertyRefsFromLeadText,
  inferLeadContactRoleFromSignals,
  normalizeWhitespace,
} from "@/lib/contacts/name-builder";

type AnyRecord = Record<string, any>;

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
  | "not_searching";

export type ContactVerificationPatch = Partial<Record<typeof VERIFICATION_FIELDS[number], string | null>>;

function normalizeText(value: unknown, max = 4000): string | null {
  const normalized = String(value || "").trim();
  return normalized ? normalized.slice(0, max) : null;
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
  if (patch.qualificationStage === "not_a_lead") return "not_searching";
  if ((patch.contactType || contact.contactType) === "Lead" && ["To Buy", "To Rent"].includes(String(patch.leadGoal || contact.leadGoal || ""))) {
    return "verified_lead";
  }
  return "needs_review";
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
    evidence.push({
      sourceId: "lead_verification",
      field: "contactType",
      quote: "Contact type and lead goal are consistent with buyer/renter outreach.",
    });
  } else if (NON_LEAD_CONTACT_TYPES.has(String(args.contact.contactType || ""))) {
    if (args.contact.leadGoal) patch.leadGoal = null;
    if (args.contact.qualificationStage !== "not_a_lead") patch.qualificationStage = "not_a_lead";
    evidence.push({
      sourceId: "stored_contact_type",
      field: "contactType",
      quote: `Stored contact type is ${args.contact.contactType}.`,
    });
  }

  const normalizedPatch = normalizeContactVerificationPatch(patch);
  const status = verificationStatusForPatch(normalizedPatch, inferredRole, args.contact);
  const reasoning = status === "verified_lead"
    ? "Contact fields are consistent with a buyer/renter lead."
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
}) {
  const contact = await db.contact.findFirst({
    where: { id: args.contactId, locationId: args.locationId },
  });
  if (!contact) return { success: false as const, error: "Contact not found." };

  const pendingProposal = await db.contactRequirementProposal.findFirst({
    where: {
      locationId: args.locationId,
      contactId: contact.id,
      proposalType: "verification",
      status: "pending",
    },
    select: { id: true },
  });
  if (pendingProposal) {
    return { success: true as const, created: false as const, reason: "A pending contact verification proposal already exists." };
  }

  const recentMessages = await collectRecentMessages({
    locationId: args.locationId,
    contactId: contact.id,
    conversationId: args.conversationId || null,
  });
  const assessment = buildContactVerificationAssessment({ contact, recentMessages });
  if (!assessment.hasChanges) {
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
    },
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
  if (changes.length === 0) {
    await db.contactRequirementProposal.update({
      where: { id: proposal.id },
      data: { status: "superseded" },
    });
    return { success: true as const, updated: false as const };
  }

  const changedPatch = changes.reduce((data, change) => {
    (data as AnyRecord)[change.field] = change.new;
    return data;
  }, {} as ContactVerificationPatch);

  await db.$transaction(async (tx) => {
    await tx.contact.update({
      where: { id: proposal.contactId },
      data: changedPatch as any,
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
  await db.contactHistory.create({
    data: {
      contactId: contact.id,
      userId: args.actorUserId,
      action: "CONTACT_VERIFIED",
      changes: { qualificationStage: contact.qualificationStage || null } as any,
    },
  });
  await db.contactRequirementProposal.updateMany({
    where: { contactId: contact.id, proposalType: "verification", status: "pending" },
    data: { status: "superseded" },
  });
  return { success: true as const, contactId: contact.id };
}
