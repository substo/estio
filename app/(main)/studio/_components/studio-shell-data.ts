import "server-only";
import { auth } from "@clerk/nextjs/server";
import { resolveTenantContext } from "@/lib/auth/tenant-context";
import { getImpersonationContextFromAuth } from "@/lib/auth/impersonation";

/** The explicit workspace wins over last-used cookies throughout the shell. */
export async function getStudioShellData(input: { workspaceId?: string; locationId?: string } = {}) {
  const context = await resolveTenantContext(input);
  if (!context) return null;
  const { app, resolution, workspaceId } = context;
  const state = await auth();
  const impersonation = state.actor ? await getImpersonationContextFromAuth({ userId: state.userId, sessionId: state.sessionId, actor: state.actor }) : null;
  return {
    app,
    brands: resolution.availableLocations.map((location) => ({ id: location.id, name: location.name || (app === "substo" ? "Unnamed brand" : "Unnamed location") })),
    activeBrandId: resolution.location?.id ?? null,
    fallbackWorkspaceId: workspaceId,
    impersonation: impersonation ? { targetName: impersonation.targetName, targetEmail: impersonation.targetEmail, locationName: impersonation.locationName, sessionId: impersonation.sessionId } : null,
  };
}
