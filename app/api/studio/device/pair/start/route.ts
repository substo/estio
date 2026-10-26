import { getHostBrandConfig, getHostOrigin, resolveHostBrand } from "@/lib/auth/host-brand";
import { readDevicePairStart } from "@/lib/studio/devices-policy";
import { startStudioDevicePairing } from "@/lib/studio/devices";
import { deviceError, deviceJson, limitDeviceRequest, readDeviceJson } from "@/lib/studio/devices-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Unauthenticated: a computer asks to pair; a Business admin approves it in the browser. */
export async function POST(request: Request) {
  try {
    const host = request.headers.get("host");
    const brand = resolveHostBrand(host, getHostBrandConfig()); const origin = getHostOrigin(host);
    if (brand === "tenant" || !origin) return deviceJson({ ok: false, error: "Not found." }, 404);
    limitDeviceRequest(request, "pair-start", 10, 10 * 60_000);
    const input = readDevicePairStart(await readDeviceJson(request));
    return deviceJson({ ok: true, data: await startStudioDevicePairing(brand, origin, input) });
  } catch (error) { return deviceError(error); }
}
