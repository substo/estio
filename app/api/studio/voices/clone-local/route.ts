import { studioRouteParams, withStudioRoute } from "@/lib/studio/route-context";
import { assertLocalSampleLength, MAX_SAMPLE_BYTES, readLocalCloneForm } from "@/lib/studio/voices/policy";
import { cloneVoiceOnDevice } from "@/lib/studio/voices/service";
import { VoiceSettingsError } from "@/lib/studio/voices/keys";
import { originVerified } from "@/lib/studio/voices/route-origin";

export const dynamic = "force-dynamic";
const respond = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
/** Clone a voice on the owner's Mac from a recorded WAV and its transcript. Nothing is sent to a voice provider. */
export const POST = withStudioRoute(async (request, { params }) => {
  if (!originVerified(request)) return respond({ error: "The request origin could not be verified. Reload Studio and try again." }, 403);
  const { locationId } = await studioRouteParams(params, request);
  if (Number(request.headers.get("content-length") ?? 0) > MAX_SAMPLE_BYTES + 64 * 1024) return respond({ error: "The sample is larger than 12 MB. Use a shorter clip." }, 413);
  try {
    const { input, sample } = readLocalCloneForm(await request.formData());
    await assertLocalSampleLength(sample);
    return respond(await cloneVoiceOnDevice(locationId, input, sample));
  } catch (error) {
    if (error instanceof VoiceSettingsError || (error instanceof Error && /^(Choose|Give|Use|Confirm|The sample|Enter|Record)/.test(error.message))) return respond({ error: error.message }, 400);
    return respond({ error: "The voice could not be created. Try again later." }, 503);
  }
});
