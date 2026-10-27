import { resolveActiveLocation } from "@/lib/auth/active-location";
import { studioProviderRestricted } from "@/lib/studio/rest";
export async function GET() {
  const resolution = await resolveActiveLocation();
  // studioUnavailable is this process's provider backoff state; it makes no Studio database call.
  return Response.json({ locationId: resolution.location?.id ?? null, studioUnavailable: studioProviderRestricted() }, { status: resolution.status === "unauthenticated" ? 401 : 200, headers: { "Cache-Control": "private, no-store" } });
}
