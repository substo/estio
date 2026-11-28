import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import type { SourceDetailsBatch, SourceDetailsRow } from "../source-details-policy";
import { readDeviceCommand } from "../devices-policy";
import type { StudioJob } from "../worker/queue";
import { createSourceDetailsHandler } from "./source-details";
import { createYoutubePacing } from "./video-transcribe";
import type { VideoTools } from "./video-tools";
import { collectYoutubeComments } from "./youtube-comments";
import { findChrome } from "./youtube-search";

const job: StudioJob = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  lease_token: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  location_id: "fixture", kind: "studio.source_details", attempts: 1, max_attempts: 1,
  payload: { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
};
const context = () => ({ workerId: "mac", signal: new AbortController().signal });
const tools = async () => ({ paths: { ytDlp: "/usr/bin/yt-dlp" } } as VideoTools);
const row = { id: "parent", parentId: null, text: "A visible comment", author: "Reader", likes: 3,
  replies: 1, at: null, published: "2 months ago", pinned: false, byUploader: false };

test("fetches metadata without downloading or asking yt-dlp for comments, then saves browser batches before completion", async () => {
  const batches: SourceDetailsBatch[] = [];
  const handler = createSourceDetailsHandler({
    tools, chrome: async () => "/chrome", enabled: () => true, pacing: createYoutubePacing({ jitterMs: () => 0 }),
    run: async request => {
      assert.ok(request.args.includes("--skip-download"));
      assert.ok(!request.args.includes("--write-comments"));
      assert.ok(request.args.includes("--print") && !request.args.includes("--dump-single-json"));
      return { stdout: JSON.stringify({ title: "Test", description: "Description", comment_count: 2, upload_date: "20261127" }), stderr: "" };
    },
    save: async (_lease, batch) => { batches.push(batch); return true; },
    collect: async (_chrome, _video, _signal, publish) => {
      assert.equal(batches[0].meta?.description, "Description");
      await publish([row]);
      await publish([{ ...row, id: "reply", parentId: "parent" }]);
      return { status: "interrupted", reason: "Some replies could not be loaded.", unresolved_reply_threads: 1 };
    },
  });
  assert.deepEqual(await handler(job, context()), { sourceDetailsDone: true });
  assert.equal(batches[0].meta?.uploadDate, "2026-11-27");
  assert.equal(batches[1].rows?.[0].id, "parent");
  assert.equal(batches[2].rows?.[0].parentId, "parent");
  assert.deepEqual(batches[3], { outcome: "interrupted", reason: "Some replies could not be loaded.", unresolved: 1 });
});

test("a 429 warning saves available metadata and blocks another fetch before it touches YouTube", async () => {
  const batches: SourceDetailsBatch[] = [];
  const pacing = createYoutubePacing({ jitterMs: () => 0 });
  let requests = 0;
  const handler = createSourceDetailsHandler({
    tools, chrome: async () => "/chrome", enabled: () => true, pacing,
    run: async () => { requests++; return { stdout: '{"title":"Test"}', stderr: "WARNING: HTTP Error 429" }; },
    save: async (_lease, batch) => { batches.push(batch); return true; },
    collect: async () => assert.fail("Chrome must stay closed during a cooldown"),
  });
  await assert.rejects(handler(job, context()), /30 minutes/);
  assert.equal(batches[0].meta?.title, "Test");
  assert.ok(pacing.coolingDown() > 1700);
  await assert.rejects(handler(job, context()), /cooldown/);
  assert.equal(requests, 1);
});

test("rejects oversized batches and malformed reply references", () => {
  const lease = { workerId: "mac", jobId: job.id, leaseToken: job.lease_token };
  assert.deepEqual(readDeviceCommand("source_details_batch", { ...lease, rows: [row] }).rows, [row]);
  assert.throws(() => readDeviceCommand("source_details_batch", { ...lease, rows: Array(9).fill(row) }));
  assert.throws(() => readDeviceCommand("source_details_batch", { ...lease, rows: [{ ...row, parentId: "parent" }] }));
  assert.throws(() => readDeviceCommand("source_details_batch", { ...lease, outcome: "unexpected", unresolved: 0 }));
});

test("publishes a visible thread before opening replies and publishes the reply before loading the next page", async t => {
  const executablePath = await findChrome();
  if (!executablePath) return t.skip("Chrome is not installed");
  const browser = await chromium.launch({ executablePath });
  try {
    const page = await browser.newPage();
    const comment = (id: string, text: string) => `<ytd-comment-view-model style="display:block">
      <div id="author-text">Reader</div><div id="content-text">${text}</div><div id="vote-count-middle">12</div>
      <a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ&amp;lc=${id}">Comment link</a></ytd-comment-view-model>`;
    await page.setContent(`<ytd-comments><div id="sections"><div id="contents">
      <ytd-comment-thread-renderer>${comment("parent111", "First comment")}
        <ytd-comment-replies-renderer><div id="more-replies"><button id="open">1 reply</button></div></ytd-comment-replies-renderer>
      </ytd-comment-thread-renderer>
      <ytd-continuation-item-renderer><button id="next">More comments</button></ytd-continuation-item-renderer>
      </div></div></ytd-comments>`);
    await page.evaluate(({ reply, next }) => {
      document.getElementById("open")!.onclick = () => {
        document.body.dataset.opened = "true";
        document.querySelector("ytd-comment-replies-renderer")!.insertAdjacentHTML("beforeend", reply);
      };
      document.getElementById("next")!.onclick = event => {
        document.body.dataset.next = "true";
        (event.target as HTMLElement).parentElement!.outerHTML = `<ytd-comment-thread-renderer>${next}</ytd-comment-thread-renderer>`;
      };
    }, { reply: comment("reply1111", "A reply"), next: comment("parent222", "Second comment") });
    const batches: Array<{ rows: SourceDetailsRow[]; opened?: string; next?: string }> = [];
    const result = await collectYoutubeComments(page, "dQw4w9WgXcQ", 250, undefined, false, {
      signal: new AbortController().signal,
      rows: async rows => { batches.push({ rows, ...await page.evaluate(() => ({ ...document.body.dataset })) }); },
    });
    assert.equal(result.status, "reached_end");
    assert.equal(batches.length, 3);
    assert.equal(batches[0].opened, undefined);
    assert.equal(batches[0].rows[0].author, "Reader");
    assert.equal(batches[0].rows[0].likes, 12);
    assert.equal(batches[0].rows[0].replies, 1);
    assert.equal(batches[1].next, undefined);
    assert.equal(batches[1].rows[0].parentId, "parent111");
    assert.equal(batches[2].rows[0].id, "parent222");
  } finally { await browser.close(); }
});
