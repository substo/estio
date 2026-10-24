/** A location-scoped impersonation cannot open another location's Studio. */
export function isStudioLocationAllowedForSession(input: {
  locationId: string;
  isImpersonating: boolean;
  impersonationLocationId: string | null;
}): boolean {
  if (!input.locationId) return false;
  if (!input.isImpersonating) return true;
  return Boolean(input.impersonationLocationId && input.locationId === input.impersonationLocationId);
}
