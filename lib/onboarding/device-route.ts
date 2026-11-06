import { Prisma } from "@prisma/client";
import type { StudioDb } from "@/lib/studio/db";
import type { OnboardingState } from "./state";
import { deviceResearchReadiness, safeDeviceCapabilities, type DeviceResearchReadiness } from "@/lib/studio/devices-policy";

/**
 * Paired Macs that could run onboarding research on the business's own Codex/Claude subscription, each with its current
 * readiness (running, recently seen, processing On, not paused, research allowed, signed in, capacity). Worker-safe.
 */
export type ResearchDevice = { id: string; name: string; readiness: DeviceResearchReadiness };
type Row = { id: string; name: string; paused: boolean; processing_enabled: boolean; allowed_kinds: string[]; seen_at: string | null; report: Record<string, unknown> };

export function researchDevicesFrom(rows: Row[], now = Date.now()): ResearchDevice[] {
  return rows.map(row => ({ id: row.id, name: row.name, readiness: deviceResearchReadiness({ revoked: false, paused: row.paused, processingEnabled: row.processing_enabled,
    allowedKinds: row.allowed_kinds ?? [], seenAt: row.seen_at, capabilities: safeDeviceCapabilities(row.report ?? {}) }, now) }));
}
export async function researchDevices(studio: StudioDb, locationId: string, now = Date.now()): Promise<ResearchDevice[]> {
  const rows = await studio.rows<Row>(Prisma.sql`select id, name, paused, processing_enabled, allowed_kinds, seen_at, report from studio.studio_devices t
    where location_id = ${locationId} and revoked_at is null and token_hash is not null order by seen_at desc nulls last limit 20`);
  return researchDevicesFrom(rows, now);
}
/** The Mac research goes to: the most recently seen ready one. Subscriptions on a Mac come before any server connection. */
export const readyResearchDevice = (devices: ResearchDevice[]) => devices.find(d => d.readiness.ready) ?? null;
export const deviceRunProvider = (deviceId: string) => `mac:${deviceId}`;
export const runDeviceId = (provider: string | undefined) => provider?.startsWith("mac:") ? provider.slice(4) : null;

/** While topics wait on a Mac, say plainly whether it is working on them or what it is waiting for. */
export function researchNoteFor(state: OnboardingState, devices: ResearchDevice[]): string | null {
  const waiting = state.runs.filter(r => r.batch === state.batch && (r.status === "queued" || r.status === "running")).map(r => runDeviceId(r.provider)).filter(Boolean);
  if (!waiting.length) return null;
  const device = devices.find(d => d.id === waiting[0]);
  if (!device) return "Waiting for your Mac, which is no longer connected. Research again to use another connection.";
  return device.readiness.ready ? `Researching on ${device.name} with your own subscription.`
    : `Waiting for ${device.name}: ${device.readiness.reason}.`;
}
