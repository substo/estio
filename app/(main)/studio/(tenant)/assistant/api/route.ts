import { getPlatformProfile } from "@/lib/platform/profile";
import { studioCommandResponse } from "@/lib/studio/command-http";
import { studioRouteParams, withStudioRoute } from "@/lib/studio/route-context";
import { enqueueSourceAssist, getSourceAssistRun } from "@/lib/studio/source-assist";
import { readSourceAssistCommand } from "@/lib/studio/source-assist-policy";

export const dynamic = "force-dynamic";
export const POST = withStudioRoute(async (request, { params }) => {
  const { locationId } = await studioRouteParams(params, request);
  return studioCommandResponse(request, { profile: getPlatformProfile, parse: readSourceAssistCommand, execute: command => enqueueSourceAssist(locationId, command) });
});
export const GET = withStudioRoute(async (request, { params }) => {
  const { locationId } = await studioRouteParams(params, request);
  const run = await getSourceAssistRun(locationId, new URL(request.url).searchParams.get("reviewId") ?? "");
  return Response.json(run ? { run } : { error: "Not found." }, { status: run ? 200 : 404, headers: { "Cache-Control": "private, no-store" } });
});
