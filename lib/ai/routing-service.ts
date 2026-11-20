import "server-only";
import { auth } from "@clerk/nextjs/server";
import { Prisma } from "@prisma/client";
import db from "@/lib/db";
import { settingsService } from "@/lib/settings/service";
import { SETTINGS_DOMAINS } from "@/lib/settings/constants";
import { getStudioAccess, type StudioAccess } from "@/lib/studio/access";
import { canManageStudioAi } from "@/lib/studio/ai-settings-policy";
import { studioDb } from "@/lib/studio/studio-db";
import { getAiConnections } from "./connections";
import { toClientConnection, type AiClientConnection, type AiConnection } from "./connections-model";
import { aiRoutingSettingsSchema, readAiRoutingSettings, resolveAiRoute, type AiRouteDecision, type AiRoutingSettings } from "./routing";
import type { AiRoutedOperation } from "./workflow-capabilities";

/**
 * Location AI routing for both apps (Estio CRM and Studio share one Location settings model). Reads are for Location
 * members; saving the order/task models needs AI-manager authority (Location admin, signed in as themselves).
 */
export class AiRoutingError extends Error { constructor(message: string, public readonly status = 400) { super(message); } }

/** Monthly cap = the Location AI budget the atomic paid reservation enforces (studio.studio_location_ai_settings). */
export type AiRoutingBudget = { capMicros: number; spentMicros: number; heldMicros: number; month: string };
export type LocationAiRoutingView = {
  connections: AiClientConnection[];
  chain: AiRoutingSettings["chain"];
  taskDefaults: AiRoutingSettings["taskDefaults"];
  /** False until an admin saves an order; the chain shown is then the no-paid default. */
  saved: boolean;
  /** Settings document version for optimistic saves. */
  version: number;
  budget: AiRoutingBudget;
  canManage: boolean;
};

const routingDoc = (locationId: string) => ({ scopeType: "LOCATION" as const, scopeId: locationId, domain: SETTINGS_DOMAINS.LOCATION_AI });
const currentMonth = () => { const now = new Date(); return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`; };

async function readRouting(locationId: string) {
  const doc = await settingsService.getDocument<{ aiRouting?: unknown }>(routingDoc(locationId));
  return { settings: readAiRoutingSettings(doc?.payload?.aiRouting), saved: doc?.payload?.aiRouting !== undefined, version: doc?.version ?? 0 };
}

/** The one Location monthly cap/usage read (both apps; Studio AI settings reuse it). Caller authorises the Location. */
export async function getLocationAiBudget(locationId: string): Promise<AiRoutingBudget> {
  const month = currentMonth();
  const [settings, usage] = await Promise.all([
    studioDb.rows<{ monthly_budget_micros: number }>(Prisma.sql`select monthly_budget_micros from studio.studio_location_ai_settings where location_id = ${locationId} limit 1`),
    studioDb.one<{ spent: number; held: number }>(Prisma.sql`
      select coalesce(sum(cost_micros) filter (where status = 'settled'), 0) as spent, coalesce(sum(reserved_micros) filter (where status = 'reserved'), 0) as held
      from studio.studio_ai_usage where location_id = ${locationId} and usage_month = ${month}::date and status in ('reserved', 'settled')`),
  ]);
  return { capMicros: Number(settings[0]?.monthly_budget_micros ?? 0), spentMicros: Number(usage?.spent ?? 0), heldMicros: Number(usage?.held ?? 0), month };
}

async function requireAccess(locationId: string) {
  const access = await getStudioAccess(locationId);
  if (!access) throw new AiRoutingError("Access denied.", 403);
  return access;
}

/** GET model for /api/studio/ai-routing and both settings pages. Only the viewer's own Mac subscriptions are listed. */
export async function getLocationAiRouting(locationId: string): Promise<LocationAiRoutingView> {
  const access = await requireAccess(locationId);
  const [{ settings, saved, version }, ai, budget, actor] = await Promise.all([
    readRouting(access.locationId), getAiConnections(access.locationId), getLocationAiBudget(access.locationId), auth().then(a => a.actor ?? null)]);
  const visible = (ai.connections ?? []).filter(c => c.scope !== "device" || c.ownerUserId === access.userId);
  return { connections: visible.map(c => toClientConnection(c, access.userId)), chain: settings.chain, taskDefaults: settings.taskDefaults, saved, version, budget,
    canManage: canManageStudioAi(access) && !actor };
}

/** Save the order and per-task models. The monthly cap is saved through the existing budget command (atomic, AI-manager locked). */
export async function saveLocationAiRouting(locationId: string, input: { chain: unknown; taskDefaults?: unknown; expectedVersion: number; monthlyCapMicros?: number }) {
  const access = await requireAccess(locationId);
  if ((await auth()).actor || !canManageStudioAi(access)) throw new AiRoutingError("Only a Location admin, signed in as themselves, can change AI settings.", 403);
  const parsed = aiRoutingSettingsSchema.safeParse({ version: 1, chain: input.chain, taskDefaults: input.taskDefaults ?? {} });
  if (!parsed.success) throw new AiRoutingError(parsed.error.issues[0]?.message ?? "Invalid AI order.");
  const actorUserId = (await db.user.findFirst({ where: { clerkId: access.userId, authRealm: access.app }, select: { id: true } }))?.id ?? null;
  const current = await settingsService.getDocument<Record<string, unknown>>(routingDoc(access.locationId));
  // A new document needs the AI domain's one required field; 90 days is the CRM settings default.
  const base = current?.payload ?? { whatsappTranscriptRetentionDays: 90 };
  await settingsService.upsertDocument({ ...routingDoc(access.locationId), payload: { ...base, aiRouting: parsed.data }, actorUserId, expectedVersion: input.expectedVersion, schemaVersion: 1 });
  if (input.monthlyCapMicros !== undefined)
    await studioDb.call("studio_set_ai_budget", { p_location_id: access.locationId, p_actor_app: access.app, p_clerk_user_id: access.userId, p_monthly_budget_micros: input.monthlyCapMicros });
  return getLocationAiRouting(access.locationId);
}

/** Estimated reservation for one paid text request (Studio text batches reserve $0.01). */
export const DEFAULT_PAID_ESTIMATE_MICROS = 10_000;
/**
 * Route one operation for the signed-in requester (or `background` for work with no requesting person). Feature phases call
 * this before admission and pass `toStudioTextRoute(decision)` (or their operation's equivalent) to the atomic SQL admission.
 */
export async function resolveLocationAiRoute(locationId: string, operation: AiRoutedOperation, options: { background?: boolean; estimateMicros?: number; access?: StudioAccess } = {}): Promise<AiRouteDecision> {
  const access = options.access ?? await requireAccess(locationId);
  const [{ settings }, ai, budget] = await Promise.all([readRouting(access.locationId), getAiConnections(access.locationId), getLocationAiBudget(access.locationId)]);
  return resolveAiRoute({ operation, settings, connections: ai.connections ?? [] as AiConnection[], requester: options.background ? null : { userId: access.userId },
    budget: { capMicros: budget.capMicros, usedMicros: budget.spentMicros + budget.heldMicros, estimateMicros: options.estimateMicros ?? DEFAULT_PAID_ESTIMATE_MICROS } });
}

const STUDIO_TEXT_KINDS = new Set(["device_codex", "device_claude", "openai_key"]);
/** `p_command.route` for studio_enqueue_routed_text_run: ordered candidates plus the reasons earlier steps were skipped. */
export function toStudioTextRoute(decision: AiRouteDecision) {
  const candidates = decision.candidates.filter(c => STUDIO_TEXT_KINDS.has(c.kind)).slice(0, 5)
    .map(c => ({ kind: c.kind, model: c.model, ...(c.deviceId ? { deviceId: c.deviceId } : {}) }));
  if (!candidates.length) throw new AiRoutingError(decision.stopReason ?? "No AI connection in this Location's order can run this now.", 409);
  return { ...(decision.requested ? { requested: decision.requested } : {}), candidates, skipped: decision.skipped.slice(0, 8).map(s => ({ kind: s.kind, reason: s.reason.slice(0, 300) })) };
}

export type StudioTextOperation = "idea_review" | "script_brief" | "knowledge_extract" | "video_template" | "source_assist";
/**
 * For a Studio text request that follows the Location order: drop the explicit-provider fields and attach the resolved
 * route. Pass the result as `p_command` to studio_enqueue_routed_text_run (directly or via the video-template/source-assist
 * wrappers). Throws AiRoutingError(409) with the stop reason when nothing can run.
 */
export async function withStudioTextRoute<T extends Record<string, unknown>>(locationId: string, operation: StudioTextOperation, command: T) {
  const decision = await resolveLocationAiRoute(locationId, operation);
  const { provider: _provider, confirmPaid: _paid, confirmSubscription: _subscription, ...rest } = command;
  return { command: { ...rest, route: toStudioTextRoute(decision) }, decision };
}
