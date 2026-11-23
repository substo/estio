import { studioRouteParams, withStudioRoute } from "@/lib/studio/route-context";
import { VoiceSettingsError } from "@/lib/studio/voices/keys";
import { readDesignFields } from "@/lib/studio/voices/design-form";
import { originVerified } from "@/lib/studio/voices/route-origin";
import { designVoicePreviews } from "@/lib/studio/voices/service";

export const dynamic = "force-dynamic";
const respond = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
/** Voice Design: candidate voices from a description. Explicit POST because the provider bills the Location's own account. */
export const POST = withStudioRoute(async (request, { params }) => {
  if (!originVerified(request)) return respond({ error: "The request origin could not be verified. Reload Studio and try again." }, 403);
  const { locationId } = await studioRouteParams(params, request);
  try { return respond(await designVoicePreviews(locationId, readDesignFields(await request.json().catch(() => null)))); }
  catch (error) { return respond({ error: error instanceof VoiceSettingsError ? error.message : "Could not design the voice. Try again later." }, error instanceof VoiceSettingsError ? 400 : 503); }
});
