import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export type OffboardingMode = "TRANSFER" | "KEEP_ASSIGNED";

export type OffboardingResponsibilityCounts = {
  assignedContacts: number;
  inheritedConversations: number;
  activeAssignedDeals: number;
  activeUnassignedDeals: number;
  openTasks: number;
  nonTerminalViewingSessions: number;
  futureActionableViewings: number;
};

export type OffboardingConfirmationPayload = {
  confirmationId: string;
  actorUserId: string;
  locationId: string;
  sourceUserId: string;
  successorUserId: string | null;
  sourceClerkId: string;
  successorClerkId: string | null;
  sourceEmail: string;
  successorEmail: string | null;
  mode: OffboardingMode;
  suspendClerkGlobally: boolean;
  previewFingerprint: string;
  responsibilityCutoff: string;
  issuedAt: number;
};

const MAX_AGE_MS = 15 * 60 * 1000;

function secret(): string {
  return String(process.env.OFFBOARDING_CONFIRMATION_SECRET || "").trim();
}

export function isOffboardingExecutionConfigured(): boolean {
  return secret().length >= 32;
}

export function createOffboardingPreviewFingerprint(input: {
  locationId: string;
  sourceUserId: string;
  successorUserId: string | null;
  mode: OffboardingMode;
  suspendClerkGlobally: boolean;
  counts: OffboardingResponsibilityCounts;
}): string {
  const canonical = {
    locationId: input.locationId,
    sourceUserId: input.sourceUserId,
    successorUserId: input.successorUserId,
    mode: input.mode,
    suspendClerkGlobally: input.suspendClerkGlobally,
    counts: {
      assignedContacts: input.counts.assignedContacts,
      inheritedConversations: input.counts.inheritedConversations,
      activeAssignedDeals: input.counts.activeAssignedDeals,
      activeUnassignedDeals: input.counts.activeUnassignedDeals,
      openTasks: input.counts.openTasks,
      nonTerminalViewingSessions: input.counts.nonTerminalViewingSessions,
      futureActionableViewings: input.counts.futureActionableViewings,
    },
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("base64url");
}

export function createOffboardingConfirmationToken(payload: OffboardingConfirmationPayload): string | null {
  const key = secret();
  if (key.length < 32) return null;
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", key).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export function verifyOffboardingConfirmationToken(token: string, now = Date.now()): OffboardingConfirmationPayload {
  const key = secret();
  if (key.length < 32) throw new Error("Offboarding execution is not configured");
  const [encoded, signature, extra] = String(token || "").split(".");
  if (!encoded || !signature || extra) throw new Error("Invalid confirmation token");
  const expected = createHmac("sha256", key).update(encoded).digest("base64url");
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) throw new Error("Invalid confirmation token");
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as OffboardingConfirmationPayload;
  const validMode = payload.mode === "TRANSFER" || payload.mode === "KEEP_ASSIGNED";
  const validSuccessor = payload.mode === "KEEP_ASSIGNED" || Boolean(payload.successorUserId && payload.successorClerkId && payload.successorEmail);
  if (!payload.confirmationId || !payload.actorUserId || !payload.locationId || !payload.sourceUserId || !payload.sourceClerkId || !validMode || !validSuccessor || typeof payload.suspendClerkGlobally !== "boolean" || !payload.previewFingerprint || !Number.isFinite(Date.parse(payload.responsibilityCutoff))) {
    throw new Error("Invalid confirmation token");
  }
  if (!Number.isFinite(payload.issuedAt) || now - payload.issuedAt > MAX_AGE_MS || payload.issuedAt > now + 60_000) {
    throw new Error("Confirmation preview expired; build a new preview");
  }
  return payload;
}

export function requiredOffboardingPhrase(mode: OffboardingMode, sourceEmail: string): string {
  const email = sourceEmail.trim().toLowerCase();
  return mode === "TRANSFER"
    ? `TRANSFER AND REMOVE ACCESS ${email}`
    : `KEEP ASSIGNED AND REMOVE ACCESS ${email}`;
}
