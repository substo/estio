import { z } from "zod";
import { isAllowedRequestOrigin } from "@/lib/auth/request-origin-policy";
import { StudioCommandError } from "@/lib/studio/command-error";
import { studioRouteParams, withStudioRoute } from "@/lib/studio/route-context";
import { getSourceDetails, requestSourceDetails } from "@/lib/studio/source-details";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
const errorResponse = (error: unknown) => error instanceof StudioCommandError
  ? json({ error: error.message }, error.status)
  : json({ error: "Source details are temporarily unavailable." }, 503);
const recordIdSchema = z.string().uuid();
const command = z.object({ recordId: recordIdSchema, requestId: z.string().uuid() }).strict();

export const GET = withStudioRoute(async (request, { params }) => {
  const input = recordIdSchema.safeParse(new URL(request.url).searchParams.get("recordId"));
  if (!input.success) return json({ error: "Invalid source." }, 400);
  const { locationId } = await studioRouteParams(params, request);
  try { return json(await getSourceDetails(locationId, input.data)); }
  catch (error) { return errorResponse(error); }
});

export const POST = withStudioRoute(async (request, { params }) => {
  const origin = request.headers.get("origin");
  const requestOrigin = new URL(request.url).origin;
  if (!origin || request.headers.get("sec-fetch-site") === "cross-site" || !isAllowedRequestOrigin({
    origin, requestOrigin, appUrl: requestOrigin, host: request.headers.get("host"),
    forwardedHost: request.headers.get("x-forwarded-host"), forwardedProto: request.headers.get("x-forwarded-proto"),
  })) return json({ error: "Request origin could not be verified." }, 403);
  const { locationId } = await studioRouteParams(params, request);
  const body = await request.text();
  let input: unknown;
  if (body.length <= 1024) {
    try { input = JSON.parse(body); } catch { /* Invalid JSON is rejected below. */ }
  }
  const parsed = command.safeParse(input);
  if (!parsed.success) return json({ error: "Invalid request." }, 400);
  try { return json(await requestSourceDetails(locationId, parsed.data.recordId, parsed.data.requestId)); }
  catch (error) { return errorResponse(error); }
});
