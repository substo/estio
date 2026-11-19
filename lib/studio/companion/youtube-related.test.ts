import assert from "node:assert/strict";
import test from "node:test";
import { defaultDeviceConfig } from "../devices-policy";
import { StudioJobError } from "../worker/handlers";
import type { LocalProvider, LocalTextAdapter } from "./providers";
import { createYoutubeSearchHandler, type YoutubeBrowser } from "./youtube-search";

const reading = (remaining: number) => ({ remaining, windows: [], at: new Date().toISOString() });
const usage = async () => ({ codex: reading(90), claudeAgent: reading(90) });
const source = { kind: "reference" as const, title: "New Generation YouTube Influencers", summary: "Doctors and lawyers turning into creators." };
const context = { approvedTitles: ["Think Media"], pinnedKnowledge: ["Studio helps creators"], profile: { offer: "Studio" } };
const v = (id: string, title: string) => ({ id, title, channelTitle: "Ch", publishedText: "1 yr ago", viewsText: "10 views" });
const ids = { a: "aaaaaaaaaaa", b: "bbbbbbbbbbb", c: "ccccccccccc", d: "ddddddddddd" };
const job = (payload: unknown) => ({ id: "j", location_id: "loc", kind: "studio.youtube_search", payload, lease_token: "t", attempts: 1, max_attempts: 1 }) as never;
const ctx = () => ({ signal: new AbortController().signal, workerId: "w" }) as never;

function model(script: { plan?: unknown; rank?: unknown; failPlan?: boolean; failRank?: boolean }, prompts: string[] = []) {
  return { adapter: (provider: LocalProvider): LocalTextAdapter => ({ provider, readiness: async () => ({ installed: true, authenticated: true, ready: true, models: [], loginMethod: provider === "codex" ? "chatgpt" : "claudeai" }),
    generate: async req => { prompts.push(req.prompt); assert.equal(req.workflowContext, "related_video_search");
      const isPlan = /search queries/.test(req.prompt); if (isPlan ? script.failPlan : script.failRank) throw new Error("model down");
      return req.validate(isPlan ? script.plan : script.rank); } }), usage, config: () => ({ ...defaultDeviceConfig, textProvider: "codex" as const }) };
}
const browser = (byQuery: Record<string, ReturnType<typeof v>[]>, seen: string[] = []): (() => Promise<YoutubeBrowser>) => async () => ({ search: async q => { seen.push(q); if (!byQuery[q]) throw new Error("none"); return { videos: byQuery[q], signedIn: false }; } });
const run = (deps: Parameters<typeof createYoutubeSearchHandler>[0], payload: unknown) => createYoutubeSearchHandler(deps)(job(payload), ctx()) as Promise<{ videos: Array<{ id: string; score?: number | null; band?: string }>; trace: { mode: string; route: string; focus?: string; queries: Array<{ query: string; by: string; found: number }>; planner?: { prompt: string; provider: string }; ranker?: { prompt: string }; notes?: string[]; candidates: Array<{ id: string; band: string }> } }>;

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
