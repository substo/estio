import { studioRouteParams, withStudioRoute } from "@/lib/studio/route-context";
import { readYoutubeRequestText } from "@/lib/google/youtube-request";
import { NextRequest } from "next/server";
import { getPlatformProfile } from "@/lib/platform/profile";
import { YoutubeError } from "@/lib/google/youtube-api";
import { browseStudioRelatedYoutube, readStudioRelatedYoutube, browseStudioYoutube, manageStudioYoutubeChannel, saveStudioRelatedYoutube, saveStudioYoutubeLink } from "@/lib/studio/youtube";
import { enqueueVideoTranscription, videoRequestKey } from "@/lib/studio/video-transcription";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
async function POSTHandler(request: NextRequest, { params }: { params: Promise<{  }> }) {
  const profile = await getPlatformProfile(); if (!profile) return json({ error: "Sign in as yourself." }, 401);
  if (request.headers.get("origin") !== profile.origin) return json({ error: "Forbidden" }, 403);
  const { locationId } = await studioRouteParams(params, request);
  try {
    const text = await readYoutubeRequestText(request);
    const body = JSON.parse(text); if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Invalid request." }, 400);
    if (body.action === "browse") return json(await browseStudioYoutube(locationId, body));
    if (body.action === "related") return json(await browseStudioRelatedYoutube(locationId, body));
    if (body.action === "relatedStatus") return json(await readStudioRelatedYoutube(locationId, body));
    if (body.action === "save" || body.action === "saveRelated") {
      const recordId = body.action === "saveRelated" ? await saveStudioRelatedYoutube(locationId, body) : await saveStudioYoutubeLink(locationId, body);
      // Choosing a result is explicit: the same paired-Mac transcription job as a pasted link. Never a paid fallback.
      const transcription = await enqueueVideoTranscription(locationId, { recordId, origin: "search", requestKey: videoRequestKey("search", recordId, String(body.ticket ?? "")) })
        .catch(() => ({ status: "not_queued" as const, reason: "no_authority" as const, message: "Transcription could not be requested. Use Transcribe on your Mac from the source page." }));
      return json({ recordId, transcription });
    }
    if (body.action === "channel") { const channelId = await manageStudioYoutubeChannel(locationId, body); return json({ ok: true, channelId }); }
    return json({ error: "Unknown action." }, 400);
  } catch (error) {
    if (error instanceof YoutubeError) return json({ error: error.message, code: error.code }, error.code === "access_denied" ? 403 : error.code === "request_too_large" ? 413 : 400);
    return json({ error: "Discovery could not complete. Check your profile connection or API configuration and try again." }, 400);
  }
}

export const POST = withStudioRoute(POSTHandler);
