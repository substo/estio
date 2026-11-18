import { getPlatformProfile } from "@/lib/platform/profile";
import { studioCommandResponse } from "@/lib/studio/command-http";
import { studioRouteParams, withStudioRoute } from "@/lib/studio/route-context";
import { enqueueVideoTemplate } from "@/lib/studio/video-template";
import { readVideoTemplateCommand } from "@/lib/studio/video-template-policy";

export const dynamic = "force-dynamic";
export const POST = withStudioRoute(async (request, { params }) => {
  const { locationId } = await studioRouteParams(params, request);
  return studioCommandResponse(request, {
    profile: getPlatformProfile, parse: readVideoTemplateCommand, execute: command => enqueueVideoTemplate(locationId, command),
  });
});
