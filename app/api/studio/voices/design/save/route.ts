import { studioRouteParams, withStudioRoute } from "@/lib/studio/route-context";
import { VoiceSettingsError } from "@/lib/studio/voices/keys";
import { readDesignFields } from "@/lib/studio/voices/design-form";
import { originVerified } from "@/lib/studio/voices/route-origin";
import { saveDesignedVoice } from "@/lib/studio/voices/service";

export const dynamic = "force-dynamic";
const respond = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
export const POST = withStudioRoute(async (request, { params }) => {
  if (!originVerified(request)) return respond({ error: "The request origin could not be verified. Reload Studio and try again." }, 403);
  const { locationId } = await studioRouteParams(params, request);
  try {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body.name !== "string" || typeof body.generatedVoiceId !== "string") throw new VoiceSettingsError("Choose a candidate and name the voice.");
    return respond(await saveDesignedVoice(locationId, { name: body.name, fields: readDesignFields(body.fields), generatedVoiceId: body.generatedVoiceId, persona: typeof body.persona === "string" ? body.persona : null }));
  } catch (error) { return respond({ error: error instanceof VoiceSettingsError ? error.message : "The voice could not be saved. Try again later." }, error instanceof VoiceSettingsError ? 400 : 503); }
});
