import { z } from "zod";
import { isAllowedRequestOrigin } from "@/lib/auth/request-origin-policy";
import { studioRouteParams, withStudioRoute } from "@/lib/studio/route-context";
import { StudioCommandError } from "@/lib/studio/command-error";
import { enqueueLibrarySummary, retryLibrarySummary } from "@/lib/studio/library-summary";
import { toggleSourceHighlight } from "@/lib/studio/source-page";
import { HIGHLIGHT_KINDS } from "@/lib/studio/source-highlights";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("summary"), recordId: z.string().uuid(), retry: z.boolean().optional() }).strict(),
  z.object({ action: z.literal("highlight"), recordId: z.string().uuid(), kind: z.enum(HIGHLIGHT_KINDS), key: z.string().min(1).max(80), excerpt: z.string().trim().min(1).max(2000),
    at: z.number().int().min(0).max(100000).nullable() }).strict(),
]);
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
/** Source page actions: ask for the automatic Summary (or retry it), and toggle a highlight. Both run on the owner's own Mac and Location; nothing is paid. */
export const POST = withStudioRoute(async (request, { params }) => {
  const origin = request.headers.get("origin"); const requestOrigin = new URL(request.url).origin;
  if (!origin || request.headers.get("sec-fetch-site") === "cross-site" || !isAllowedRequestOrigin({ origin, requestOrigin, appUrl: requestOrigin, host: request.headers.get("host"),
    forwardedHost: request.headers.get("x-forwarded-host"), forwardedProto: request.headers.get("x-forwarded-proto") }))
    return Response.json({ error: "Request origin could not be verified." }, { status: 403, headers });
  const { locationId } = await studioRouteParams(params, request);
  const text = await request.text();
  let body: unknown = null;
  if (text.length <= 4096) { try { body = JSON.parse(text); } catch { /* malformed JSON */ } }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Invalid request." }, { status: 400, headers });
  try {
    const command = parsed.data;
    if (command.action === "highlight") return Response.json(await toggleSourceHighlight(locationId, { recordId: command.recordId, kind: command.kind, key: command.key, excerpt: command.excerpt.slice(0, 600), at: command.at }), { headers });
    const result = command.retry ? await retryLibrarySummary(locationId, command.recordId) : await enqueueLibrarySummary(locationId, command.recordId);
    return Response.json(result ?? {}, { headers });
  } catch (error) {
    if (error instanceof StudioCommandError) return Response.json({ error: error.message }, { status: error.status, headers });
    const message = error instanceof Error ? error.message : "";
    if (/AI manager|admin|authority|42501|permission/i.test(message)) return Response.json({ error: "Only a Business admin can ask for a summary." }, { status: 403, headers });
    return Response.json({ error: "That could not be saved. Try again." }, { status: 503, headers });
  }
});
