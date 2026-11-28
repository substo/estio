import test from "node:test";
import assert from "node:assert/strict";
import { commentExtractorArgs, commentsFailureReason, parseYoutubeSourceMeta, readSourceMeta, SOURCE_COMMENT_LIMIT } from "./youtube-source-meta";

const many = Array.from({ length: 80 }, (_, i) => ({ id: String(i), parent: "root", text: `Comment ${i}`, like_count: i, author: `@u${i}` }));
test("yt-dlp metadata becomes the shown details; comments are top-level only and capped", () => {
  const m = parseYoutubeSourceMeta({ title: "T", channel: "C", upload_date: "20260315", duration: 90.4, view_count: 5, like_count: 2, comment_count: 80, tags: ["a", 7, "b"], chapters: [{ start_time: 12, title: "Intro" }, { title: "no start" }],
    thumbnail: "http://insecure/x.jpg", comments: [...many, { id: "r", parent: "0", text: "reply", author: "x" }] });
  assert.equal(m.uploadDate, "2026-03-15"); assert.equal(m.duration, 90); assert.deepEqual(m.tags, ["a", "b"]); assert.deepEqual(m.chapters, [{ start: 12, title: "Intro" }]);
  assert.equal(m.thumbnail, null); assert.equal(m.comments.length, SOURCE_COMMENT_LIMIT); assert.equal(m.commentsError, null); assert.equal(m.comments[0].replies, null);
});
test("a failed comments fetch is explained, not silent", () => {
  assert.match(parseYoutubeSourceMeta({ title: "T", comment_count: 40 }).commentsError!, /returned no comments/);
  assert.match(parseYoutubeSourceMeta({ title: "T", comments: [], comment_count: 0 }).commentsError!, /no comments yet/);
  assert.match(commentsFailureReason("WARNING: Comments are turned off for this video", null), /turned off/);
  assert.match(commentsFailureReason("HTTP Error 429: Too Many Requests", 10), /limited the comments request/);
});
test("one extractor argument carries the comment limits (top 50, no replies)", () => assert.equal(commentExtractorArgs, "comment_sort=top;max_comments=50,50,0,0"));
test("what a Mac sends is validated before it is stored or shown", () => {
  const ok = parseYoutubeSourceMeta({ title: "T", comments: many.slice(0, 3) });
  assert.deepEqual(readSourceMeta(JSON.parse(JSON.stringify(ok))), ok);
  assert.equal(readSourceMeta("nope"), null); assert.equal(readSourceMeta([]), null);
  const hostile = readSourceMeta({ title: "T", comments: [{ text: 5 }, { text: "x".repeat(5000), author: "a" }], tags: [1, "ok"], thumbnail: "javascript:alert(1)", uploadDate: "yesterday" })!;
  assert.equal(hostile.comments.length, 1); assert.equal(hostile.comments[0].text.length, 600); assert.deepEqual(hostile.tags, ["ok"]); assert.equal(hostile.thumbnail, null); assert.equal(hostile.uploadDate, null);
});
