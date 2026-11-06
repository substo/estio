import db from "@/lib/db";
import { settingsService } from "@/lib/settings/service";
import { SETTINGS_DOMAINS } from "@/lib/settings/constants";
import { SettingsVersionConflictError } from "@/lib/settings/errors";
import { businessProfileSchema, type BusinessProfile } from "@/lib/business-profile/schema";
import { fetchPublicPage } from "@/lib/web/fetch-public-page";
import type { StudioDb } from "@/lib/studio/db";
import type { StudioJobHandler } from "@/lib/studio/worker/handlers";
import { onboardingStateSchema, say, updateRun, type OnboardingState } from "./state";
import { findTopic } from "./topics";
import { applySuggestions } from "./facts";
import { parseResearchOutput, researchInput, researchPrompt } from "./research-contract";
import { chooseResearchProvider, providerSearchesWeb, runProvider } from "./providers";
import { deviceRunProvider, readyResearchDevice, researchDevices } from "./device-route";

/**
 * Background research for onboarding, on the Studio job queue (durable, leased, retried; run by the hosted Studio worker):
 * "studio.onboarding_fetch" reads the business website (no AI), then queues one "studio.onboarding_research" job per topic. Each topic
 * job asks the Location's own AI and stores what it finds as unconfirmed suggestions in the Business profile. When a paired Mac
 * is ready, topic jobs run there instead (on its Codex/Claude subscription) and "studio.onboarding_apply" stores the result.
 * Worker-safe: no "server-only" imports.
 */
export const ONBOARDING_FETCH = "studio.onboarding_fetch";
export const ONBOARDING_RESEARCH = "studio.onboarding_research";
/** Applies research that ran on a paired Mac (queued by the database when the device job finishes). */
export const ONBOARDING_APPLY = "studio.onboarding_apply";
const scope = (locationId: string, domain: typeof SETTINGS_DOMAINS.LOCATION_ONBOARDING | typeof SETTINGS_DOMAINS.LOCATION_BUSINESS) => ({ scopeType: "LOCATION" as const, scopeId: locationId, domain });

export async function loadOnboardingState(locationId: string) {
  const doc = await settingsService.getDocument<OnboardingState>(scope(locationId, SETTINGS_DOMAINS.LOCATION_ONBOARDING));
  return { state: onboardingStateSchema.parse(doc?.payload ?? {}), version: doc?.version ?? 0 };
}
/** Read-modify-write with the document version; retried when another writer (a parallel topic job) got there first. */
async function retrying<T>(attempt: () => Promise<T>) {
  for (let i = 0; ; i++) {
    try { return await attempt(); }
    catch (error) { if (!(error instanceof SettingsVersionConflictError) || i >= 5) throw error; await new Promise(r => setTimeout(r, 50 + Math.random() * 200)); }
  }
}
export function updateOnboardingState(locationId: string, change: (state: OnboardingState) => OnboardingState, actorUserId: string | null = null) {
  return retrying(async () => {
    const { state, version } = await loadOnboardingState(locationId);
    const next = onboardingStateSchema.parse(change(state));
    await settingsService.upsertDocument({ ...scope(locationId, SETTINGS_DOMAINS.LOCATION_ONBOARDING), payload: next, actorUserId, expectedVersion: version });
    return next;
  });
}
export function updateBusinessProfile(locationId: string, change: (profile: BusinessProfile | null) => BusinessProfile, actorUserId: string | null = null) {
  return retrying(async () => {
    const doc = await settingsService.getDocument<BusinessProfile>(scope(locationId, SETTINGS_DOMAINS.LOCATION_BUSINESS));
    const next = businessProfileSchema.parse(change(doc ? businessProfileSchema.parse(doc.payload) : null));
    await settingsService.upsertDocument({ ...scope(locationId, SETTINGS_DOMAINS.LOCATION_BUSINESS), payload: next, actorUserId, expectedVersion: doc?.version ?? 0 });
    return next;
  });
}

/** Same-site pages worth reading: the home page and the usual about/contact paths. */
export function candidatePages(website: string) {
  const base = new URL(website);
  return [base.href, ...["/about", "/about-us", "/contact", "/contact-us"].map(p => new URL(p, base.origin).href)].filter((u, i, all) => all.indexOf(u) === i);
}

type FetchPayload = { batch: string; topics: string[]; website?: string; actorId: string | null; createdBy: string };
type ResearchPayload = { batch: string; topic: string; actorId: string | null };
type ApplyPayload = { jobId: string; batch: string; topic: string; actorId: string | null; status: "succeeded" | "failed" | "cancelled";
  result?: { research: unknown; provider: string; model: string }; error?: string };

/** Same parse, mapping and confirmed-fact protection for every provider, server or Mac. */
async function applyResearchReply(locationId: string, topic: NonNullable<ReturnType<typeof findTopic>>, runId: string, text: string, provider: string) {
  const location = await db.location.findUnique({ where: { id: locationId }, select: { name: true, timeZone: true } });
  const parsed = parseResearchOutput(topic.id, text);
  const now = new Date().toISOString();
  let applied: string[] = [];
  const profileItems = parsed.suggestions.filter(s => s.path).map(s => ({ kind: s.kind, path: s.path!, value: s.value, sources: s.sources }));
  if (profileItems.length) await updateBusinessProfile(locationId, profile => { const r = applySuggestions(profile, profileItems, now); applied = r.applied; return r.profile; });
  const timeZone = parsed.suggestions.find(s => s.location === "timeZone");
  const sources = [...new Set(parsed.suggestions.flatMap(s => s.sources))].slice(0, 20);
  await updateOnboardingState(locationId, s => {
    let next = updateRun(s, runId, { status: "done", provider, finishedAt: new Date().toISOString(), applied, sources });
    // Name and time zone live on Location: they wait in the state until the owner confirms them.
    if (parsed.businessName && parsed.businessName !== location?.name && !next.suggestedName) next = { ...next, suggestedName: { value: parsed.businessName, sources } };
    if (timeZone && !location?.timeZone && typeof timeZone.value === "string") next = { ...next, suggestedTimeZone: { value: timeZone.value, sources: timeZone.sources } };
    const found = applied.length + (timeZone ? 1 : 0);
    return found ? say(next, "agent", `${topic.title}: I found ${found} detail${found === 1 ? "" : "s"} to check.`, topic.id) : next;
  });
  return { applied: applied.length, dropped: parsed.dropped.length, provider };
}

export function createOnboardingHandlers(studio: StudioDb, deps: { fetchPage?: typeof fetchPublicPage } = {}): Record<string, StudioJobHandler> {
  const fetchPage = deps.fetchPage ?? fetchPublicPage;
  const fetchJob: StudioJobHandler = async job => {
    const payload = job.payload as FetchPayload;
    const pages: OnboardingState["pages"] = [];
    if (payload.website) {
      for (const url of candidatePages(payload.website)) {
        if (pages.length >= 4) break;
        const page = await fetchPage(url, { timeoutMs: 12_000, maxTextChars: 6000 }).catch(() => null);
        if (page && page.status < 400 && page.text.trim() && !pages.some(p => p.url === page.finalUrl))
          pages.push({ url: page.finalUrl, title: page.title?.slice(0, 300) ?? null, text: page.text.slice(0, 6000) });
      }
    }
    // A running, opted-in Mac with a subscription goes first (owner decision: subscriptions first); otherwise server research.
    const device = readyResearchDevice(await researchDevices(studio, job.location_id).catch(() => []));
    const state = await updateOnboardingState(job.location_id, s => {
      if (s.batch !== payload.batch) return s;
      let next = { ...s, pages };
      if (device) {
        for (const topic of payload.topics) next = updateRun(next, `${payload.batch}:${topic}`, { provider: deviceRunProvider(device.id) });
        next = say(next, "agent", `I'm researching on ${device.name} with your own ${device.readiness.providers.map(p => p === "codex" ? "ChatGPT (Codex)" : "Claude").join(" or ")} subscription.`);
      }
      return next;
    });
    if (state.batch !== payload.batch) return { superseded: true };
    const location = device ? await db.location.findUnique({ where: { id: job.location_id }, select: { authRealm: true } }) : null;
    let onMac = 0;
    for (const topic of payload.topics) {
      if (device) {
        try {
          await studio.call("studio_enqueue_device_onboarding_research", { p_location_id: job.location_id, p_device_id: device.id,
            p_payload: { batch: payload.batch, topic, actorId: payload.actorId, app: location?.authRealm === "substo" ? "substo" : "estio", input: state.input, pages },
            p_idempotency_key: `onboarding:${payload.batch}:${topic}:mac`, p_created_by: payload.createdBy });
          onMac++; continue;
        } catch { /* The Mac stopped accepting research meanwhile: this topic uses the server connections. */
          await updateOnboardingState(job.location_id, s => updateRun(s, `${payload.batch}:${topic}`, { provider: undefined }));
        }
      }
      await studio.call("studio_enqueue_job", { p_location_id: job.location_id, p_kind: ONBOARDING_RESEARCH, p_payload: { batch: payload.batch, topic, actorId: payload.actorId },
        p_idempotency_key: `onboarding:${payload.batch}:${topic}`, p_created_by: payload.createdBy, p_max_attempts: 2 });
    }
    return { pages: pages.length, topics: payload.topics.length, onMac };
  };

  const researchJob: StudioJobHandler = async job => {
    const payload = job.payload as ResearchPayload;
    const topic = findTopic(payload.topic);
    const runId = `${payload.batch}:${payload.topic}`;
    const { state } = await loadOnboardingState(job.location_id);
    if (!topic || state.batch !== payload.batch) return { superseded: true };
    const provider = await chooseResearchProvider(job.location_id);
    if (!provider) {
      await updateOnboardingState(job.location_id, s => updateRun(s, runId, { status: "failed", finishedAt: new Date().toISOString(), error: "No AI connection is ready." }));
      return { failed: "no_provider" };
    }
    await updateOnboardingState(job.location_id, s => updateRun(s, runId, { status: "running", provider, startedAt: new Date().toISOString() }));
    try {
      const location = await db.location.findUnique({ where: { id: job.location_id }, select: { authRealm: true } });
      const app = location?.authRealm === "substo" ? "substo" : "estio";
      const webSearch = providerSearchesWeb(provider);
      const reply = await runProvider({ provider, locationId: job.location_id, userId: payload.actorId, webSearch, action: `research_${topic.id}`,
        system: researchPrompt(topic, { ...state.input, app, webSearch }), user: researchInput({ ...state.input, pages: state.pages }), signal: undefined });
      return await applyResearchReply(job.location_id, topic, runId, reply.text, reply.provider);
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 300) : "Research failed";
      await updateOnboardingState(job.location_id, s => updateRun(s, runId, { status: "failed", finishedAt: new Date().toISOString(), error: message }));
      return { failed: message };
    }
  };
  const applyJob: StudioJobHandler = async job => {
    const payload = job.payload as ApplyPayload;
    const topic = findTopic(payload.topic);
    const runId = `${payload.batch}:${payload.topic}`;
    const { state } = await loadOnboardingState(job.location_id);
    if (!topic || state.batch !== payload.batch) return { superseded: true };
    if (payload.status !== "succeeded" || !payload.result) {
      const error = (payload.error || "Research on the Mac did not finish.").slice(0, 300);
      await updateOnboardingState(job.location_id, s => updateRun(s, runId, { status: "failed", finishedAt: new Date().toISOString(), error }));
      return { failed: error };
    }
    const provider = payload.result.provider === "claude" ? "mac_claude" : "mac_codex";
    return applyResearchReply(job.location_id, topic, runId, JSON.stringify(payload.result.research), provider);
  };
  return { [ONBOARDING_FETCH]: fetchJob, [ONBOARDING_RESEARCH]: researchJob, [ONBOARDING_APPLY]: applyJob };
}
