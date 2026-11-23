import { isAllowedRequestOrigin } from "@/lib/auth/request-origin-policy";

/** Browser mutations need a serialized same-site Origin (the shared proxy-aware policy), as the library import route requires. */
export function originVerified(request: Request): boolean {
  const origin = request.headers.get("origin"), requestOrigin = new URL(request.url).origin;
  if (!origin || request.headers.get("sec-fetch-site") === "cross-site" || !/^https?:\/\//.test(origin)) return false;
  try { if (new URL(origin).origin !== origin) return false; } catch { return false; }
  return isAllowedRequestOrigin({ origin, requestOrigin, appUrl: requestOrigin, host: request.headers.get("host"),
    forwardedHost: request.headers.get("x-forwarded-host"), forwardedProto: request.headers.get("x-forwarded-proto") });
}
