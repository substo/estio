import assert from "node:assert/strict";
import test from "node:test";
import { StudioJobError } from "../worker/handlers";
import { isSignedInTopbar, parseYoutubeSearchData, youtubeSearchUrl } from "../youtube-mac-search-policy";
import { createYoutubeSearchHandler, findChrome } from "./youtube-search";

const renderer = (id: string, extra: Record<string, unknown> = {}) => ({ videoRenderer: { videoId: id, title: { runs: [{ text: "Facebook " }, { text: "Ads" }] },
  ownerText: { runs: [{ text: "Think Media", navigationEndpoint: { browseEndpoint: { browseId: "UC" + "a".repeat(22) } } }] }, publishedTimeText: { simpleText: "2 years ago" },
  viewCountText: { simpleText: "1,234 views" }, detailedMetadataSnippets: [{ snippetText: { runs: [{ text: "How to run ads" }] } }], ...extra } });
const page = { contents: { twoColumnSearchResultsRenderer: { primaryContents: { sectionListRenderer: { contents: [{ itemSectionRenderer: { contents: [renderer("aaaaaaaaaaa"), { adSlotRenderer: {} }, renderer("bbbbbbbbbbb"), renderer("aaaaaaaaaaa"), renderer("not-an-id"), renderer("ccccccccccc")] } }] } } } } };
const job = (payload: unknown) => ({ id: "j", location_id: "l", kind: "studio.youtube_search", payload, lease_token: "t", attempts: 1, max_attempts: 1 }) as never;
const ctx = (signal = new AbortController().signal) => ({ signal }) as never;

test("parses public video facts, drops duplicates, invalid ids and ads, honours the limit", () => {
  const videos = parseYoutubeSearchData(page, 2);
  assert.deepEqual(videos.map(v => v.id), ["aaaaaaaaaaa", "bbbbbbbbbbb"]);
  assert.deepEqual(videos[0], { id: "aaaaaaaaaaa", title: "Facebook Ads", channelId: "UC" + "a".repeat(22), channelTitle: "Think Media", publishedText: "2 years ago", viewsText: "1,234 views", description: "How to run ads" });
  assert.deepEqual(parseYoutubeSearchData(null, 5), []);
  assert.deepEqual(parseYoutubeSearchData({ videoRenderer: { videoId: "ddddddddddd" } }, 5), []);
});
test("builds the video-filtered results URL and detects a signed-in top bar", () => {
  assert.equal(youtubeSearchUrl("ads & more"), "https://www.youtube.com/results?search_query=ads+%26+more&sp=EgIQAQ%3D%3D");
  assert.equal(isSignedInTopbar({ topbar: { desktopTopbarRenderer: { topbarButtons: [{ topbarMenuButtonRenderer: { avatar: { thumbnails: [] } } }] } } }), true);
  // A signed-out page still has a topbarMenuButtonRenderer (settings menu) but offers sign-in and no avatar.
  assert.equal(isSignedInTopbar({ topbar: { desktopTopbarRenderer: { topbarButtons: [{ buttonRenderer: { navigationEndpoint: { signInEndpoint: {} } } }, { topbarMenuButtonRenderer: {} }] } } }), false);
  assert.equal(isSignedInTopbar(null), false);
});
test("finds Chrome only at fixed locations", async () => {
  assert.equal(await findChrome({} as NodeJS.ProcessEnv, async () => false), null);
  assert.equal(await findChrome({ STUDIO_YOUTUBE_CHROME: "/x/chrome" } as NodeJS.ProcessEnv, async p => p === "/x/chrome"), "/x/chrome");
});
test("handler validates the payload and returns only the bounded result", async () => {
  const handler = createYoutubeSearchHandler({ enabled: () => true, browser: async () => ({ search: async () => ({ videos: parseYoutubeSearchData(page, 3), signedIn: true }) }) });
  const result = await handler(job({ query: "ads", limit: 3 }), ctx()) as { videos: unknown[]; signedIn: boolean };
  assert.equal(result.videos.length, 3); assert.equal(result.signedIn, true);
  await assert.rejects(handler(job({ query: "", limit: 3 }), ctx()));
  await assert.rejects(handler(job({ query: "ads", limit: 3, extra: 1 }), ctx()));
});
test("handler waits when disabled, fails plainly without a browser, and never retries browser errors into a paid path", async () => {
  await assert.rejects(createYoutubeSearchHandler({ enabled: () => false, browser: async () => null })(job({ query: "a", limit: 5 }), ctx()), (e: unknown) => e instanceof StudioJobError && e.code === "local_policy" && e.retryable);
  await assert.rejects(createYoutubeSearchHandler({ enabled: () => true, browser: async () => null })(job({ query: "a", limit: 5 }), ctx()), (e: unknown) => e instanceof StudioJobError && e.code === "youtube_browser_missing");
  await assert.rejects(createYoutubeSearchHandler({ enabled: () => true, browser: async () => ({ search: async () => { throw new Error("boom secret"); } }) })(job({ query: "a", limit: 5 }), ctx()),
    (e: unknown) => e instanceof StudioJobError && e.code === "youtube_search_failed" && !e.message.includes("secret"));
});
