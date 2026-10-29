import { getHostBrandConfig, getHostOrigin, resolveHostBrand } from "@/lib/auth/host-brand";
import { studioDeviceBrand } from "@/lib/studio/device-brand";
import { deviceJson } from "@/lib/studio/devices-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Unauthenticated: the Studio Mac app learns which app (Estio or Substo) this site is. */
export function GET(request: Request) {
  const host = request.headers.get("host");
  const data = studioDeviceBrand(resolveHostBrand(host, getHostBrandConfig()), getHostOrigin(host));
  return data ? deviceJson({ ok: true, data }) : deviceJson({ ok: false, error: "Not found." }, 404);
}
