import { studioRouteParams, withStudioRoute } from "@/lib/studio/route-context";
import { readYoutubeRequestText } from "@/lib/google/youtube-request";
import { NextRequest } from "next/server";
import { getPlatformProfile } from "@/lib/platform/profile";
import { YoutubeError } from "@/lib/google/youtube-api";
import { browseStudioYoutube, manageStudioYoutubeChannel, saveStudioYoutubeLink } from "@/lib/studio/youtube";
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
    if (body.action === "save") return json({ recordId: await saveStudioYoutubeLink(locationId, body) });
    if (body.action === "channel") { const channelId = await manageStudioYoutubeChannel(locationId, body); return json({ ok: true, channelId }); }
    return json({ error: "Unknown action." }, 400);
  } catch (error) {
    if (error instanceof YoutubeError) return json({ error: error.message, code: error.code }, error.code === "access_denied" ? 403 : error.code === "request_too_large" ? 413 : 400);
    return json({ error: "Discovery could not complete. Check your profile connection or API configuration and try again." }, 400);
  }
}

export const POST = withStudioRoute(POSTHandler);
