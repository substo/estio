export const IMPERSONATION_REASON_MIN_LENGTH = 10;
export const IMPERSONATION_REASON_MAX_LENGTH = 500;

export type ActorClaim = { sub?: unknown; [key: string]: unknown } | null | undefined;

export function normalizeSupportReason(value: unknown): string | null {
  const reason = String(value ?? "").trim().replace(/\s+/g, " ");
  if (reason.length < IMPERSONATION_REASON_MIN_LENGTH || reason.length > IMPERSONATION_REASON_MAX_LENGTH) return null;
  return reason;
}

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

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const SENSITIVE_READ_PREFIXES = [
  "/admin/team",
  "/admin/settings",
  "/admin/site-settings",
  "/admin/user-profile",
  "/api/google",
  "/api/microsoft",
  "/api/oauth",
];

export function isRestrictedImpersonationRequest(pathname: string, method: string): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/api/platform/impersonation/activate" || path === "/api/platform/impersonation/end") return false;
  if (SENSITIVE_READ_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) return true;
  if (!READ_METHODS.has(method.toUpperCase()) && (path === "/admin" || path.startsWith("/admin/") || path === "/api" || path.startsWith("/api/"))) return true;
  return false;
}
