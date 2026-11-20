import { getPlatformProfile } from "@/lib/platform/profile";
import { studioCommandResponse } from "@/lib/studio/command-http";
import { studioRouteParams, withStudioRoute } from "@/lib/studio/route-context";
import { readCreationCommand } from "@/lib/studio/creation-policy";
import { executeCreationCommand, getCreationRun } from "@/lib/studio/creation";
import { StudioCommandError } from "@/lib/studio/command-error";
import { recordLinkId } from "@/lib/studio/record-link-policy";

export const dynamic = "force-dynamic";
export const POST = withStudioRoute(async (request, { params }) => {
  const { locationId } = await studioRouteParams(params, request);
  return studioCommandResponse(request, { profile: getPlatformProfile, parse: readCreationCommand, maxBytes: 100_000,
    execute: command => executeCreationCommand(locationId, command) });
});
export const GET = withStudioRoute(async (request, { params }) => {
  const { locationId } = await studioRouteParams(params, request);
  const id = new URL(request.url).searchParams.get("reviewId") ?? "";
  const reply = (body: unknown, status: number) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
  if (!recordLinkId(id)) return reply({ error: "Review unavailable." }, 404);
  try {
    const run = await getCreationRun(locationId, id);
    return run ? reply({ run }, 200) : reply({ error: "Review unavailable." }, 404);
  } catch (error) {
    if (error instanceof StudioCommandError) return reply({ error: error.message }, error.status);
    return reply({ error: "The review status is temporarily unavailable." }, 503);
  }
});
