import { resolveActiveLocation } from "@/lib/auth/active-location";
export async function GET() {
  const resolution = await resolveActiveLocation();
  return Response.json({ locationId: resolution.location?.id ?? null }, { status: resolution.status === "unauthenticated" ? 401 : 200, headers: { "Cache-Control": "private, no-store" } });
}
