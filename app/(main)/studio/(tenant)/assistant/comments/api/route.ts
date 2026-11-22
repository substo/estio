import { getPlatformProfile } from "@/lib/platform/profile";
import { studioCommandResponse } from "@/lib/studio/command-http";
import { studioRouteParams, withStudioRoute } from "@/lib/studio/route-context";
import { StudioCommandError } from "@/lib/studio/command-error";
import { recordLinkId } from "@/lib/studio/record-link-policy";
import { sampleAudienceComments } from "@/lib/studio/audience-comments";

export const dynamic = "force-dynamic";
/** On-demand and origin-checked (a POST), because it spends a request of YouTube quota. The sample is returned to the page and not stored. */
export const POST = withStudioRoute(async (request, { params }) => {
  const { locationId } = await studioRouteParams(params, request);
  return studioCommandResponse(request, { profile: getPlatformProfile, maxBytes: 2000,
    parse: (body: unknown) => {
      const sourceId = body && typeof body === "object" ? (body as { sourceId?: unknown }).sourceId : undefined;
      if (typeof sourceId !== "string" || !recordLinkId(sourceId)) throw new StudioCommandError("Choose a saved video.");
      return sourceId.toLowerCase();
    },
    execute: sourceId => sampleAudienceComments(locationId, sourceId) });
});
