import { getHostBrandConfig, resolveHostBrand } from "@/lib/auth/host-brand";
import { deviceOperations, readDeviceCommand, type DeviceOperation } from "@/lib/studio/devices-policy";
import { executeStudioDeviceCommand } from "@/lib/studio/devices";
import { DEVICE_COMPLETE_BODY_LIMIT, DEVICE_BODY_LIMIT, deviceError, deviceJson, readDeviceJson } from "@/lib/studio/devices-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request, { params }: { params: Promise<{ operation: string }> }) {
  try {
    const { operation } = await params;
    if (!deviceOperations.includes(operation as DeviceOperation)) return deviceJson({ ok: false, error: "Not found." }, 404);
    const brand = resolveHostBrand(request.headers.get("host"), getHostBrandConfig());
    const token = request.headers.get("authorization")?.match(/^Bearer (studio_device_[A-Za-z0-9_-]{43})$/)?.[1];
    if (!token || brand === "tenant") return deviceJson({ ok: false, error: "Device authentication required." }, 401);
    const body = readDeviceCommand(operation as DeviceOperation, await readDeviceJson(request, operation === "complete" ? DEVICE_COMPLETE_BODY_LIMIT : DEVICE_BODY_LIMIT));
    return deviceJson({ ok: true, data: await executeStudioDeviceCommand(token, brand, operation as DeviceOperation, body) });
  } catch (error) { return deviceError(error); }
}
