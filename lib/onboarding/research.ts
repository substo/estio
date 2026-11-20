import db from "@/lib/db";
import { settingsService } from "@/lib/settings/service";
import { SETTINGS_DOMAINS } from "@/lib/settings/constants";
import { SettingsVersionConflictError } from "@/lib/settings/errors";
import { businessProfileSchema, type BusinessProfile } from "@/lib/business-profile/schema";
import { fetchPublicPage } from "@/lib/web/fetch-public-page";
import { StudioDbError, type StudioDb } from "@/lib/studio/db";
import { Prisma } from "@prisma/client";
import { AI_KIND_LABELS } from "@/lib/ai/routing";
import { classifyAiAttemptFailure } from "@/lib/ai/route-errors";
import type { CrmRoutePlan } from "@/lib/ai/crm-routing";
import type { StudioJobHandler } from "@/lib/studio/worker/handlers";
import { onboardingStateSchema, say, updateRun, type OnboardingState } from "./state";
import { findTopic } from "./topics";
import { businessView } from "@/lib/business-profile/view";
import { factAt } from "./facts";
import { applySuggestions } from "./facts";
import { parseResearchOutput, researchInput, researchPrompt } from "./research-contract";
import { runOnboardingRoute } from "./providers";
import { deviceRunProvider } from "./device-route";
import { planOnboardingResearch, singleOnboardingServerStep, type ResearchRequestOwner } from "./research-route";

/**
 * Background research for onboarding, on the Studio job queue (durable, leased, retried; run by the hosted Studio worker):
 * "studio.onboarding_fetch" reads the business website (no AI), then queues one "studio.onboarding_research" job per topic. Each topic
 * job uses the Location's AI order and stores unconfirmed suggestions in the Business profile.
 * An explicit owner request carries the account scope through any queued Mac or server steps. Automatic work has no Mac scope.
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

type FetchPayload = { batch: string; topics: string[]; website?: string; actorId: string | null; createdBy: string; app?: ResearchRequestOwner["app"] };
type ResearchContinuation = ResearchRequestOwner & { remainingKinds: string[]; requested: CrmRoutePlan["requested"]; reason: string };
type ResearchPayload = { batch: string; topic: string; actorId: string | null; owner?: ResearchRequestOwner; continuation?: ResearchContinuation };
type ApplyPayload = { jobId: string; batch: string; topic: string; actorId: string | null; status: "succeeded" | "failed" | "cancelled";
  result?: { research: unknown; provider: string; model: string }; error?: string; continuation?: ResearchContinuation };

/** Read canonical choices at execution time, so research never relies on stale onboarding copies. */
async function researchContext(locationId: string, topicId: string) {
  const doc = await settingsService.getDocument<BusinessProfile>(scope(locationId, SETTINGS_DOMAINS.LOCATION_BUSINESS));
  const profile = doc ? businessProfileSchema.parse(doc.payload) : null;
  const view = businessView(profile, {});
  const excluded = (findTopic(topicId)?.fields ?? []).filter(f => {
    if (!("profile" in f.target)) return false;
    const fact = factAt(profile, f.target.profile);
    return !!fact?.confirmedAt || fact?.status === "not_applicable" || fact?.status === "not_yet";
  }).map(f => f.key);
  return { ...view.setup, summary: view.summary, excluded };
}

/** Same parse, mapping and confirmed-fact protection for every provider, server or Mac. */
async function applyResearchReply(locationId: string, topic: NonNullable<ReturnType<typeof findTopic>>, runId: string, text: string, provider: string, model: string) {
  const location = await db.location.findUnique({ where: { id: locationId }, select: { name: true, timeZone: true } });
  const parsed = parseResearchOutput(topic.id, text);
  const now = new Date().toISOString();
  let applied: string[] = [];
  const profileItems = parsed.suggestions.filter(s => s.path).map(s => ({ kind: s.kind, path: s.path!, value: s.value, sources: s.sources }));
  if (profileItems.length) await updateBusinessProfile(locationId, profile => { const r = applySuggestions(profile, profileItems, now); applied = r.applied; return r.profile; });
  const timeZone = parsed.suggestions.find(s => s.location === "timeZone");
  const sources = [...new Set(parsed.suggestions.flatMap(s => s.sources))].slice(0, 20);
  await updateOnboardingState(locationId, s => {
    let next = updateRun(s, runId, { status: "done", provider, model, finishedAt: new Date().toISOString(), applied, sources });
    // Name and time zone live on Location: they wait in the state until the owner confirms them.
    if (!location?.name && parsed.businessName && parsed.businessName !== location?.name && !next.suggestedName) next = { ...next, suggestedName: { value: parsed.businessName, sources } };
    if (timeZone && !location?.timeZone && typeof timeZone.value === "string") next = { ...next, suggestedTimeZone: { value: timeZone.value, sources: timeZone.sources } };
    const found = applied.length + (timeZone ? 1 : 0);
    return found ? say(next, "agent", `${topic.title}: I found ${found} detail${found === 1 ? "" : "s"} to check.`, topic.id) : next;
  });
  return { applied: applied.length, dropped: parsed.dropped.length, provider, model };
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
    const state = await updateOnboardingState(job.location_id, s => s.batch === payload.batch ? { ...s, pages } : s);
    if (state.batch !== payload.batch) return { superseded: true };
    for (const topic of payload.topics) {
      await studio.call("studio_enqueue_job", { p_location_id: job.location_id, p_kind: ONBOARDING_RESEARCH, p_payload: { batch: payload.batch, topic, actorId: payload.actorId, ...(payload.app ? { owner: { app: payload.app, createdBy: payload.createdBy } } : {}) },
        p_idempotency_key: `onboarding:${payload.batch}:${topic}`, p_created_by: payload.createdBy, p_max_attempts: 1 });
    }
    return { pages: pages.length, topics: payload.topics.length, onMac: 0 };
  };

  const researchJob: StudioJobHandler = async (job, worker) => {
    const payload = job.payload as ResearchPayload;
    const topic = findTopic(payload.topic);
    const runId = `${payload.batch}:${payload.topic}`;
    const { state } = await loadOnboardingState(job.location_id);
    if (!topic || state.batch !== payload.batch) return { superseded: true };
    const existingRun = state.runs.find(run => run.id === runId);
    if (existingRun?.status === "running") {
      await updateOnboardingState(job.location_id, s => updateRun(s, runId, { status: "failed", finishedAt: new Date().toISOString(), error: "The previous research attempt was interrupted. Start a new request." }));
      return { failed: "interrupted" };
    }
    if (existingRun && ["done", "failed"].includes(existingRun.status)) return { skipped: existingRun.status };
    const location = await db.location.findUnique({ where: { id: job.location_id }, select: { authRealm: true } });
    const app = location?.authRealm === "substo" ? "substo" : "estio";
    const suppliedOwner = payload.continuation ?? payload.owner;
    const owner = suppliedOwner?.app === app ? suppliedOwner : undefined;
    try {
      const plan = await planOnboardingResearch(studio, job.location_id, owner, payload.continuation?.remainingKinds);
      const requested = payload.continuation?.requested ?? plan.requested;
      const context = await researchContext(job.location_id, topic.id);
      let reason = payload.continuation?.reason ?? null;
      let remaining = plan.steps;
      while (remaining.length) {
        worker.signal.throwIfAborted();
        const [step, ...rest] = remaining;
        remaining = rest;
        const switchReason = requested && step.kind !== requested.kind
          ? `${reason ?? AI_KIND_LABELS[requested.kind] + " unavailable"} → ${AI_KIND_LABELS[step.kind]}` : null;
        if ("deviceId" in step && owner) {
          // This Mac can try consecutive steps only; the next hosted or other-Mac step needs the server lease.
          const candidates = [step.kind];
          while (remaining.length && "deviceId" in remaining[0] && remaining[0].deviceId === step.deviceId) {
            candidates.push(remaining[0].kind);
            remaining = remaining.slice(1);
          }
          await updateOnboardingState(job.location_id, s => updateRun(s, runId, { status: "queued", provider: deviceRunProvider(step.deviceId) }));
          try {
            await studio.call("studio_enqueue_routed_onboarding_research", {
              p_location_id: job.location_id, p_actor_app: owner.app, p_clerk_user_id: owner.createdBy, p_device_id: step.deviceId,
              p_payload: { batch: payload.batch, topic: payload.topic, actorId: payload.actorId, app, input: state.input, context, pages: state.pages },
              p_idempotency_key: `onboarding:mac:${job.id}:${step.kind}`, p_kinds: candidates, p_remaining: remaining.map(s => s.kind),
              p_requested: requested, p_reason: switchReason,
            });
            return { onMac: true };
          } catch (error) {
            if (!(error instanceof StudioDbError && error.code === "P2030")) throw error;
            reason = `${AI_KIND_LABELS[step.kind]} became unavailable before generation`;
            continue;
          }
        }
        if ("deviceId" in step) continue;
        await updateOnboardingState(job.location_id, s => updateRun(s, runId, { status: "running", provider: step.kind, startedAt: new Date().toISOString() }));
        let reply;
        try {
          reply = await runOnboardingRoute({
            operation: "onboarding_research", locationId: job.location_id, userId: payload.actorId, action: `research_${topic.id}`,
            plan: singleOnboardingServerStep(plan.server, step, requested, switchReason),
            system: webSearch => researchPrompt(topic, { ...state.input, ...context, app, webSearch }),
            user: researchInput({ ...state.input, pages: state.pages }), signal: worker.signal,
          });
        } catch (error) {
          const failure = classifyAiAttemptFailure(error);
          if (failure.stage !== "before_generation" || !remaining.length) throw error;
          reason = `${AI_KIND_LABELS[step.kind]}: ${failure.reason}`;
          continue;
        }
        // Validation and application happen after successful generation, outside the fallback boundary.
        return await applyResearchReply(job.location_id, topic, runId, reply.text, reply.provider, reply.model);
      }
      throw new Error("No eligible AI connection in this Location's order is ready.");
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
    if (payload.continuation) {
      await studio.call("studio_enqueue_job", {
        p_location_id: job.location_id, p_kind: ONBOARDING_RESEARCH,
        p_payload: { batch: payload.batch, topic: payload.topic, actorId: payload.actorId, continuation: payload.continuation },
        p_idempotency_key: `onboarding:continue:${payload.jobId}`, p_created_by: payload.continuation.createdBy, p_max_attempts: 1,
      });
      return { continued: true };
    }
    if (payload.status !== "succeeded" || !payload.result) {
      const error = (payload.error || "Research on the Mac did not finish.").slice(0, 300);
      await updateOnboardingState(job.location_id, s => updateRun(s, runId, { status: "failed", finishedAt: new Date().toISOString(), error }));
      return { failed: error };
    }
    const provider = payload.result.provider === "claude" ? "mac_claude" : "mac_codex";
    const recorded = await studio.one<{ result: ApplyPayload["result"] }>(Prisma.sql`
      select result from studio.studio_jobs where id=${payload.jobId}::uuid and location_id=${job.location_id}
       and kind='studio.onboarding_research' and execution_target='device' and status='succeeded'`);
    return applyResearchReply(job.location_id, topic, runId, JSON.stringify(payload.result.research), provider, recorded?.result?.model ?? payload.result.model);
  };
  return { [ONBOARDING_FETCH]: fetchJob, [ONBOARDING_RESEARCH]: researchJob, [ONBOARDING_APPLY]: applyJob };
}
