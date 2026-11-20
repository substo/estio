import { z } from "zod";
import { isAllowedRequestOrigin } from "@/lib/auth/request-origin-policy";
import { studioRouteParams, withStudioRoute } from "@/lib/studio/route-context";
import { readMonthlyBudget } from "@/lib/studio/ai-settings-policy";
import { SettingsVersionConflictError } from "@/lib/settings/errors";
import { AiRoutingError, getLocationAiRouting, saveLocationAiRouting } from "@/lib/ai/routing-service";

/**
 * The active Location's AI routing for both apps (Estio /admin/settings/ai and Studio /studio/settings/ai).
 * GET: { connections, chain, taskDefaults, saved, version, budget, canManage } for any Location member.
 * PUT: { chain, taskDefaults?, version, monthlyCap? ("25.50" dollars) }, AI managers only; send X-Studio-Tenant.
 */
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
const failure = (error: unknown) => {
  if (error instanceof AiRoutingError) return json({ error: error.message }, error.status);
  if (error instanceof SettingsVersionConflictError) return json({ error: "AI settings changed. Reload and try again." }, 409);
  throw error;
};
const body = z.object({ chain: z.unknown(), taskDefaults: z.unknown().optional(), version: z.number().int().min(0), monthlyCap: z.string().max(12).optional() }).strict();

export const GET = withStudioRoute(async (request, { params }) => {
  const { locationId } = await studioRouteParams(params, request);
  try { return json(await getLocationAiRouting(locationId)); } catch (error) { return failure(error); }
});

export const PUT = withStudioRoute(async (request, { params }) => {
  const origin = request.headers.get("origin"); const requestOrigin = new URL(request.url).origin;
  if (!origin || request.headers.get("sec-fetch-site") === "cross-site" || !isAllowedRequestOrigin({ origin, requestOrigin, appUrl: requestOrigin, host: request.headers.get("host"),
    forwardedHost: request.headers.get("x-forwarded-host"), forwardedProto: request.headers.get("x-forwarded-proto") }))
    return json({ error: "Request origin could not be verified." }, 403);
  const { locationId } = await studioRouteParams(params, request);
  const text = await request.text();
  let parsed: z.SafeParseReturnType<unknown, z.infer<typeof body>> | null = null;
  try { parsed = text.length <= 8192 ? body.safeParse(JSON.parse(text || "null")) : null; } catch { parsed = null; }
  if (!parsed?.success) return json({ error: "Invalid request." }, 400);
  try {
    const monthlyCapMicros = parsed.data.monthlyCap === undefined ? undefined : readMonthlyBudget(parsed.data.monthlyCap);
    return json(await saveLocationAiRouting(locationId, { chain: parsed.data.chain, taskDefaults: parsed.data.taskDefaults, expectedVersion: parsed.data.version, monthlyCapMicros }));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Enter a monthly budget") || error instanceof Error && error.message.startsWith("The monthly budget")) return json({ error: error.message }, 400);
    return failure(error);
  }
});
