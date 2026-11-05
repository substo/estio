import React from "react";
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
Object.assign(globalThis, { React });
// Auto-enrichment requires Next's router; SSR closed collection layout is tested
// through the local browser harness, while disclosure trigger is pure SSR.
import { LibraryAddDialog } from "./library-add-dialog";
test("add source is initially a compact action, with no automatically opened form", () => {
  const html = renderToStaticMarkup(<LibraryAddDialog locationId="test" />);
  assert.match(html, /aria-haspopup="dialog"/);
  assert.match(html, /data-state="closed"/);
  assert.ok(html.includes("Add source"));
  assert.ok(!html.includes("<form"));
  assert.ok(!html.includes("<input"));
});
test("empty-state disclosure is user initiated with a distinct call to action", () => {
  const html = renderToStaticMarkup(<LibraryAddDialog locationId="test" empty />);
  assert.ok(html.includes("Add your first source"));
  assert.match(html, /aria-expanded="false"/);
  assert.ok(!html.includes('role="dialog"'));
});
