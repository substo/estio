import { isAllowedRequestOrigin } from "@/lib/auth/request-origin-policy";
import { z } from "zod";
import { studioRouteParams, withStudioRoute } from "@/lib/studio/route-context";
import { requestSourceTranscription } from "@/lib/studio/source-transcription";
import { toStudioDbError } from "@/lib/studio/db";
const schema = z.object({ recordId: z.string().uuid() }).strict();
export const dynamic = "force-dynamic";
/** Person-triggered: transcribe (or retry / confirm) one saved YouTube source on the requester's own paired Mac. */
export const POST = withStudioRoute(async (request, { params }) => {
  const respond = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
  const origin = request.headers.get("origin"); const requestOrigin = new URL(request.url).origin;
  if (!origin || request.headers.get("sec-fetch-site") === "cross-site" || !/^https?:\/\//.test(origin) || (() => { try { return new URL(origin).origin !== origin; } catch { return true; } })() ||
    !isAllowedRequestOrigin({ origin, requestOrigin, appUrl: requestOrigin, host: request.headers.get("host"), forwardedHost: request.headers.get("x-forwarded-host"), forwardedProto: request.headers.get("x-forwarded-proto") }))
    return respond({ error: "The request origin could not be verified. Reload Studio and try again." }, 403);
  const { locationId } = await studioRouteParams(params, request);
  try {
    const text = await request.text();
    if (text.length > 512) return respond({ error: "Request is too large." }, 413);
    const parsed = schema.safeParse(JSON.parse(text));
    if (!parsed.success) return respond({ error: "Choose a saved video source." }, 400);
    return respond(await requestSourceTranscription(locationId, parsed.data.recordId, "user"));
  } catch (error) {
    if (error instanceof SyntaxError) return respond({ error: "Invalid request." }, 400);
    const failure = toStudioDbError(error);
    return respond({ error: failure.status === 403 || failure.code === "42501" ? "Studio access denied." : "Transcription could not be requested. Try again later." }, failure.status === 403 || failure.code === "42501" ? 403 : 503);
  }
});
