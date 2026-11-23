import { studioRouteParams, withStudioRoute } from "@/lib/studio/route-context";
import { assertSampleLength, readCloneForm, MAX_SAMPLE_BYTES } from "@/lib/studio/voices/policy";
import { cloneVoice } from "@/lib/studio/voices/service";
import { VoiceSettingsError } from "@/lib/studio/voices/keys";
import { originVerified } from "@/lib/studio/voices/route-origin";

export const dynamic = "force-dynamic";
const respond = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
/** Clone a voice from one uploaded sample. The sample is forwarded to the provider and is never stored. */
export const POST = withStudioRoute(async (request, { params }) => {
  if (!originVerified(request)) return respond({ error: "The request origin could not be verified. Reload Studio and try again." }, 403);
  const { locationId } = await studioRouteParams(params, request);
  if (Number(request.headers.get("content-length") ?? 0) > MAX_SAMPLE_BYTES + 64 * 1024) return respond({ error: "The sample is larger than 12 MB. Use a shorter clip." }, 413);
  try {
    const { input, sample } = readCloneForm(await request.formData());
    await assertSampleLength(input.provider, sample);
    return respond(await cloneVoice(locationId, input, sample));
  } catch (error) {
    if (error instanceof VoiceSettingsError || (error instanceof Error && /^(Choose|Give|Use|Confirm|The sample|Enter)/.test(error.message))) return respond({ error: error.message }, 400);
    return respond({ error: "The voice could not be created. Try again later." }, 503);
  }
});
