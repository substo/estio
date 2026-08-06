export type ActorClaim = { sub?: unknown; [key: string]: unknown } | null | undefined;

export function extractImpersonationClaim(actor: ActorClaim): {
  actorClerkId: string;
  auditId: string;
  locationId: string;
} | null {
  if (!actor || typeof actor !== "object") return null;
  const nested = actor.additionalProperties;
  const extra = nested && typeof nested === "object" ? nested as Record<string, unknown> : {};
  const actorClerkId = String(actor.sub ?? "").trim();
  const auditId = String(actor.auditId ?? extra.auditId ?? "").trim();
  const locationId = String(actor.locationId ?? extra.locationId ?? "").trim();
  return actorClerkId && auditId && locationId ? { actorClerkId, auditId, locationId } : null;
}

export function identitiesAgree(input: {
  authenticatedClerkId: string;
  localClerkId: string | null | undefined;
  localEmail: string;
  clerkEmail: string | null | undefined;
}): boolean {
  const localEmail = input.localEmail.trim().toLowerCase();
  const clerkEmail = String(input.clerkEmail ?? "").trim().toLowerCase();
  return Boolean(
    input.authenticatedClerkId
    && input.localClerkId === input.authenticatedClerkId
    && localEmail
    && clerkEmail
    && localEmail === clerkEmail
  );
}
