import "server-only";
import { redirect } from "next/navigation";
import { resolveTenantContext } from "@/lib/auth/tenant-context";

export class StudioTenantContextError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

/** Location is the only selected tenant. The legacy UUID is a private storage adapter key. */
export async function studioRouteParams<T>(params: Promise<T>, request?: Request): Promise<T & { workspaceId: string }> {
  try {
    const tenantId = request?.headers.get("X-Studio-Tenant");
    if (request && !["GET", "HEAD"].includes(request.method) && !tenantId) throw new StudioTenantContextError(409, "Reload Studio before submitting this command.");
    if (tenantId && tenantId.length > 255) throw new StudioTenantContextError(400, "Invalid tenant context.");
    const context = await resolveTenantContext();
    if (!context || context.resolution.status !== "authorized") throw new StudioTenantContextError(403, "Select a location you can access.");
    if (tenantId && tenantId !== context.resolution.location?.id) throw new StudioTenantContextError(409, "The selected location changed. Reload Studio before submitting.");
    if (!context.workspaceId) throw new StudioTenantContextError(409, "Open Studio overview to initialize this location.");
    return { ...await params, workspaceId: context.workspaceId };
  } catch (error) {
    if (!request && error instanceof StudioTenantContextError) redirect("/studio/select");
    throw error;
  }
}

export function withStudioRoute<T, R extends Request>(handler: (request: R, context: { params: Promise<T> }) => Promise<Response>) {
  return async (request: R, context: { params: Promise<T> }) => {
    try { return await handler(request, context); }
    catch (error) {
      if (error instanceof StudioTenantContextError) return Response.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
      throw error;
    }
  };
}
