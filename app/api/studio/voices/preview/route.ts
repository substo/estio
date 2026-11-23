import { studioRouteParams, withStudioRoute } from "@/lib/studio/route-context";
import { StudioCommandError } from "@/lib/studio/command-error";
import { VoiceSettingsError } from "@/lib/studio/voices/keys";
import { originVerified } from "@/lib/studio/voices/route-origin";
import { previewVoice } from "@/lib/studio/voices/service";

export const dynamic = "force-dynamic";
/** A short audition of a hosted voice. Explicit POST because the provider bills the Location's own account. */
export const POST = withStudioRoute(async (request, { params }) => {
  if (!originVerified(request)) return Response.json({ error: "The request origin could not be verified." }, { status: 403 });
  const { locationId } = await studioRouteParams(params, request);
  const voiceId = (await request.json().catch(() => ({})) as { voiceId?: unknown }).voiceId;
  if (typeof voiceId !== "string" || !/^[0-9a-f-]{36}$/i.test(voiceId)) return Response.json({ error: "Choose a voice." }, { status: 400 });
  try {
    const audio = await previewVoice(locationId, voiceId);
    return new Response(new Uint8Array(audio), { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof StudioCommandError || error instanceof VoiceSettingsError) return Response.json({ error: error.message }, { status: error instanceof StudioCommandError ? error.status : 400 });
    return Response.json({ error: "Could not preview this voice." }, { status: 503 });
  }
});
