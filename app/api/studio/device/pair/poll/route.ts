import { getHostBrandConfig, resolveHostBrand } from "@/lib/auth/host-brand";
import { readDevicePairPoll } from "@/lib/studio/devices-policy";
import { pollStudioDevicePairing } from "@/lib/studio/devices";
import { deviceError, deviceJson, limitDeviceRequest, readDeviceJson } from "@/lib/studio/devices-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** The device code proves the poller started this pairing; the token is returned once, never stored in plain text. */
export async function POST(request: Request) {
  try {
    const brand = resolveHostBrand(request.headers.get("host"), getHostBrandConfig());
    if (brand === "tenant") return deviceJson({ ok: false, error: "Not found." }, 404);
    limitDeviceRequest(request, "pair-poll", 120, 60_000);
    const input = readDevicePairPoll(await readDeviceJson(request));
    return deviceJson({ ok: true, data: await pollStudioDevicePairing(brand, input) });
  } catch (error) { return deviceError(error); }
}
