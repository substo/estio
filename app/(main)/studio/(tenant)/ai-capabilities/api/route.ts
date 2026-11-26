import { Prisma } from "@prisma/client";
import { studioRouteParams, withStudioRoute } from "@/lib/studio/route-context";
import { getStudioAccess } from "@/lib/studio/access";
import { studioDb } from "@/lib/studio/studio-db";
import { readDeviceConfig, safeDeviceCapabilities, type StudioDeviceConfig } from "@/lib/studio/devices-policy";
import { deviceTextReadiness } from "@/lib/studio/text-readiness";
import { settingsService } from "@/lib/settings/service";
import { SETTINGS_DOMAINS, SETTINGS_SECRET_KEYS } from "@/lib/settings/constants";
import { resolveLocationAiRoute } from "@/lib/ai/routing-service";
import { describeTextRoute } from "@/lib/ai/routing";
import { MAC_SUBSCRIPTION_KINDS, macPreferredKind } from "@/lib/studio/text-route";
import { IDEA_REVIEW_MODEL } from "@/lib/studio/idea-review-policy";
export const dynamic = "force-dynamic";
export const GET = withStudioRoute(async (request, { params }) => {
  const { locationId } = await studioRouteParams(params, request);
  const access = await getStudioAccess(locationId);
  if (!access) return Response.json({ error: "Access denied." }, { status: 403 });
  const rows = await studioDb.rows<{ paused: boolean; processing_enabled: boolean; allowed_kinds: string[]; seen_at: string | null;
    report: Record<string, unknown>; desired_config: StudioDeviceConfig; config_version: number; applied_config_version: number; config_status: string }>(Prisma.sql`
    select paused,processing_enabled,allowed_kinds,seen_at,report,desired_config,config_version,applied_config_version,config_status
    from studio.studio_devices where location_id=${access.locationId} and app=${access.app} and created_by=${access.userId} and revoked_at is null order by seen_at desc nulls last limit 20`);
  const workflow = new URL(request.url).searchParams.get("workflow");
  const devices = rows.map(d => {
    if (workflow === "studio_agent" && ![2, 3, 4].includes(Number(d.report?.studioAgentVersion)))
      return { ready: false, reason: "Update and restart the Studio companion for the creation assistant (length targets and long scripts)." };
    if (workflow === "staged_creation" && d.report?.stagedCreationVersion !== 1)
      return { ready: false, reason: "Update and restart the Studio companion for staged creation." };
    if (workflow === "video_template" && d.report?.videoTemplateVersion !== 1)
      return { ready: false, reason: "Update and restart the Studio companion for video template extraction." };
    if (workflow === "selected_idea" && (d.report?.sourceAssistVersion !== 1 || d.report?.knowledgeCurationVersion !== 1))
      return { ready: false, reason: "Update and restart the Studio companion to draft from selected evidence." };
    if (workflow === "source_assist" && d.report?.sourceAssistVersion !== 1)
      return { ready: false, reason: "Update and restart the Studio companion for the source assistant." };
    if (workflow === "knowledge_outline" && (d.report?.knowledgeOutlineVersion !== 2 || d.report?.knowledgeCurationVersion !== 1))
      return { ready: false, reason: "Update and restart the Studio companion for full-source extraction." };
    try { return deviceTextReadiness({ revoked: false, paused: d.paused, processingEnabled: d.processing_enabled, allowedKinds: d.allowed_kinds,
      seenAt: d.seen_at, capabilities: safeDeviceCapabilities(d.report), config: readDeviceConfig(d.desired_config),
      configVersion: d.config_version, appliedVersion: d.applied_config_version, configStatus: d.config_status }); }
    catch { return { ready: false, reason: "Save Text work and a subscription provider in Connected computer → Setup." }; }
  });
  const operation = workflow === "staged_creation" || workflow === "studio_agent" ? "script_brief"
    : workflow === "video_template" ? "video_template"
      : workflow === "selected_idea" || workflow === "source_assist" ? "source_assist"
        : workflow === "knowledge_outline" ? "knowledge_extract" : "idea_review";
  const [apiKeyPresent, route, macRoute] = await Promise.all([
    settingsService.hasSecret({ scopeType: "LOCATION", scopeId: access.locationId, domain: SETTINGS_DOMAINS.LOCATION_AI, secretKey: SETTINGS_SECRET_KEYS.OPENAI_API_KEY }),
    resolveLocationAiRoute(access.locationId, operation, { access }),
    macPreferredKind(access).then(first => resolveLocationAiRoute(access.locationId, operation, { access, only: MAC_SUBSCRIPTION_KINDS, first })),
  ]);
  // Companion-version gates stay per workflow; the Setup provider's own limit never blocks the other subscription.
  const gate = devices.find(d => !d.ready && /Update and restart|Update the Studio companion|Turn on Text work/.test(d.reason ?? ""));
  const mac = !devices.length ? { ready: false, reason: "Pair your own Mac in Connected computer settings." }
    : gate && !devices.some(d => d.ready) ? gate
      : macRoute.candidates[0] ? { ready: true, reason: `${describeTextRoute(macRoute)} Readiness is checked when queued.` }
        : { ready: false, reason: macRoute.stopReason ?? devices[0].reason };
  const step = route.candidates[0];
  return Response.json({
    location_order: step
      ? { ready: true, reason: `${describeTextRoute(route)} Readiness is checked when queued.` }
      : { ready: false, reason: route.stopReason ?? "Check the Location AI order and connection status." },
    subscription: mac,
    openai: { ready: apiKeyPresent, label: `${IDEA_REVIEW_MODEL} · OpenAI API (paid)`,
      reason: apiKeyPresent ? "Location API key saved. Budget is checked at execution." : "Add a Location OpenAI API key in AI settings." },
  }, { headers: { "Cache-Control": "private, no-store" } });
});
