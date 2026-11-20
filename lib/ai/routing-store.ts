import { Prisma } from "@prisma/client";
import db from "@/lib/db";
import { settingsService } from "@/lib/settings/service";
import { SETTINGS_DOMAINS } from "@/lib/settings/constants";
import { createStudioDb } from "@/lib/studio/db";
import { readAiRoutingSettings, type AiRoutingSettings } from "./routing";

/**
 * Worker-safe reads behind the Location AI routing (both apps): the saved order/task models and the one monthly cap.
 * Callers authorise the Location first. lib/ai/routing-service.ts adds access checks and saving.
 */
export type AiRoutingBudget = { capMicros: number; spentMicros: number; heldMicros: number; month: string };
export const aiRoutingDocument = (locationId: string) => ({ scopeType: "LOCATION" as const, scopeId: locationId, domain: SETTINGS_DOMAINS.LOCATION_AI });
const currentMonth = () => { const now = new Date(); return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`; };

/** `payload` is the whole Location AI document: the legacy per-task model fields are read from it as migration defaults. */
export async function readLocationAiRouting(locationId: string): Promise<{ settings: AiRoutingSettings; saved: boolean; version: number; payload: Record<string, unknown> }> {
  const doc = await settingsService.getDocument<Record<string, unknown> & { aiRouting?: unknown }>(aiRoutingDocument(locationId));
  const payload = doc?.payload ?? {};
  return { settings: readAiRoutingSettings(payload.aiRouting), saved: payload.aiRouting !== undefined, version: doc?.version ?? 0, payload };
}

/** The one Location monthly cap/usage read (Studio's atomic reservation ledger). Caller authorises the Location. */
export async function getLocationAiBudget(locationId: string, studio = createStudioDb(db)): Promise<AiRoutingBudget> {
  const month = currentMonth();
  const [settings, usage] = await Promise.all([
    studio.rows<{ monthly_budget_micros: number }>(Prisma.sql`select monthly_budget_micros from studio.studio_location_ai_settings where location_id = ${locationId} limit 1`),
    studio.one<{ spent: number; held: number }>(Prisma.sql`
      select coalesce(sum(cost_micros) filter (where status = 'settled'), 0) as spent, coalesce(sum(reserved_micros) filter (where status = 'reserved'), 0) as held
      from studio.studio_ai_usage where location_id = ${locationId} and usage_month = ${month}::date and status in ('reserved', 'settled')`),
  ]);
  return { capMicros: Number(settings[0]?.monthly_budget_micros ?? 0), spentMicros: Number(usage?.spent ?? 0), heldMicros: Number(usage?.held ?? 0), month };
}
