import "server-only";
import { auth } from "@clerk/nextjs/server";
import { resolveTenantContext } from "@/lib/auth/tenant-context";
import { resolveActiveLocation } from "@/lib/auth/active-location";
import { getRequestAuthRealm } from "@/lib/auth/request-realm";
import { getImpersonationContextFromAuth } from "@/lib/auth/impersonation";
import { getAppShellData } from "@/components/app-shell/app-shell-data";
import { isStudioProviderUnavailable } from "@/lib/studio/rest";

/** The explicit workspace wins over last-used cookies throughout the shell. */
export async function getStudioShellData(input: { workspaceId?: string; locationId?: string } = {}) {
  let context: Awaited<ReturnType<typeof resolveTenantContext>>;
  try { context = await resolveTenantContext(input); }
  catch (error) {
    // Studio's database is restricted: keep the shell (header, Location, CRM switch) from the CRM alone.
    if (!isStudioProviderUnavailable(error)) throw error;
    const app = await getRequestAuthRealm();
    context = app === "estio" || app === "substo" ? { app, resolution: await resolveActiveLocation(), workspaceId: null } : null;
  }
  if (!context) return null;
  const { app, resolution, workspaceId } = context;
  const state = await auth();
  const impersonation = state.actor ? await getImpersonationContextFromAuth({ userId: state.userId, sessionId: state.sessionId, actor: state.actor }) : null;
  return getAppShellData({
    app,
    resolution,
    workspaceId,
    impersonation: impersonation ? { targetName: impersonation.targetName, targetEmail: impersonation.targetEmail, locationName: impersonation.locationName, sessionId: impersonation.sessionId } : null,
  });
}
