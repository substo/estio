import "server-only";
import db from "@/lib/db";
import { settingsService } from "@/lib/settings/service";
import { SETTINGS_DOMAINS, SETTINGS_SECRET_KEYS } from "@/lib/settings/constants";
import { keyHint } from "../voices/policy";
import { requireVoiceManager, VoiceSettingsError } from "../voices/keys";
import { getAvatarState } from "../avatar";
import { avatarObjectKey } from "../avatar-policy";
import { createStudioR2Store, readStudioR2Config } from "../media-r2";
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
const CHOICE = "studioImageChoice", FALLBACK = "studioImageFallback", TESTS = "studioImageTests";
export interface ImageTestRecord { ok: boolean; at: string; message: string; ms: number }
export type ImageTests = Record<string, ImageTestRecord>;
const testKey = (platform: string, model: string, endpoint: string) => `${platform}|${model}|${endpoint}`.slice(0, 200);
const readTests = (value: unknown): ImageTests => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: ImageTests = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 80)) { const r = v as Partial<ImageTestRecord>; if (r && typeof r.ok === "boolean" && typeof r.at === "string") out[k] = { ok: r.ok, at: r.at.slice(0, 40), message: String(r.message ?? "").slice(0, 240), ms: Number(r.ms) || 0 }; }
  return out;
};
export async function getImageSettings(locationId: string): Promise<{ choice: ImageChoice | null; fallback: ImageChoice | null; tests: ImageTests }> {
  const doc = await settingsService.getDocument<Record<string, unknown>>(settingsRef(locationId)).catch(() => null);
  return { choice: readImageChoice(doc?.payload?.[CHOICE]), fallback: readImageChoice(doc?.payload?.[FALLBACK]), tests: readTests(doc?.payload?.[TESTS]) };
}
export async function writeLocationAiSettings(locationId: string, mutate: (payload: Record<string, unknown>) => void) {
  const access = await requireVoiceManager(locationId);
  const current = await settingsService.getDocument<Record<string, unknown>>(settingsRef(access.locationId));
  const payload = { whatsappTranscriptRetentionDays: 90, ...(current?.payload ?? {}) } as Record<string, unknown>;
  mutate(payload);
  await settingsService.upsertDocument({ ...settingsRef(access.locationId), payload, actorUserId: await actorId(access), expectedVersion: current?.version ?? 0, schemaVersion: 1 });
}
/** The model that draws storyboard frames, and the one used if it fails. Either can be cleared. */
export async function setImageChoices(locationId: string, primary: ImageChoice | null, fallback: ImageChoice | null) {
  const clean = primary ? readImageChoice(primary) : null, cleanFallback = fallback ? readImageChoice(fallback) : null;
  if ((primary && !clean) || (fallback && !cleanFallback)) throw new VoiceSettingsError("That model is not available on that platform.");
  await writeLocationAiSettings(locationId, p => {
    if (clean) p[CHOICE] = clean; else delete p[CHOICE];
    if (cleanFallback && clean) p[FALLBACK] = cleanFallback; else delete p[FALLBACK];
  });
}
export const setImageChoice = (locationId: string, choice: ImageChoice | null) => setImageChoices(locationId, choice, null);
/** Model ids the platform offers for this key (OpenAI and Google only). */
export async function discoverImageModels(locationId: string, platform: "openai" | "google"): Promise<string[]> {
  const key = await resolveImageKey(locationId, platform);
  return key ? listImageModels(platform, key) : [];
}

export interface ImageTestResult { ok: boolean; message: string; ms: number; dataUrl?: string; prompt?: string; notes?: string[] }
/** One real image with the chosen model and platform, so a key is proven by a picture and not by a guess. Costs a few cents, only when the owner presses Test. */
/** The signed-in user's own saved photo as a reference, read from private storage for this one request. */
async function avatarReference(locationId: string, userId: string): Promise<{ data: Buffer; mime: string } | null> {
  const state = await getAvatarState(locationId), config = readStudioR2Config();
  if (!state || !config) return null;
  const url = await createStudioR2Store(config).presignRead({ key: avatarObjectKey(locationId, userId), contentType: state.contentType, contentDisposition: "inline" });
  const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!r.ok) return null;
  const data = Buffer.from(await r.arrayBuffer());
  return data.length && data.length <= 6 * 1024 * 1024 ? { data, mime: state.contentType } : null;
}

export async function testImageModel(locationId: string, platform: ImagePlatformId, modelId: string, endpointOverride?: string, withPhoto = false): Promise<ImageTestResult> {
  const access = await requireVoiceManager(locationId);
  const model = imageModel(modelId);
  if (!model || !model.endpoints.some(e => e.platform === platform)) return { ok: false, message: "That model is not available on that platform.", ms: 0 };
  const key = await resolveImageKey(locationId, platform);
  if (!key) return { ok: false, message: `Add your ${IMAGE_PLATFORMS[platform].label} key first.`, ms: 0 };
  const choice: ImageChoice = { model: model.id, platform, ...(endpointOverride ? { endpoint: endpointOverride } : {}) };
  const endpoint = endpointFor(readImageChoice(choice) ?? choice);
  if (!endpoint) return { ok: false, message: "No endpoint for that choice.", ms: 0 };
  let photo: { data: Buffer; mime: string } | null = null;
  if (withPhoto) {
    if (model.references < 1) return { ok: false, message: `${model.label} does not take a reference photo, so it cannot keep your face. Pick a model that does.`, ms: 0 };
    photo = await avatarReference(locationId, access.userId);
    if (!photo) return { ok: false, message: "Save your photo first (Settings → Voices → Your look).", ms: 0 };
  }
  // Without a photo: a neutral shot with no person (models that only edit get a plain gradient). With it: the storyboard shot, the same person in a new scene.
  const rendered = photo
    ? renderShot({ ...SAMPLE_SHOT, character: "the person in the reference photo, same face and hair" }, model.dialect, { acceptsText: model.text, negative: model.negative })
    : renderShot({ ...SAMPLE_SHOT, character: undefined, subject: "a red apple on a wooden table", setting: "a bright kitchen", time: undefined, continuity: undefined, avoid: ["text"] }, model.dialect, { acceptsText: model.text, negative: model.negative });
  const needsReference = Boolean(photo) || model.dialect === "edit" || endpoint.endsWith("/edit");
  const started = Date.now();
  try {
    const out = await generateImage(key, { platform, endpoint, model, prompt: rendered.prompt, negative: rendered.negative, aspect: "16:9", references: needsReference ? [photo ?? { data: testReferencePng(), mime: "image/png" }] : [] });
    const ms = Date.now() - started;
    await writeLocationAiSettings(locationId, p => { const t = readTests(p[TESTS]); t[testKey(platform, model.id, endpoint)] = { ok: true, at: new Date().toISOString(), message: "Made a test picture.", ms }; p[TESTS] = t; });
    return { ok: true, message: "Made a test picture.", ms, dataUrl: `data:${out.contentType};base64,${out.bytes.toString("base64")}`, prompt: rendered.prompt, notes: rendered.notes };
  } catch (error) {
    const message = error instanceof ImageError ? error.message : "The test failed.";
    const ms = Date.now() - started;
    await writeLocationAiSettings(locationId, p => { const t = readTests(p[TESTS]); t[testKey(platform, model.id, endpoint)] = { ok: false, at: new Date().toISOString(), message, ms }; p[TESTS] = t; }).catch(() => undefined);
    return { ok: false, message, ms, prompt: rendered.prompt };
  }
}
export { testKey };
export { settingsRef as locationAiSettingsRef };
