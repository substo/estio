import assert from "node:assert/strict";
import test from "node:test";
import { defaultDeviceConfig } from "../devices-policy";
import { StudioJobError, StudioProviderRejectedError } from "../worker/handlers";
import type { LocalProvider, LocalTextAdapter } from "./providers";
import { classifyBrowserError, createYoutubeSearchHandler, type YoutubeBrowser } from "./youtube-search";

const reading = (remaining: number) => ({ remaining, windows: [], at: new Date().toISOString() });
const usage = async () => ({ codex: reading(90), claudeAgent: reading(90) });
const source = { kind: "reference" as const, title: "New Generation YouTube Influencers", summary: "Doctors and lawyers turning into creators." };
const context = { approvedTitles: ["Think Media"], pinnedKnowledge: ["Studio helps creators"], profile: { offer: "Studio" } };
const v = (id: string, title: string) => ({ id, title, channelTitle: "Ch", publishedText: "1 yr ago", viewsText: "10 views" });
const ids = { a: "aaaaaaaaaaa", b: "bbbbbbbbbbb", c: "ccccccccccc", d: "ddddddddddd" };
const job = (payload: unknown, route?: unknown) => ({ route, id: "j", location_id: "loc", kind: "studio.youtube_search", payload, lease_token: "t", attempts: 1, max_attempts: 1 }) as never;
const ctx = () => ({ signal: new AbortController().signal, workerId: "w" }) as never;

function model(script: { plan?: unknown; rank?: unknown; failPlan?: boolean; failRank?: boolean }, prompts: string[] = []) {
  return { adapter: (provider: LocalProvider): LocalTextAdapter => ({ provider, readiness: async () => ({ installed: true, authenticated: true, ready: true, models: [], loginMethod: provider === "codex" ? "chatgpt" : "claudeai" }),
    generate: async req => { prompts.push(req.prompt); assert.equal(req.workflowContext, "related_video_search");
      const isPlan = /search queries/.test(req.prompt); if (isPlan ? script.failPlan : script.failRank) throw new Error("model down");
      return req.validate(isPlan ? script.plan : script.rank); } }), usage, config: () => ({ ...defaultDeviceConfig, textProvider: "codex" as const }) };
}
const browser = (byQuery: Record<string, ReturnType<typeof v>[]>, seen: string[] = []): (() => Promise<YoutubeBrowser>) => async () => ({ search: async q => { seen.push(q); if (!byQuery[q]) throw new Error("none"); return { videos: byQuery[q], signedIn: false }; } });
const run = (deps: Parameters<typeof createYoutubeSearchHandler>[0], payload: unknown, route?: unknown) => createYoutubeSearchHandler(deps)(job(payload, route), ctx()) as Promise<{ videos: Array<{ id: string; score?: number | null; band?: string }>; trace: { mode: string; route: string; focus?: string; queries: Array<{ query: string; by: string; found: number }>; planner?: { prompt: string; provider: string }; ranker?: { prompt: string; provider: string; model: string }; notes?: string[]; candidates: Array<{ id: string; band: string }> } }>;

test("plan, search each planned query, merge and rank: relevant first, trace records prompts, model, queries and scores", async () => {
  const prompts: string[] = []; const seen: string[] = [];
  const result = await run({ enabled: () => true, models: model({ plan: { queries: ["professionals becoming youtubers", "doctor creator channel"], focus: "professionals as creators" },
    rank: { rankings: [{ id: ids.a, score: 20, reason: "Different topic" }, { id: ids.b, score: 91, reason: "Same subject" }, { id: ids.c, score: 55, reason: "Loose" }] } }, prompts),
    browser: browser({ "professionals becoming youtubers": [v(ids.a, "Fake followers"), v(ids.b, "Doctors turn YouTubers")], "doctor creator channel": [v(ids.b, "Doctors turn YouTubers"), v(ids.c, "Creator tips")] }, seen) },
    { query: "heuristic words", limit: 6, mode: "plan_search_rank", source, context });
  assert.deepEqual(seen, ["professionals becoming youtubers", "doctor creator channel"]);
  assert.deepEqual(result.videos.map(x => [x.id, x.score, x.band]), [[ids.b, 91, "relevant"], [ids.c, 55, "maybe"], [ids.a, 20, "off_topic"]]);
  assert.equal(result.trace.mode, "plan_search_rank"); assert.equal(result.trace.route, "mac_browser"); assert.equal(result.trace.focus, "professionals as creators");
  assert.deepEqual(result.trace.queries.map(q => [q.query, q.by, q.found]), [["professionals becoming youtubers", "model", 2], ["doctor creator channel", "model", 2]]);
  assert.match(result.trace.planner!.prompt, /New Generation YouTube Influencers/); assert.match(result.trace.ranker!.prompt, /Doctors turn YouTubers/); assert.equal(result.trace.planner!.provider, "codex");
  assert.equal(prompts.length, 2);
});
test("a failing planner falls back to the keyword query, a failing ranker leaves results unranked, and notes say why", async () => {
  const r1 = await run({ enabled: () => true, models: model({ failPlan: true, rank: { rankings: [{ id: ids.a, score: 80, reason: "ok" }] } }), browser: browser({ "heuristic words": [v(ids.a, "A")] }) }, { query: "heuristic words", limit: 6, mode: "plan_search_rank", source, context });
  assert.deepEqual(r1.trace.queries.map(q => q.by), ["heuristic"]); assert.match(r1.trace.notes!.join(" "), /keyword search/); assert.equal(r1.videos[0].band, "relevant");
  const r2 = await run({ enabled: () => true, models: model({ plan: { queries: ["q one"], focus: "f" }, failRank: true }), browser: browser({ "q one": [v(ids.a, "A")] }) }, { query: "k", limit: 6, mode: "plan_search_rank", source, context });
  assert.equal(r2.videos[0].band, "unranked"); assert.equal(r2.videos[0].score, null); assert.match(r2.trace.notes!.join(" "), /not checked/);
});
test("no usable model: still searches, results are labelled unranked with the reason", async () => {
  const result = await run({ enabled: () => true, browser: browser({ k: [v(ids.a, "A")] }) }, { query: "k", limit: 6, mode: "plan_search_rank", source, context });
  assert.equal(result.videos[0].band, "unranked"); assert.match(result.trace.notes!.join(" "), /No usable subscription model \(no subscription model is configured/);
});
test("rank-only mode judges server-supplied candidates, needs a model, and never opens a browser", async () => {
  let opened = false;
  const base = { enabled: () => true, browser: async () => { opened = true; return null; } };
  const candidates = [{ id: ids.a, title: "A", channelTitle: "x" }, { id: ids.d, title: "D", channelTitle: "y" }];
  const payload = { query: "k", limit: 6, mode: "rank", source, context, candidates };
  const result = await run({ ...base, models: model({ rank: { rankings: [{ id: ids.d, score: 77, reason: "Good" }, { id: ids.a, score: 10, reason: "Bad" }] } }) }, payload);
  assert.deepEqual(result.videos.map(x => x.id), [ids.d, ids.a]); assert.equal(result.trace.route, "api"); assert.equal(result.trace.mode, "rank"); assert.equal(opened, false);
  await assert.rejects(run(base, payload), (e: unknown) => e instanceof StudioJobError && e.code === "subscription_capacity");
  await assert.rejects(run({ ...base, models: model({}) }, { ...payload, candidates: undefined }), (e: unknown) => e instanceof StudioJobError && e.code === "invalid_job");
});
test("plain search mode is unchanged: no model is called and every video is unranked", async () => {
  const prompts: string[] = [];
  const result = await run({ enabled: () => true, models: model({}, prompts), browser: browser({ ads: [v(ids.a, "A")] }) }, { query: "ads", limit: 6 });
  assert.equal(prompts.length, 0); assert.equal(result.trace.mode, "search"); assert.deepEqual(result.trace.queries, [{ query: "ads", by: "user", found: 1 }]);
});

test("when no model is usable the log says exactly why", async () => {
  const mk = (usageFn: () => Promise<Record<string, unknown>>, ready: boolean | "throws") => ({ enabled: () => true, browser: browser({ k: [v(ids.a, "A")] }),
    models: { adapter: (provider: LocalProvider): LocalTextAdapter => ({ provider, readiness: async () => { if (ready === "throws") throw new Error("probe"); return { installed: true, authenticated: ready, ready, models: [], loginMethod: provider === "codex" ? "chatgpt" : "claudeai" }; }, generate: async () => { throw new Error("unused"); } }),
      usage: usageFn as never, config: () => ({ ...defaultDeviceConfig, textProvider: "codex" as const }) } });
  const payload = { query: "k", limit: 6, mode: "plan_search_rank", source, context };
  assert.match((await run(mk(async () => ({}), true), payload)).trace.notes!.join(" "), /capacity reading was unavailable/);
  assert.match((await run(mk(async () => ({ codex: reading(1) }), true), payload)).trace.notes!.join(" "), /no fresh subscription capacity/);
  assert.match((await run(mk(usage, false), payload)).trace.notes!.join(" "), /not ready or not signed in/);
  assert.match((await run(mk(usage, "throws"), payload)).trace.notes!.join(" "), /readiness check failed/);
});

test("a realistically large source, context and candidate pool never crashes the run and always fits the Mac's reply limit", async () => {
  const big = { kind: "reference" as const, title: "T".repeat(300), summary: "word ".repeat(400).slice(0, 2000) };
  const bigContext = { approvedTitles: Array.from({ length: 15 }, (_, i) => `Library source title number ${i} `.padEnd(120, "x")), pinnedKnowledge: Array.from({ length: 10 }, (_, i) => `Pinned insight ${i} `.padEnd(200, "y")),
    profile: { summary: "s".repeat(300), tagline: "t".repeat(300), offer: "o".repeat(300), audience: "a".repeat(300) } };
  const mkVideo = (i: number) => ({ id: `v${String(i).padStart(10, "0")}`, title: `Candidate ${i} `.padEnd(300, "z"), channelTitle: "c".repeat(200), publishedText: "2 years ago", viewsText: "1,234,567 views", description: "d".repeat(400) });
  const pool = Array.from({ length: 18 }, (_, i) => mkVideo(i));
  const seen: string[] = []; const byQuery: Record<string, ReturnType<typeof mkVideo>[]> = { "q one": pool.slice(0, 9), "q two": pool.slice(9) };
  const result = await run({ enabled: () => true, browser: browser(byQuery as never, seen), models: model({ plan: { queries: ["q one", "q two"], focus: "f".repeat(300) },
    rank: { rankings: pool.map((p, i) => ({ id: p.id, score: 90 - i, reason: "r".repeat(240) })) } }) }, { query: "k", limit: 12, mode: "plan_search_rank", source: big, context: bigContext });
  assert.equal(result.videos.length, 18); assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 26000, `result is ${Buffer.byteLength(JSON.stringify(result))} bytes`);
  assert.ok(result.trace.planner!.prompt.length <= 9000 && result.trace.ranker!.prompt.length <= 9000); assert.equal(result.videos[0].band, "relevant");
});
test("a long 'no model' reason is shortened to fit the trace instead of crashing", async () => {
  const longReason = { enabled: () => true, browser: browser({ k: [v(ids.a, "A")] }), models: { adapter: () => { throw new Error("x"); }, usage: (async () => ({ codex: reading(1) })) as never, config: () => ({ ...defaultDeviceConfig, textProvider: "codex" as const }) } };
  const result = await run(longReason, { query: "k", limit: 6, mode: "plan_search_rank", source, context });
  assert.ok(result.trace.notes!.every(n => n.length <= 200)); assert.equal(result.videos[0].band, "unranked");
});
test("any unexpected internal error is reported as a plain, non-retried failure with where it happened", async () => {
  const handler = createYoutubeSearchHandler({ enabled: () => true, browser: async () => ({ search: async () => ({ videos: [{ id: "bad", title: "x" } as never] }) }) });
  await assert.rejects(handler(job({ query: "k", limit: 6 }), ctx()), (e: unknown) => e instanceof StudioJobError && e.code === "related_internal_error" && !e.retryable && /internal error \(id: invalid_string/.test(e.message));
});

test("a browser failure names its stage from the error class only, never the message", async () => {
  const e = (name: string, message: string) => Object.assign(new Error(message), { name });
  assert.equal(classifyBrowserError(e("Error", "Failed to launch: ProcessSingleton /Users/someone/Library/profile")), "profile_in_use");
  assert.equal(classifyBrowserError(e("Error", "browserType.launch: Executable doesn't exist at /Applications/Chrome")), "browser_launch");
  assert.equal(classifyBrowserError(e("Error", "page.goto: net::ERR_INTERNET_DISCONNECTED at https://x")), "navigation");
  assert.equal(classifyBrowserError(e("TimeoutError", "page.goto: Timeout 30000ms exceeded.")), "timeout");
  assert.equal(classifyBrowserError(e("TimeoutError", "page.waitForFunction: Timeout 20000ms exceeded.")), "page_data");
  assert.equal(classifyBrowserError(e("Error", "Target page, context or browser has been closed")), "browser_closed");
  const handler = createYoutubeSearchHandler({ enabled: () => true, browser: async () => ({ search: async () => { throw e("TimeoutError", "page.goto: Timeout 30000ms exceeded at /Users/private/path"); } }) });
  await assert.rejects(handler(job({ query: "k", limit: 6 }), ctx()), (err: unknown) => err instanceof StudioJobError && err.code === "youtube_search_failed" && /\(timeout\)/.test(err.message) && !err.message.includes("/Users"));
});


test("a route-aware rank uses the ordered model and only advances on a pre-generation rejection", async () => {
  const payload = { query: "k", limit: 6, mode: "rank", source, context, candidates: [v(ids.a, "A")] };
  const deviceId = "this-mac";
  const route = { candidates: [{ kind: "device_claude", model: "sonnet", deviceId }, { kind: "device_codex", model: "gpt-5.5", deviceId }] };
  const calls: string[] = [];
  const runAttempt = (rejection: Error) => {
    const base = model({ rank: { rankings: [{ id: ids.a, score: 80, reason: "Same subject" }] } });
    return run({ browser: async () => null, enabled: () => true, deviceId,
      models: { ...base, adapter: provider => {
        const adapter = base.adapter(provider);
        const generate: LocalTextAdapter["generate"] = req => {
          calls.push(`${provider}:${req.model}`);
          if (provider === "claude") throw rejection;
          return adapter.generate(req);
        };
        return { ...adapter, generate };
      } },
    }, payload, route);
  };
  const switched = await runAttempt(new StudioProviderRejectedError("rate_limited", "limit", true));
  assert.deepEqual(calls.splice(0), ["claude:sonnet", "codex:gpt-5.5"]);
  assert.equal(switched.trace.ranker?.model, "gpt-5.5");

  const stopped = await runAttempt(new Error("uncertain"));
  assert.deepEqual(calls, ["claude:sonnet"]);
  assert.equal(stopped.videos[0].band, "unranked");
  assert.equal(stopped.trace.ranker, undefined);
});
