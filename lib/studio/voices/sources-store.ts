import "server-only";
import db from "@/lib/db";
import { settingsService } from "@/lib/settings/service";
import { SETTINGS_DOMAINS } from "@/lib/settings/constants";
import { getStudioAccess } from "../access";
import { requireVoiceManager } from "./keys";
import { readGenerationSources, GENERATION_KINDS, type GenerationKind, type GenerationSources, type SourceChoice } from "./sources";

const ref = (locationId: string) => ({ scopeType: "LOCATION" as const, scopeId: locationId, domain: SETTINGS_DOMAINS.LOCATION_AI });
const FIELD = "studioGenerationSources";

/** The Location's own choice per kind (voice, music, effects). Empty means "not chosen yet": the default rule applies. Stored in the existing per-Location AI settings document. */
export async function getGenerationSources(locationId: string): Promise<GenerationSources> {
  const doc = await settingsService.getDocument<Record<string, unknown>>(ref(locationId)).catch(() => null);
  return readGenerationSources(doc?.payload?.[FIELD]);
}
export async function setGenerationSource(locationId: string, kind: GenerationKind, choice: SourceChoice | null): Promise<GenerationSources> {
  if (!GENERATION_KINDS.includes(kind) || (choice !== null && choice !== "local" && choice !== "hosted")) throw new Error("Invalid generation source.");
  const access = await requireVoiceManager(locationId);
  const current = await settingsService.getDocument<Record<string, unknown>>(ref(access.locationId));
  const sources = readGenerationSources(current?.payload?.[FIELD]);
  if (choice === null) delete sources[kind]; else sources[kind] = choice;
  const actor = (await db.user.findFirst({ where: { clerkId: access.userId, authRealm: access.app }, select: { id: true } }))?.id ?? null;
  await settingsService.upsertDocument({ ...ref(access.locationId), payload: { whatsappTranscriptRetentionDays: 90, ...(current?.payload ?? {}), [FIELD]: sources }, actorUserId: actor, expectedVersion: current?.version ?? 0, schemaVersion: 1 });
  return sources;
}
export async function readGenerationSourcesFor(locationId: string): Promise<GenerationSources | null> {
  const access = await getStudioAccess(locationId);
  return access ? getGenerationSources(access.locationId) : null;
}
