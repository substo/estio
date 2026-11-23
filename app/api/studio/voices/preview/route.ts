import { studioRouteParams, withStudioRoute } from "@/lib/studio/route-context";
import { StudioCommandError } from "@/lib/studio/command-error";
import { VoiceSettingsError } from "@/lib/studio/voices/keys";
import { originVerified } from "@/lib/studio/voices/route-origin";
import { listVoices, previewVoice, readLocalPreview, requestLocalPreview } from "@/lib/studio/voices/service";

export const dynamic = "force-dynamic";
const respond = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
const fail = (error: unknown) => error instanceof StudioCommandError || error instanceof VoiceSettingsError
  ? respond({ error: error.message }, error instanceof StudioCommandError ? error.status : 400) : respond({ error: "Could not preview this voice." }, 503);

/** A short audition. A hosted voice answers with audio (the provider bills the Location's own account); an on-device voice queues a sample on the Mac and answers with a job to poll. */
export const POST = withStudioRoute(async (request, { params }) => {
  if (!originVerified(request)) return respond({ error: "The request origin could not be verified." }, 403);
  const { locationId } = await studioRouteParams(params, request);
  const voiceId = (await request.json().catch(() => ({})) as { voiceId?: unknown }).voiceId;
  if (typeof voiceId !== "string" || !/^[0-9a-f-]{36}$/i.test(voiceId)) return respond({ error: "Choose a voice." }, 400);
  try {
    const voice = (await listVoices(locationId)).find(v => v.id === voiceId);
    if (voice?.provider === "local") return respond({ jobId: (await requestLocalPreview(locationId, voiceId)).jobId }, 202);
    const audio = await previewVoice(locationId, voiceId);
    return new Response(new Uint8Array(audio), { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
  } catch (error) { return fail(error); }
});
/** Poll an on-device preview. */
export const GET = withStudioRoute(async (request, { params }) => {
  const { locationId } = await studioRouteParams(params, request);
  try { return respond(await readLocalPreview(locationId, new URL(request.url).searchParams.get("job") ?? "")); } catch (error) { return fail(error); }
});
