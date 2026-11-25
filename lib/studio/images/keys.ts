import "server-only";
import db from "@/lib/db";
import { settingsService } from "@/lib/settings/service";
import { SETTINGS_DOMAINS, SETTINGS_SECRET_KEYS } from "@/lib/settings/constants";
import { keyHint } from "../voices/policy";
import { requireVoiceManager, VoiceSettingsError } from "../voices/keys";
import { resolveFalKey } from "../voices/sound-keys";
import { IMAGE_PLATFORMS, IMAGE_PLATFORM_IDS, endpointFor, imageModel, readImageChoice, type ImageChoice, type ImagePlatformId } from "./catalog";
import { ImageError, generateImage, listImageModels, testReferencePng, verifyImageKey } from "./clients";
import { SAMPLE_SHOT, renderShot } from "./prompts";

/** Image keys are encrypted Location secrets entered in the product, never read from the environment. fal.ai, Google and OpenAI keys already exist for audio and AI settings and are reused. */
const OWN_SECRET: Partial<Record<ImagePlatformId, string>> = {
  replicate: SETTINGS_SECRET_KEYS.REPLICATE_API_KEY, bfl: SETTINGS_SECRET_KEYS.BFL_API_KEY, ideogram: SETTINGS_SECRET_KEYS.IDEOGRAM_API_KEY, stability: SETTINGS_SECRET_KEYS.STABILITY_API_KEY,
};
const SHARED_SECRET: Partial<Record<ImagePlatformId, string>> = { google: SETTINGS_SECRET_KEYS.GOOGLE_AI_API_KEY, openai: SETTINGS_SECRET_KEYS.OPENAI_API_KEY };
const ref = (locationId: string, secretKey: string) => ({ scopeType: "LOCATION" as const, scopeId: locationId, domain: SETTINGS_DOMAINS.LOCATION_AI, secretKey });

export async function resolveImageKey(locationId: string, platform: ImagePlatformId): Promise<string | null> {
  if (!locationId.trim()) return null;
  if (platform === "fal") return resolveFalKey(locationId);
  const secretKey = OWN_SECRET[platform] ?? SHARED_SECRET[platform];
  if (!secretKey) return null;
  return (await settingsService.getSecret(ref(locationId, secretKey)).catch(() => null))?.trim() || null;
}

export interface ImagePlatformState { id: ImagePlatformId; hint: string | null; /** The key is entered elsewhere (audio or AI settings). */ shared: boolean }
export async function getImagePlatformStates(locationId: string): Promise<ImagePlatformState[]> {
  return Promise.all(IMAGE_PLATFORM_IDS.map(async id => {
    const key = await resolveImageKey(locationId, id);
    return { id, hint: key ? keyHint(key) : null, shared: Boolean(IMAGE_PLATFORMS[id].sharedKey) };
  }));
}
export async function imageKeyAvailability(locationId: string): Promise<Partial<Record<ImagePlatformId, boolean>>> {
  const states = await getImagePlatformStates(locationId);
  return Object.fromEntries(states.map(s => [s.id, Boolean(s.hint)]));
}

const actorId = async (access: { userId: string; app: "estio" | "substo" }) => (await db.user.findFirst({ where: { clerkId: access.userId, authRealm: access.app }, select: { id: true } }))?.id ?? null;
const keyPattern = /^[A-Za-z0-9_:.\-]{16,300}$/;
/** Only the platforms whose key is not already entered elsewhere are saved here. The key is checked for free first. */
export async function saveImageKey(locationId: string, platform: ImagePlatformId, key: string) {
  const secretKey = OWN_SECRET[platform];
  if (!secretKey) throw new VoiceSettingsError(`${IMAGE_PLATFORMS[platform].label}: ${IMAGE_PLATFORMS[platform].sharedKey ?? "this key is entered elsewhere."}`);
  const access = await requireVoiceManager(locationId);
  const clean = key.trim();
  if (!keyPattern.test(clean)) throw new VoiceSettingsError(`Paste the ${IMAGE_PLATFORMS[platform].label} API key exactly as shown.`);
  const verdict = await verifyImageKey(platform, clean);
  if (verdict === "invalid") throw new VoiceSettingsError(`${IMAGE_PLATFORMS[platform].label} rejected this key. Check it and try again.`);
  if (verdict === "unavailable") throw new VoiceSettingsError(`Could not reach ${IMAGE_PLATFORMS[platform].label} to check this key. Try again shortly.`);
  await settingsService.setSecret({ ...ref(access.locationId, secretKey), plaintext: clean, actorUserId: await actorId(access) });
}
export async function removeImageKey(locationId: string, platform: ImagePlatformId) {
  const secretKey = OWN_SECRET[platform];
  if (!secretKey) throw new VoiceSettingsError("This key is entered elsewhere.");
  const access = await requireVoiceManager(locationId);
  await settingsService.clearSecret({ ...ref(access.locationId, secretKey), actorUserId: await actorId(access) });
}

// ---- The Location's choice and the last test of each model, in the existing Location AI settings document --------------------------------------
const settingsRef = (locationId: string) => ({ scopeType: "LOCATION" as const, scopeId: locationId, domain: SETTINGS_DOMAINS.LOCATION_AI });
const CHOICE = "studioImageChoice", TESTS = "studioImageTests";
export interface ImageTestRecord { ok: boolean; at: string; message: string; ms: number }
export type ImageTests = Record<string, ImageTestRecord>;
const testKey = (platform: string, model: string, endpoint: string) => `${platform}|${model}|${endpoint}`.slice(0, 200);
const readTests = (value: unknown): ImageTests => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: ImageTests = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 80)) { const r = v as Partial<ImageTestRecord>; if (r && typeof r.ok === "boolean" && typeof r.at === "string") out[k] = { ok: r.ok, at: r.at.slice(0, 40), message: String(r.message ?? "").slice(0, 240), ms: Number(r.ms) || 0 }; }
  return out;
};
export async function getImageSettings(locationId: string): Promise<{ choice: ImageChoice | null; tests: ImageTests }> {
  const doc = await settingsService.getDocument<Record<string, unknown>>(settingsRef(locationId)).catch(() => null);
  return { choice: readImageChoice(doc?.payload?.[CHOICE]), tests: readTests(doc?.payload?.[TESTS]) };
}
async function writeSettings(locationId: string, mutate: (payload: Record<string, unknown>) => void) {
  const access = await requireVoiceManager(locationId);
  const current = await settingsService.getDocument<Record<string, unknown>>(settingsRef(access.locationId));
  const payload = { whatsappTranscriptRetentionDays: 90, ...(current?.payload ?? {}) } as Record<string, unknown>;
  mutate(payload);
  await settingsService.upsertDocument({ ...settingsRef(access.locationId), payload, actorUserId: await actorId(access), expectedVersion: current?.version ?? 0, schemaVersion: 1 });
}
export async function setImageChoice(locationId: string, choice: ImageChoice | null) {
  const clean = choice ? readImageChoice(choice) : null;
  if (choice && !clean) throw new VoiceSettingsError("That model is not available on that platform.");
  await writeSettings(locationId, p => { if (clean) p[CHOICE] = clean; else delete p[CHOICE]; });
}
/** Model ids the platform offers for this key (OpenAI and Google only). */
export async function discoverImageModels(locationId: string, platform: "openai" | "google"): Promise<string[]> {
  const key = await resolveImageKey(locationId, platform);
  return key ? listImageModels(platform, key) : [];
}

export interface ImageTestResult { ok: boolean; message: string; ms: number; dataUrl?: string; prompt?: string; notes?: string[] }
/** One real image with the chosen model and platform, so a key is proven by a picture and not by a guess. Costs a few cents, only when the owner presses Test. */
export async function testImageModel(locationId: string, platform: ImagePlatformId, modelId: string, endpointOverride?: string): Promise<ImageTestResult> {
  await requireVoiceManager(locationId);
  const model = imageModel(modelId);
  if (!model || !model.endpoints.some(e => e.platform === platform)) return { ok: false, message: "That model is not available on that platform.", ms: 0 };
  const key = await resolveImageKey(locationId, platform);
  if (!key) return { ok: false, message: `Add your ${IMAGE_PLATFORMS[platform].label} key first.`, ms: 0 };
  const choice: ImageChoice = { model: model.id, platform, ...(endpointOverride ? { endpoint: endpointOverride } : {}) };
  const endpoint = endpointFor(readImageChoice(choice) ?? choice);
  if (!endpoint) return { ok: false, message: "No endpoint for that choice.", ms: 0 };
  // A neutral test shot with no person: models that only edit get a plain gradient to edit.
  const rendered = renderShot({ ...SAMPLE_SHOT, character: undefined, subject: "a red apple on a wooden table", setting: "a bright kitchen", time: undefined, continuity: undefined, avoid: ["text"] }, model.dialect, { acceptsText: model.text, negative: model.negative });
  const needsReference = model.dialect === "edit" || endpoint.endsWith("/edit");
  const started = Date.now();
  try {
    const out = await generateImage(key, { platform, endpoint, model, prompt: rendered.prompt, negative: rendered.negative, aspect: "16:9", references: needsReference ? [{ data: testReferencePng(), mime: "image/png" }] : [] });
    const ms = Date.now() - started;
    await writeSettings(locationId, p => { const t = readTests(p[TESTS]); t[testKey(platform, model.id, endpoint)] = { ok: true, at: new Date().toISOString(), message: "Made a test picture.", ms }; p[TESTS] = t; });
    return { ok: true, message: "Made a test picture.", ms, dataUrl: `data:${out.contentType};base64,${out.bytes.toString("base64")}`, prompt: rendered.prompt, notes: rendered.notes };
  } catch (error) {
    const message = error instanceof ImageError ? error.message : "The test failed.";
    const ms = Date.now() - started;
    await writeSettings(locationId, p => { const t = readTests(p[TESTS]); t[testKey(platform, model.id, endpoint)] = { ok: false, at: new Date().toISOString(), message, ms }; p[TESTS] = t; }).catch(() => undefined);
    return { ok: false, message, ms, prompt: rendered.prompt };
  }
}
export { testKey };
