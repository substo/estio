import { spawn } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { StudioJobError, type StudioJobHandler } from "../worker/handlers";
import { z } from "zod";
import type { StudioDeviceConfig } from "../devices-policy";
import { AI_WORKFLOW_CONTRACT_VERSION } from "../../ai/workflow-capabilities";
import type { Usage } from "../../build/contract";
import { isSignedInTopbar, macVideoSchema, parseYoutubeSearchData, youtubeSearchUrl, type MacSearchResult, type MacVideo } from "../youtube-mac-search-policy";
import { applyRankings, buildPlanPrompt, buildRankPrompt, fitResultSize, planJsonSchema, planSchema, rankJsonSchema, rankSchema, relatedPayloadSchema, relatedResultSchema, relatedTraceSchema,
  type RankedCandidate, type RelatedCandidate, type RelatedTrace } from "../related-search-policy";
import type { LocalProvider, LocalTextAdapter } from "./providers";
import { summaryProviders } from "./library-summary";

const CHROME_PATHS = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"];
export function youtubeBrowserProfile(home = homedir(), env: NodeJS.ProcessEnv = process.env) {
  return env.STUDIO_YOUTUBE_PROFILE?.trim() || join(home, "Library", "Application Support", "Estio Studio", "youtube-browser");
}
export async function findChrome(env: NodeJS.ProcessEnv = process.env, exists: (path: string) => Promise<boolean> = async path => { try { await access(path, constants.X_OK); return true; } catch { return false; } }) {
  for (const path of [env.STUDIO_YOUTUBE_CHROME?.trim(), ...CHROME_PATHS]) if (path && await exists(path)) return path;
  return null;
}
/** Which stage of the browser search failed, from the error class only (messages can contain local paths and are never reported). */
export function classifyBrowserError(error: unknown): "profile_in_use" | "browser_launch" | "timeout" | "navigation" | "browser_closed" | "page_data" {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : "";
  if (/ProcessSingleton|user data directory is already in use|profile .* in use/i.test(message)) return "profile_in_use";
  if (/Executable doesn't exist|Failed to launch|browserType\.launch|spawn /i.test(message)) return "browser_launch";
  if (/Target (page, context or browser )?has been closed|Browser has been closed|Target closed/i.test(message)) return "browser_closed";
  if (/net::ERR|ERR_[A-Z_]+|NS_ERROR/.test(message)) return "navigation";
  if (name === "TimeoutError" || /Timeout \d+ms exceeded|timed out/i.test(message)) return /waitForFunction|ytInitialData/i.test(message) ? "page_data" : "timeout";
  return "page_data";
}
export interface YoutubeBrowser { search(query: string, limit: number, signal: AbortSignal): Promise<MacSearchResult> }
export interface YoutubeSearchReport { ready: boolean; signedIn?: boolean }

/** Runs a read-only YouTube search in the Mac's own Chrome profile (headless, signed in if the user did the one-time sign-in). */
export function createPlaywrightYoutubeBrowser(options: { executablePath: string; profileDir: string }): YoutubeBrowser {
  return {
    async search(query, limit, signal) {
      const { chromium } = await import("playwright");
      const context = await chromium.launchPersistentContext(options.profileDir, { executablePath: options.executablePath, headless: true, viewport: { width: 1280, height: 900 },
        args: ["--disable-blink-features=AutomationControlled"], ignoreDefaultArgs: ["--enable-automation"], timeout: 30_000 });
      const abort = () => { void context.close().catch(() => {}); };
      signal.addEventListener("abort", abort, { once: true });
      try {
        const page = context.pages()[0] ?? await context.newPage();
        await page.goto(youtubeSearchUrl(query), { waitUntil: "domcontentloaded", timeout: 30_000 });
        if (/\/sorry\/|accounts\.google\.com/.test(page.url())) throw new StudioJobError("youtube_blocked", "YouTube asked for a check in the Mac's browser. Open YouTube there, finish it, and search again.", false);
        // The EU consent wall blocks results until a choice is made; rejecting is the least-sharing choice.
        if (/consent\.youtube\.com/.test(page.url())) {
          await page.getByRole("button", { name: /reject all/i }).first().click({ timeout: 8_000 }).catch(() => {});
          await page.waitForURL(/youtube\.com\/results/, { timeout: 15_000 }).catch(() => {});
        }
        await page.waitForFunction(() => Boolean((window as unknown as { ytInitialData?: unknown }).ytInitialData), undefined, { timeout: 20_000 });
        const data = await page.evaluate(() => JSON.parse(JSON.stringify((window as unknown as { ytInitialData?: unknown }).ytInitialData ?? null)));
        const videos = parseYoutubeSearchData(data, limit);
        return { videos, signedIn: isSignedInTopbar(data) };
      } finally { signal.removeEventListener("abort", abort); await context.close().catch(() => {}); }
    },
  };
}

export interface RelatedModelDeps { adapter(provider: LocalProvider): LocalTextAdapter; usage(): Promise<Usage>; config(): StudioDeviceConfig }
const CONTRACT_NOTE = `[Studio capability contract ${AI_WORKFLOW_CONTRACT_VERSION} for related_video_search is prepended by the Mac]\n`;

/** The Mac's own signed-in Codex/Claude subscription, only when signed in with capacity. Never an API key.
 * When none is usable the reason is returned so the run's log can say exactly why (capacity reading, sign-in, or a failed probe). */
async function pickModel(models: RelatedModelDeps, signal: AbortSignal): Promise<{ picked: Picked } | { reason: string }> {
  const config = models.config();
  const usage = await models.usage().catch(() => null);
  if (!usage || !Object.keys(usage).length) return { reason: "the subscription capacity reading was unavailable" };
  const providers = summaryProviders(usage).filter(p => !config.textProvider || p === config.textProvider);
  if (!providers.length) return { reason: config.textProvider ? `${config.textProvider} has no fresh subscription capacity (or is not the provider chosen in Setup)` : "no Codex/Claude subscription has fresh capacity" };
  const reasons: string[] = [];
  for (const provider of providers) {
    const adapter = models.adapter(provider);
    for (let attempt = 0; attempt < 2; attempt++) {
      const ready = await adapter.readiness(signal).catch(() => null);
      if (ready?.ready && ready.authenticated && ready.loginMethod === (provider === "codex" ? "chatgpt" : "claudeai")) return { picked: { provider, adapter, model: config.textModel ?? undefined } };
      if (ready) { reasons.push(`${provider} is not ready or not signed in with its subscription`); break; }
      if (attempt === 1) reasons.push(`${provider}'s readiness check failed`);
    }
  }
  return { reason: reasons.join("; ") };
}
type Picked = { provider: LocalProvider; adapter: LocalTextAdapter; model: string | undefined };
/** Keep the start of a prompt (instructions + source) and say that the rest was cut, so the stored trace never exceeds its limits. */
const clipForTrace = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 40)}…[prompt shortened for the log]`);
async function modelStep<T>(picked: Picked, signal: AbortSignal, prompt: string, schema: z.ZodType<T>, jsonSchema: Record<string, unknown>) {
  const started = Date.now();
  const value = await picked.adapter.generate({ workflowContext: "related_video_search", signal, model: picked.model, prompt, jsonSchema, validate: v => schema.parse(v), timeoutMs: 120_000, maxResultBytes: 8192 });
  return { value, step: { provider: picked.provider, model: picked.model ?? "native-default", prompt: clipForTrace(CONTRACT_NOTE + prompt, 8900), response: JSON.stringify(value).slice(0, 3000), ms: Date.now() - started } };
}
const toVideo = (c: RankedCandidate | MacVideo): MacVideo => macVideoSchema.parse(Object.fromEntries(Object.entries({
  id: c.id, title: c.title.slice(0, 200), channelId: c.channelId, channelTitle: c.channelTitle?.slice(0, 80), publishedText: c.publishedText, viewsText: c.viewsText, description: c.description?.slice(0, 200),
  ...("score" in c ? { score: c.score, reason: c.reason, band: c.band } : {}) }).filter(([, v]) => v !== undefined)));

/** Search (and, when asked, plan and rank) in the Mac's own browser and subscription. Model steps degrade to an unranked result with a note; they never fail the search. */
export function createYoutubeSearchHandler(deps: { browser: () => Promise<YoutubeBrowser | null>; enabled: () => boolean; models?: RelatedModelDeps }): StudioJobHandler {
  const inner = createRelatedHandler(deps);
  return async (job, context) => {
    try { return await inner(job, context); }
    catch (error) {
      if (error instanceof StudioJobError || context.signal.aborted) throw error;
      // Never surface a bare "unexpected error": say where it happened (field paths only, no data) and do not retry.
      const where = error instanceof z.ZodError ? error.issues.slice(0, 3).map(issue => `${issue.path.join(".") || "result"}: ${issue.code}`).join("; ") : (error instanceof Error ? error.name : "unknown");
      throw new StudioJobError("related_internal_error", `Related search hit an internal error (${where}). It was not retried.`, false);
    }
  };
}

function createRelatedHandler(deps: { browser: () => Promise<YoutubeBrowser | null>; enabled: () => boolean; models?: RelatedModelDeps }): StudioJobHandler {
  return async (job, context) => {
    if (!deps.enabled()) throw new StudioJobError("local_policy", "Waiting for the computer's processing settings.", true, 300);
    const payload = relatedPayloadSchema.parse(job.payload);
    const mode = payload.mode ?? "search";
    const notes: string[] = [];
    const queries: RelatedTrace["queries"] = [];
    let picked: Picked | null = null; let noModel = "no subscription model is configured on this Mac";
    if (mode !== "search" && deps.models) { const choice = await pickModel(deps.models, context.signal); if ("picked" in choice) picked = choice.picked; else noModel = choice.reason; }

    // rank only: candidates came from the server (the YouTube API); the Mac only judges them.
    if (mode === "rank") {
      if (!payload.source || !payload.context || !payload.candidates?.length) throw new StudioJobError("invalid_job", "This relevance check was missing its source or candidates.", false);
      if (!picked) throw new StudioJobError("subscription_capacity", "Your Mac's Codex/Claude subscription is not signed in or has no capacity right now.", false);
      let ranked: RankedCandidate[]; let ranker: RelatedTrace["ranker"];
      try {
        const r = await modelStep(picked, context.signal, buildRankPrompt(payload.source, payload.context, payload.source.title, payload.candidates), rankSchema, rankJsonSchema);
        ranked = applyRankings(payload.candidates, r.value.rankings); ranker = r.step;
      } catch { ranked = applyRankings(payload.candidates, []); notes.push("The relevance model did not return a usable answer, so these results are not checked."); }
      return finish(ranked, { route: "api", mode: "rank", queries: [], ranker, notes });
    }

    const browser = await deps.browser();
    if (!browser) throw new StudioJobError("youtube_browser_missing", "Install Google Chrome on this Mac to search YouTube from it.", false);
    const search = async (query: string, by: "model" | "heuristic" | "user", limit: number) => {
      try { const found = await browser.search(query, limit, context.signal); queries.push({ query, by, found: found.videos.length }); return found; }
      catch (error) {
        if (error instanceof StudioJobError) throw error;
        if (context.signal.aborted) throw new StudioJobError("youtube_search_cancelled", "The Mac stopped before finishing this search.", false);
        throw new StudioJobError("youtube_search_failed", `The Mac could not read YouTube results (${classifyBrowserError(error)}). Search again; if it keeps failing, close other heavy apps or Chrome windows using the Studio profile.`, false);
      }
    };

    if (mode === "search" || !payload.source || !payload.context) {
      const found = await search(payload.query, "user", payload.limit);
      return finish(found.videos.map(v => ({ ...v, score: null, reason: "", band: "unranked" as const })), { route: "mac_browser", mode: "search", queries, notes }, found.signedIn, true);
    }

    // plan -> search -> rank
    let planned: string[] = []; let planner: RelatedTrace["planner"]; let focus = payload.source.title;
    if (picked) {
      try { const p = await modelStep(picked, context.signal, buildPlanPrompt(payload.source, payload.context), planSchema, planJsonSchema); planned = p.value.queries.slice(0, 3); planner = p.step; focus = p.value.focus; }
      catch { notes.push("The planning model did not return usable queries, so the keyword search was used."); }
    } else notes.push(`No usable subscription model (${noModel}), so results are not checked for relevance.`);
    const pool = new Map<string, RelatedCandidate>(); let signedIn: boolean | undefined;
    for (const [index, query] of (planned.length ? planned : [payload.query]).entries()) {
      try {
        const found = await search(query, planned.length ? "model" : "heuristic", 8); signedIn = found.signedIn ?? signedIn;
        for (const v of found.videos) if (!pool.has(v.id) && pool.size < 18) pool.set(v.id, v);
      } catch (error) { if (index === 0 && !pool.size) throw error; notes.push(`The search "${query.slice(0, 60)}" failed and was skipped.`); }
    }
    const candidates = [...pool.values()];
    let ranked: RankedCandidate[] = applyRankings(candidates, []); let ranker: RelatedTrace["ranker"];
    if (picked && candidates.length) {
      try { const r = await modelStep(picked, context.signal, buildRankPrompt(payload.source, payload.context, focus, candidates), rankSchema, rankJsonSchema); ranked = applyRankings(candidates, r.value.rankings); ranker = r.step; }
      catch { notes.push("The relevance model did not return a usable answer, so these results are not checked."); }
    }
    return finish(ranked, { route: "mac_browser", mode: "plan_search_rank", queries, planner, ranker, notes, focus }, signedIn);

    function finish(ranked: RankedCandidate[], parts: Omit<RelatedTrace, "version" | "candidates">, signedIn?: boolean, keepOrder = false) {
      const ordered = keepOrder ? ranked : ranked;
      const trace: RelatedTrace = relatedTraceSchema.parse({ version: 1, ...parts, notes: parts.notes?.length ? parts.notes.slice(0, 6).map(note => note.slice(0, 200)) : undefined,
        candidates: ordered.map(c => ({ id: c.id, score: c.score, band: c.band })) });
      return fitResultSize(relatedResultSchema.parse({ videos: ordered.map(toVideo), ...(signedIn === undefined ? {} : { signedIn }), trace }));
    }
  };
}

/** One-time sign-in: opens the Mac's normal Chrome (no automation flags, so Google allows it) on the same profile the searches use. */
export async function openYoutubeLogin(env: NodeJS.ProcessEnv = process.env, home = homedir()) {
  const chrome = await findChrome(env);
  if (!chrome) throw new Error("youtube_browser_missing");
  const profile = youtubeBrowserProfile(home, env);
  await mkdir(profile, { recursive: true, mode: 0o700 });
  spawn(chrome, [`--user-data-dir=${profile}`, "--no-first-run", "https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2F"], { detached: true, stdio: "ignore" }).unref();
  console.log("Chrome opened on the Studio YouTube profile. Sign in to YouTube, then quit Chrome (Cmd+Q) so searches can use the saved sign-in.");
}
