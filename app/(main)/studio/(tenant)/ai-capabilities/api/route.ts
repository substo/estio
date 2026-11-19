import { Prisma } from "@prisma/client";
import { studioRouteParams, withStudioRoute } from "@/lib/studio/route-context";
import { getStudioAccess } from "@/lib/studio/access";
import { studioDb } from "@/lib/studio/studio-db";
import { readDeviceConfig, safeDeviceCapabilities, type StudioDeviceConfig } from "@/lib/studio/devices-policy";
import { deviceTextReadiness } from "@/lib/studio/text-readiness";
import { settingsService } from "@/lib/settings/service";
import { SETTINGS_DOMAINS, SETTINGS_SECRET_KEYS } from "@/lib/settings/constants";
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
    if (workflow === "video_template" && d.report?.videoTemplateVersion !== 1)
      return { ready: false, reason: "Update and restart the Studio companion for video template extraction." };
    if (workflow === "source_assist" && d.report?.sourceAssistVersion !== 1)
      return { ready: false, reason: "Update and restart the Studio companion for the source assistant." };
    if (workflow === "knowledge_outline" && d.report?.knowledgeOutlineVersion !== 2)
      return { ready: false, reason: "Update and restart the Studio companion for full-source extraction." };
    try { return deviceTextReadiness({ revoked: false, paused: d.paused, processingEnabled: d.processing_enabled, allowedKinds: d.allowed_kinds,
      seenAt: d.seen_at, capabilities: safeDeviceCapabilities(d.report), config: readDeviceConfig(d.desired_config),
      configVersion: d.config_version, appliedVersion: d.applied_config_version, configStatus: d.config_status }); }
    catch { return { ready: false, reason: "Save Text work and a subscription provider in Connected computer → Setup." }; }
  });
  const apiKeyPresent = await settingsService.hasSecret({ scopeType: "LOCATION", scopeId: access.locationId, domain: SETTINGS_DOMAINS.LOCATION_AI, secretKey: SETTINGS_SECRET_KEYS.OPENAI_API_KEY });
  return Response.json({ subscription: devices.find(d => d.ready) ?? devices[0] ?? { ready: false, reason: "Pair your own Mac in Connected computer settings." },
    openai: { ready: apiKeyPresent, reason: apiKeyPresent ? "Location API key saved; model access, quota and budget are checked at execution." : "Add a Location OpenAI API key in AI settings." } }, { headers: { "Cache-Control": "private, no-store" } });
});
