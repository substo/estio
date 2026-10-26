import { getPlatformProfile } from "@/lib/platform/profile";
import { studioRouteParams, StudioTenantContextError } from "@/lib/studio/route-context";
import { executeStudioDeviceManagement, getStudioDevices } from "@/lib/studio/devices";
import { readDeviceManagementCommand } from "@/lib/studio/devices-policy";
import { deviceError, deviceJson, readDeviceJson } from "@/lib/studio/devices-http";
export const dynamic = "force-dynamic";
/** Current device summaries for the active Business (members may read; used for live command status). */
export async function GET(request: Request) {
  try {
    const profile = await getPlatformProfile();
    if (!profile) return deviceJson({ ok: false, error: "Sign in as yourself." }, 401);
    const { workspaceId } = await studioRouteParams(Promise.resolve({}), request);
    const result = await getStudioDevices(workspaceId);
    if (!result) return deviceJson({ ok: false, error: "Access denied." }, 403);
    return deviceJson({ ok: true, data: result });
  } catch (error) {
    if (error instanceof StudioTenantContextError) return deviceJson({ ok: false, error: error.message }, error.status);
    return deviceError(error);
  }
}
/** Manager actions against the active Business; approving a pairing binds the computer to it. */
export async function POST(request: Request) {
  try {
    const profile = await getPlatformProfile();
    if (!profile) return deviceJson({ ok: false, error: "Sign in as yourself." }, 401);
    if (request.headers.get("origin") !== profile.origin) return deviceJson({ ok: false, error: "Forbidden." }, 403);
    const { workspaceId } = await studioRouteParams(Promise.resolve({}), request);
    const command = readDeviceManagementCommand(await readDeviceJson(request));
    return deviceJson({ ok: true, data: await executeStudioDeviceManagement(workspaceId, command) });
  } catch (error) {
    if (error instanceof StudioTenantContextError) return deviceJson({ ok: false, error: error.message }, error.status);
    return deviceError(error);
  }
}
