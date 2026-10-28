import { readYoutubeRequestText } from "./youtube-request";
import { sameYoutubePrincipal } from "../studio/youtube-consumer-policy";
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { createYoutubeApi, exchangeYoutubeCode, newYoutubeOAuth, refreshYoutubeAccess } from "./youtube-api";
import { channelIdPattern, readDiscoveryRequest, youtubeClientConfig, youtubeProfileContext, youtubeVideoId, youtubeChannelTarget, YOUTUBE_SCOPE } from "./youtube-policy";
import { readProfileYoutubeState } from "./profile-youtube-state";
import { encryptStudioSecret } from "../studio/secrets";
import { openYoutubeSelection, sealYoutubeSelection } from "../studio/youtube-selection";
const channel = `UC${"a".repeat(22)}`; const video = "aB_cD-eF123";
const client = { clientId: "fixture-client", clientSecret: "fixture-secret" };
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

test("video URLs and discovery inputs reject non-YouTube targets, ambiguous IDs, and unsafe pagination", () => {
  for (const url of [`https://youtu.be/${video}`, `https://www.youtube.com/watch?v=${video}`, `https://youtube.com/shorts/${video}`]) assert.equal(youtubeVideoId(url), video);
  for (const url of [`https://evil.test/watch?v=${video}`, `https://youtube.com.evil.test/watch?v=${video}`, `https://u:p@youtube.com/watch?v=${video}`, `http://youtu.be/${video}`, `https://youtube.com/watch?v=${video}&v=${video}`, `https://youtu.be/${video}/extra`]) assert.throws(() => youtubeVideoId(url));
  assert.equal(readDiscoveryRequest({ mode: "subscription", channelId: channel }).channelId, channel);
  assert.equal(channelIdPattern.test(channel), true);
  for (const value of [{ mode: "recommendations" }, { mode: "search", query: "" }, { mode: "channel", channelId: "x" }, { mode: "subscriptions", pageToken: "token&mine=false" }]) assert.throws(() => readDiscoveryRequest(value));
  assert.equal(youtubeClientConfig({ PLATFORM_GOOGLE_CLIENT_ID: "custom", GOOGLE_CLIENT_ID: "old", GOOGLE_CLIENT_SECRET: "secret" }), null, "never mix credential pairs");
});
test("OAuth requests only read scope with offline consent and PKCE", () => {
  const value = newYoutubeOAuth(client, "https://substo.test/account/connections/google-youtube/callback"); const url = new URL(value.url);
  assert.equal(url.origin, "https://accounts.google.com"); assert.equal(url.searchParams.get("scope"), YOUTUBE_SCOPE);
  assert.equal(url.searchParams.get("access_type"), "offline"); assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("code_challenge"), createHash("sha256").update(value.verifier).digest("base64url"));
  assert.equal(value.state.length, 43);
});
test("token exchange requires offline read consent, refresh uses only fixed Google endpoint", async () => {
  const fetcher = (async (input, init) => {
    assert.equal(String(input), "https://oauth2.googleapis.com/token"); assert.equal(init?.redirect, "error");
    const form = init!.body as URLSearchParams; assert.equal(form.get("client_secret"), "fixture-secret"); assert.equal(form.get("code_verifier"), "verifier");
    return reply({ access_token: "access", refresh_token: "refresh", scope: YOUTUBE_SCOPE });
  }) as typeof fetch;
  assert.deepEqual(await exchangeYoutubeCode(client, "code", "verifier", "https://substo.test/callback", fetcher), { refreshToken: "refresh", scopes: [YOUTUBE_SCOPE] });
  await assert.rejects(exchangeYoutubeCode(client, "c", "v", "https://substo.test/callback", (async () => reply({ access_token: "access", scope: YOUTUBE_SCOPE })) as typeof fetch), /offline consent/);
  await assert.rejects(exchangeYoutubeCode(client, "c", "v", "https://substo.test/callback", (async () => reply({ access_token: "access", refresh_token: "refresh", scope: "gmail" })) as typeof fetch), /offline consent/);
  assert.equal(await refreshYoutubeAccess(client, "profile-refresh", (async (_url, init) => { assert.equal((init!.body as URLSearchParams).get("refresh_token"), "profile-refresh"); return reply({ access_token: "fresh" }); }) as typeof fetch), "fresh");
});
test("subscription requests use the personal token and private/public video filtering is enforced", async () => {
  const calls: URL[] = [];
  const api = createYoutubeApi({ accessToken: "personal-secret" }, (async (input, init) => {
    const url = new URL(String(input)); calls.push(url); assert.equal((init!.headers as Record<string, string>).Authorization, "Bearer personal-secret"); assert.equal(url.searchParams.has("key"), false);
    if (url.pathname.endsWith("subscriptions")) return reply({ items: [{ snippet: { title: "Personal subscription", resourceId: { channelId: channel } } }], nextPageToken: "next" });
    return reply({ items: [
      { id: video, status: { privacyStatus: "public" }, snippet: { title: "Public title", channelId: channel } },
      { id: "private1234", status: { privacyStatus: "private" }, snippet: { title: "Never share", channelId: channel } },
      { id: "wrongABC123", status: { privacyStatus: "public" }, snippet: { title: "Not requested", channelId: channel } },
    ] });
  }) as typeof fetch);
  assert.equal((await api.subscriptions("next", channel)).channels[0].id, channel);
  assert.equal(calls[0].searchParams.get("mine"), "true"); assert.equal(calls[0].searchParams.get("forChannelId"), channel);
  assert.deepEqual((await api.videos([video, "private1234"])).map(v => v.id), [video]);
  await assert.rejects(createYoutubeApi({ apiKey: "public" }).subscriptions(), /Connect YouTube/);
});
test("channel discovery uses uploads playlist and does not invent a personalized feed", async () => {
  const calls: URL[] = [];
  const api = createYoutubeApi({ apiKey: "public-key" }, (async input => {
    const url = new URL(String(input)); calls.push(url);
    if (url.pathname.endsWith("channels")) return reply({ items: [{ contentDetails: { relatedPlaylists: { uploads: "UUfixture" } } }] });
    if (url.pathname.endsWith("playlistItems")) return reply({ items: [{ contentDetails: { videoId: video } }], nextPageToken: "next" });
    return reply({ items: [{ id: video, status: { privacyStatus: "public" }, snippet: { title: "Public", channelId: channel } }] });
  }) as typeof fetch);
  const result = await api.channelVideos(channel); assert.equal(result.videos[0].id, video); assert.equal(result.nextPageToken, "next");
  assert.equal(calls[0].searchParams.get("id"), channel); assert.equal(calls[1].searchParams.get("playlistId"), "UUfixture");
  assert.ok(calls.every(url => !url.pathname.includes("activities") && url.searchParams.get("key") === "public-key"));
});
test("Google failures surface safe errors without tokens/provider bodies", async () => {
  const api = createYoutubeApi({ accessToken: "secret" }, (async () => reply({ error: "PRIVATE_TOKEN secret" }, 403)) as typeof fetch);
  await assert.rejects(api.search("query"), error => error instanceof Error && !error.message.includes("secret") && error.message.includes("quota"));
});
test("profile OAuth state binds realm, user, session, origin and expiry; selections bind explicit workspace sharing", () => {
  const previousKey = process.env.STUDIO_SECRETS_KEY; process.env.STUDIO_SECRETS_KEY = Buffer.alloc(32, 7).toString("base64");
  try {
    const profile = { brand: "substo" as const, userId: "user_same", sessionId: "session_fixture", origin: "https://substo.test" }; const now = Date.now();
    const oauth = newYoutubeOAuth(client, `${profile.origin}/callback`);
    const sealed = encryptStudioSecret(JSON.stringify({ ...profile, state: oauth.state, verifier: oauth.verifier, expires: now + 600_000 }), youtubeProfileContext(profile.brand, profile.userId, "oauth"));
    const raw = Buffer.from(JSON.stringify(sealed)).toString("base64url"); const params = new URLSearchParams({ state: oauth.state });
    assert.ok(readProfileYoutubeState(raw, profile, params, now));
    assert.equal(readProfileYoutubeState(raw, { ...profile, brand: "estio" }, params, now), null);
    assert.equal(readProfileYoutubeState(raw, { ...profile, userId: "other" }, params, now), null);
    assert.equal(readProfileYoutubeState(raw, { ...profile, sessionId: "other" }, params, now), null);
    assert.equal(readProfileYoutubeState(raw, { ...profile, origin: "https://evil.test" }, params, now), null);
    assert.equal(readProfileYoutubeState(raw, profile, params, now + 600_001), null);
    params.append("state", oauth.state); assert.equal(readProfileYoutubeState(raw, profile, params, now), null);
    const principal = { locationId: "workspace_fixture", brand: profile.brand, userId: profile.userId };
    const ticket = sealYoutubeSelection(principal, video, { kind: "subscription", observedAt: new Date(now).toISOString(), provider: "youtube_data_api", rights: "research_link_only", channelId: channel }, now);
    const opened = openYoutubeSelection(ticket, principal, now)!; assert.equal(opened.videoId, video); assert.equal("title" in opened, false);
    assert.equal(openYoutubeSelection(ticket, { ...principal, locationId: "other" }, now), null);
    assert.equal(openYoutubeSelection(ticket, { ...principal, userId: "other" }, now), null);
    assert.equal(openYoutubeSelection(ticket, { ...principal, brand: "estio" }, now), null);
    assert.equal(openYoutubeSelection(ticket, principal, now + 1_200_001), null);
    assert.equal(openYoutubeSelection("tampered" + ticket.slice(8), principal, now), null);
  } finally { if (previousKey === undefined) delete process.env.STUDIO_SECRETS_KEY; else process.env.STUDIO_SECRETS_KEY = previousKey; }
});

test("public channel targets resolve through fixed API parameters, not arbitrary URL fetching", async () => {
  assert.deepEqual(youtubeChannelTarget("https://www.youtube.com/@example"), { forHandle: "@example" });
  assert.deepEqual(youtubeChannelTarget(`https://youtube.com/channel/${channel}`), { id: channel });
  assert.throws(() => youtubeChannelTarget("https://youtube.com.evil.test/@example"));
  const api = createYoutubeApi({ apiKey: "fixture" }, (async input => {
    const url = new URL(String(input)); assert.equal(url.origin, "https://www.googleapis.com"); assert.equal(url.searchParams.get("forHandle"), "@example");
    return reply({ items: [{ id: channel }] });
  }) as typeof fetch);
  assert.equal(await api.resolveChannel("@example"), channel);
});
test("profile and workspace identities must independently match the app realm and user", () => {
  const profile = { brand: "substo", userId: "user_same" };
  assert.equal(sameYoutubePrincipal(profile, profile), true);
  assert.equal(sameYoutubePrincipal(profile, { brand: "estio", userId: "user_same" }), false);
  assert.equal(sameYoutubePrincipal(profile, { brand: "substo", userId: "other" }), false);
  assert.equal(sameYoutubePrincipal(null, profile), false);
  assert.equal(sameYoutubePrincipal(profile, null), false);
});

test("JSON/form request reads are bounded before parsing and do not echo private bodies", async () => {
  assert.equal(await readYoutubeRequestText(new Request("https://fixture.test", { method: "POST", body: "consent=yes" })), "consent=yes");
  await assert.rejects(readYoutubeRequestText(new Request("https://fixture.test", { method: "POST", body: "PRIVATE".repeat(3000) })), e => e instanceof Error && e.message === "Request too large.");
});
