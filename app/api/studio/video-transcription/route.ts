import { z } from "zod";
import { isAllowedRequestOrigin } from "@/lib/auth/request-origin-policy";
import { studioRouteParams, withStudioRoute } from "@/lib/studio/route-context";
import { enqueueVideoTranscription } from "@/lib/studio/video-transcription";
import { StudioCommandError } from "@/lib/studio/command-error";
const schema = z.object({ recordId: z.string().uuid(), requestKey: z.string().uuid() }).strict();
export const dynamic = "force-dynamic";
/** Explicit owner action: transcribe (or re-run, or confirm a suggestion) on the Account's own paired Mac. */
export const POST = withStudioRoute(async (request, { params }) => {
  const origin = request.headers.get("origin"); const requestOrigin = new URL(request.url).origin;
  if (!origin || request.headers.get("sec-fetch-site") === "cross-site" || !isAllowedRequestOrigin({ origin, requestOrigin, appUrl: requestOrigin, host: request.headers.get("host"),
    forwardedHost: request.headers.get("x-forwarded-host"), forwardedProto: request.headers.get("x-forwarded-proto") }))
    return Response.json({ error: "Request origin could not be verified." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  const { locationId } = await studioRouteParams(params, request);
  const text = await request.text();
  const parsed = text.length <= 1024 ? schema.safeParse(JSON.parse(text || "null")) : null;
  if (!parsed?.success) return Response.json({ error: "Invalid request." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  try {
    const result = await enqueueVideoTranscription(locationId, { recordId: parsed.data.recordId, origin: "suggestion", requestKey: `ui:${parsed.data.requestKey}` });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof StudioCommandError ? error.status : 503;
    return Response.json({ error: status === 403 ? "Studio access denied." : "Transcription could not be requested. Try again." }, { status, headers: { "Cache-Control": "no-store" } });
  }
});
