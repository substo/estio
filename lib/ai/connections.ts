import "server-only";
import { Prisma } from "@prisma/client";
import { studioDb } from "@/lib/studio/studio-db";
import { safeDeviceCapabilities } from "@/lib/studio/devices-policy";
import { WORKER_ONLINE_SECONDS } from "@/lib/studio/jobs";
import type { AiConnections } from "./connections-model";
import { loadAiConnections, type AiDeviceRow } from "./connections-store";

/**
 * The one answer to "which AI can this Location use?". Callers pass a Location they have already authorised; no secret
 * value is read or returned, only whether each connection exists, its status and its models. Every Mac in the Location is
 * listed with its owner so routing can pick only the requester's own (see lib/ai/routing.ts); strip owners before display.
 */
export async function getAiConnections(locationId: string): Promise<AiConnections> {
  return loadAiConnections(locationId, {
    listDevices: () => studioDb.rows<AiDeviceRow>(Prisma.sql`
      select id, name, created_by, revoked_at, paused, processing_enabled, seen_at, report from studio.studio_devices t
      where location_id = ${locationId} and revoked_at is null order by seen_at desc nulls last limit 20`),
    safeCapabilities: safeDeviceCapabilities, onlineSeconds: WORKER_ONLINE_SECONDS,
  });
}
