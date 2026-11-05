import React from "react";
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { LibraryCard } from "./library-cards";
// The repository's tsx runner uses the classic JSX transform.
Object.assign(globalThis, { React });
const record = { id: "source-id", kind: "reference", title: "A useful source", source_url: "https://youtube.com/watch?v=i4z0kCcByY8", summary: null, approved: false, archived: false, payload: { channelName: "Creator" } };
test("thumbnail opens original platform and details stay a separate internal link", () => {
  const html = renderToStaticMarkup(<LibraryCard record={record} />);
  assert.match(html, /<a href="https:\/\/youtube.com\/watch\?v=i4z0kCcByY8" target="_blank" rel="noopener noreferrer"[^>]*>[\s\S]*?<img/);
  assert.match(html, /href="\/studio\/library\/source-id"[^>]*>Details &amp; notes<\/a>/);
  const visibleText = html.replace(/<[^>]*>/g, "");
  assert.ok(!visibleText.includes("https://"));
  assert.ok(visibleText.includes("Creator"));
});
test("old private thumbnail aliases render the deterministic fallback without an image", () => {
  for (const alias of ["thumbnailUrl", "thumbnail_url", "thumbnail", "imageUrl", "image_url", "avatarUrl", "avatar_url"]) {
    const html = renderToStaticMarkup(<LibraryCard record={{ ...record, source_url: "https://example.com/post", payload: { [alias]: "https://192.168.1.1/private.jpg" } }} />);
    assert.ok(!html.includes("<img"), alias);
    assert.ok(!html.includes("192.168.1.1"), alias);
    assert.ok(html.includes("A useful source"));
  }
});
