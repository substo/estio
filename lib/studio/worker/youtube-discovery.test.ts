import { test } from "node:test";
import assert from "node:assert/strict";
import { createYoutubeDiscoveryHandler, discoverScheduledYoutube, type YoutubeDiscoveryContext, type YoutubeDiscoveryDeps } from "./youtube-discovery";
import { YoutubeError } from "../../google/youtube-api";
import { StudioRestError } from "../rest-client";
import { StudioJobError } from "./handlers";
import { encryptStudioSecret } from "../secrets";
import { youtubeProfileContext } from "../../google/youtube-policy";
import { readYoutubeScheduleCommand } from "../youtube-schedule-policy";
import { readScheduleCommand } from "../schedule-execution-policy";
const runId = "c2400000-0000-4000-8000-000000000001";
const channel = "UC" + "a".repeat(22);
const input: YoutubeDiscoveryContext = { outcome: "ready", brand: "substo", userId: "profile-owner", connectionVersion: "grant-version", source: "subscription", channelId: channel, query: "Saved query" };
const job = { id: "j", location_id: "w", kind: "studio.youtube_discovery", payload: { discoveryRunId: runId }, lease_token: "lease", attempts: 1, max_attempts: 3 };
function fixture(options: { lostFinish?: boolean; blockedFinish?: boolean; providerError?: Error; abort?: boolean; denied?: boolean; outage?: boolean; quota?: boolean } = {}) {
 const calls: Array<{ path: string; body: any }> = []; let saved = false; let reads = 0;
 const controller = new AbortController();
 const deps: YoutubeDiscoveryDeps = {
  async rest<T>(path: string, init?: RequestInit) {
   if (!init) return [{ result: saved ? { links: [] } : null, actor_app: options.denied || options.outage ? "estio" : "substo", created_by_clerk_user_id: "profile-owner" }] as T;
   const body = JSON.parse(String(init.body)); calls.push({ path, body });
   if (path.endsWith("studio_begin_youtube_discovery")) return (options.quota ? { outcome: "quota" } : input) as T;
   if (path.endsWith("studio_finish_youtube_discovery")) {
    if (options.blockedFinish) throw new StudioRestError(403, "42501");
    saved = true; if (options.lostFinish) throw Error("Lost committed response");
   }
   return {} as T;
  },
  authorize: async (locationId, userId) => { assert.equal(locationId, "w"); assert.equal(userId, "profile-owner"); if (options.outage) throw Error("Authority unavailable"); return !options.denied; },
  discover: async context => { assert.equal(context.userId, "profile-owner"); reads++; if (options.abort) controller.abort(); if (options.providerError) throw options.providerError; return ["aaaaaaaaaaa"]; },
 };
 return { deps, calls, controller, count: () => reads };
}
test("manual and recurring discovery require explicit sharing, bounded sources and current versions", () => {
 const command = { action: "enable_youtube", scheduleId: runId, version: 1, stateVersion: 0, requestId: runId, connectionVersion: runId, source: "subscription", channelId: channel, titlePrefix: "My label", confirmShare: true };
 assert.equal(readYoutubeScheduleCommand(command).source, "subscription");
 assert.equal(readYoutubeScheduleCommand({ ...command, source: "search", channelId: "ignored" }).channelId, "");
 assert.equal(readYoutubeScheduleCommand({ ...command, action: "run_youtube_now" }).action, "run_youtube_now");
 assert.equal(readScheduleCommand({ ...command, action: "run_youtube_now" }).action, "run_youtube_now");
 assert.throws(() => readYoutubeScheduleCommand({ ...command, action: "run_now" }));
 for (const action of ["enable_youtube", "run_youtube_now"]) for (const patch of [{ connectionVersion: undefined }, { connectionVersion: "invalid" }, { confirmShare: false }, { source: "all_subscriptions" }, { source: "home_feed" }, { channelId: "bad" }, { titlePrefix: "" }, { titlePrefix: "x".repeat(101) }, { stateVersion: -1 }, { version: 0 }]) assert.throws(() => readYoutubeScheduleCommand({ ...command, action, ...patch }));
});
test("saved discovery survives lost commit response without more Google reads", async () => {
 const f = fixture({ lostFinish: true }); const handle = createYoutubeDiscoveryHandler(f.deps);
 await assert.rejects(handle(job, { signal: f.controller.signal, workerId: "worker" }));
 await handle(job, { signal: f.controller.signal, workerId: "worker" }); assert.equal(f.count(), 1);
 assert.deepEqual(f.calls.at(-1)?.body.p_videos, ["aaaaaaaaaaa"]);
 assert.ok(f.calls.every(call => call.body.p_lease === "lease" && call.body.p_location === "w"));
 assert.equal(f.calls.some(call => /ai_|text_run/.test(call.path)), false);
});
test("authority denial/outage, exhausted quota and lease loss prevent ingestion", async () => {
 for (const options of [{ denied: true }, { outage: true }, { quota: true }, { abort: true }]) {
  const f = fixture(options); await assert.rejects(createYoutubeDiscoveryHandler(f.deps)(job, { signal: f.controller.signal, workerId: "worker" }));
  assert.equal(f.count(), options.abort ? 1 : 0);
  assert.equal(f.calls.some(call => call.path.endsWith("studio_finish_youtube_discovery")), false);
  if (options.outage) assert.equal(f.calls.length, 0);
 }
});
test("changed grants after reading are fenced; confirmed reconnect/unsubscribe failures request a pause", async () => {
 const blocked = fixture({ blockedFinish: true });
 await assert.rejects(createYoutubeDiscoveryHandler(blocked.deps)(job, { signal: blocked.controller.signal, workerId: "worker" }), (error: StudioJobError) => error.code === "discovery_authorization_changed");
 for (const code of ["google_reconnect", "not_subscribed"]) {
  const f = fixture({ providerError: new YoutubeError(code, "Safe provider error") });
  await assert.rejects(createYoutubeDiscoveryHandler(f.deps)(job, { signal: f.controller.signal, workerId: "worker" }), (error: StudioJobError) => !error.retryable);
  assert.equal(f.calls.at(-1)?.path, "rpc/studio_stop_youtube_discovery");
  assert.equal(f.calls.some(call => call.path.endsWith("studio_finish_youtube_discovery")), false);
 }
});
test("profile tokens are selected by realm/user/version; one subscribed source, public-only bounded IDs, no API metadata persistence", async () => {
 const names = ["STUDIO_SECRETS_KEY", "STUDIO_SECRETS_KEY_ID", "PLATFORM_GOOGLE_CLIENT_ID", "PLATFORM_GOOGLE_CLIENT_SECRET"] as const;
 const before = Object.fromEntries(names.map(name => [name, process.env[name]]));
 try {
  process.env.STUDIO_SECRETS_KEY = Buffer.alloc(32, 7).toString("base64"); process.env.STUDIO_SECRETS_KEY_ID = "v1";
  process.env.PLATFORM_GOOGLE_CLIENT_ID = "fixture-client"; process.env.PLATFORM_GOOGLE_CLIENT_SECRET = "fixture-secret";
  const cipher = encryptStudioSecret("private-refresh", youtubeProfileContext("substo", "profile-owner", "refresh"));
  const rest = async <T>(path: string) => {
   const q = new URLSearchParams(path.split("?")[1]); assert.equal(q.get("brand"), "eq.substo"); assert.equal(q.get("clerk_user_id"), "eq.profile-owner");
   return [{ version: "grant-version", client_id: "fixture-client", refresh_cipher: cipher }] as T;
  };
  const ids = Array.from({ length: 12 }, (_, i) => String(i).padStart(11, "a")); let calls = 0; let allowSubscription = true;
  const fetcher: typeof fetch = async (url, init) => {
   calls++;
   if (String(url) === "https://oauth2.googleapis.com/token") {
    assert.equal((init!.body as URLSearchParams).get("refresh_token"), "private-refresh"); return Response.json({ access_token: "private-access" });
   }
   assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer private-access");
   const u = new URL(String(url));
   if (u.pathname.endsWith("/subscriptions")) { assert.equal(u.searchParams.get("mine"), "true"); assert.equal(u.searchParams.get("forChannelId"), channel); return Response.json({ items: allowSubscription ? [{ snippet: { title: "Private subscription title", resourceId: { channelId: channel } } }] : [] }); }
   if (u.pathname.endsWith("/channels")) return Response.json({ items: [{ contentDetails: { relatedPlaylists: { uploads: "playlist" } } }] });
   if (u.pathname.endsWith("/playlistItems")) return Response.json({ items: ids.map(id => ({ contentDetails: { videoId: id } })) });
   if (u.pathname.endsWith("/videos")) return Response.json({ items: ids.map((id, index) => ({ id, status: { privacyStatus: index === 0 ? "unlisted" : "public" }, snippet: { title: "Provider title not persisted", channelId: channel } })) });
   throw Error("Unexpected API endpoint");
  };
  const found = await discoverScheduledYoutube(input, rest, fetcher); assert.equal(found.length, 10); assert.equal(found.includes(ids[0]), false);
  assert.equal(found.every(id => typeof id === "string" && id.length === 11), true);
  const count = calls; await assert.rejects(discoverScheduledYoutube({ ...input, connectionVersion: "other-version" }, rest, fetcher)); assert.equal(calls, count);
  allowSubscription = false; await assert.rejects(discoverScheduledYoutube(input, rest, fetcher), (error: YoutubeError) => error.code === "not_subscribed");
 } finally { for (const name of names) { if (before[name] === undefined) delete process.env[name]; else process.env[name] = before[name]; } }
});
