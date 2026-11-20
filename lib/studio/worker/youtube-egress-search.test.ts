import assert from "node:assert/strict";
import test from "node:test";
import { StudioJobError } from "./handlers";
import { createGatewayClient, createYoutubeEgressSearchHandler, type EgressBrowser, type EgressGateway } from "./youtube-egress-search";

const job = (payload: unknown) => ({ id: "j", location_id: "loc-1", kind: "studio.youtube_search_egress", payload, lease_token: "t", attempts: 1, max_attempts: 1 }) as never;
const ctx = () => ({ signal: new AbortController().signal, workerId: "w" });
const video = { id: "aaaaaaaaaaa", title: "Facebook ads" };

test("searches through the leased device proxy and marks the result as device-network", async () => {
  let seen: unknown;
  const gateway: EgressGateway = { lease: async location => { seen = location; return { host: "127.0.0.1", port: 4555 }; } };
  const browser: EgressBrowser = { search: async (query, limit, proxy) => { assert.deepEqual(proxy, { host: "127.0.0.1", port: 4555 }); assert.equal(limit, 6); return { videos: [video], signedIn: false }; } };
  const result = await createYoutubeEgressSearchHandler({ gateway, browser })(job({ query: "ads", limit: 6, macReason: "YS001" }), ctx());
  assert.equal(seen, "loc-1"); assert.deepEqual(result, { videos: [video], signedIn: false, via: "device_network" });
});
test("fails plainly, never retrying or searching from the server's own IP, when no device is online or configured", async () => {
  let searched = false;
  const browser: EgressBrowser = { search: async () => { searched = true; return { videos: [] }; } };
  await assert.rejects(createYoutubeEgressSearchHandler({ gateway: { lease: async () => null }, browser })(job({ query: "a", limit: 5 }), ctx()), (e: unknown) => e instanceof StudioJobError && e.code === "youtube_no_device" && !e.retryable);
  await assert.rejects(createYoutubeEgressSearchHandler({ gateway: null, browser })(job({ query: "a", limit: 5 }), ctx()), (e: unknown) => e instanceof StudioJobError && e.code === "youtube_egress_unavailable");
  await assert.rejects(createYoutubeEgressSearchHandler({ gateway: { lease: async () => { throw new Error("secret detail"); } }, browser })(job({ query: "a", limit: 5 }), ctx()), (e: unknown) => e instanceof StudioJobError && e.code === "youtube_egress_unavailable" && !e.message.includes("secret"));
  assert.equal(searched, false);
});
test("browser errors are reported without their text, and bad payloads are rejected", async () => {
  const gateway: EgressGateway = { lease: async () => ({ host: "127.0.0.1", port: 1 }) };
  await assert.rejects(createYoutubeEgressSearchHandler({ gateway, browser: { search: async () => { throw new Error("net::ERR secret"); } } })(job({ query: "a", limit: 5 }), ctx()), (e: unknown) => e instanceof StudioJobError && e.code === "youtube_search_failed" && !e.message.includes("secret"));
  await assert.rejects(createYoutubeEgressSearchHandler({ gateway, browser: { search: async () => ({ videos: [] }) } })(job({ query: "", limit: 5 }), ctx()));
  await assert.rejects(createYoutubeEgressSearchHandler({ gateway, browser: { search: async () => ({ videos: [] }) } })(job({ query: "a", limit: 5, extra: true }), ctx()));
});
test("gateway client needs the internal secret and only accepts a loopback proxy", async () => {
  assert.equal(createGatewayClient({} as NodeJS.ProcessEnv), null);
  const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
  const reply = (status: number, body: unknown) => (async (url: string, init: { headers: Record<string, string>; body: string }) => { calls.push({ url, headers: init.headers, body: init.body }); return new Response(JSON.stringify(body), { status }); }) as unknown as typeof fetch;
  const env = { DEVICE_TUNNEL_INTERNAL_SECRET: "s".repeat(40), DEVICE_TUNNEL_GATEWAY_URL: "http://127.0.0.1:3220/" } as unknown as NodeJS.ProcessEnv;
  const signal = new AbortController().signal;
  assert.deepEqual(await createGatewayClient(env, reply(200, { available: true, proxyHost: "127.0.0.1", proxyPort: 41000 }))!.lease("loc-1", signal), { host: "127.0.0.1", port: 41000 });
  assert.equal(calls[0].url, "http://127.0.0.1:3220/studio/egress"); assert.equal(calls[0].headers["x-device-tunnel-secret"], "s".repeat(40)); assert.deepEqual(JSON.parse(calls[0].body), { locationId: "loc-1" });
  assert.equal(await createGatewayClient(env, reply(503, { available: false }))!.lease("loc-1", signal), null);
  assert.equal(await createGatewayClient(env, reply(200, { available: true, proxyHost: "10.0.0.5", proxyPort: 41000 }))!.lease("loc-1", signal), null);
  assert.equal(await createGatewayClient(env, reply(200, { available: true, proxyHost: "127.0.0.1", proxyPort: 99999 }))!.lease("loc-1", signal), null);
  await assert.rejects(createGatewayClient(env, reply(500, {}))!.lease("loc-1", signal));
});
