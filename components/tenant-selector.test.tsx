import assert from "node:assert/strict";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TenantSelector } from "./tenant-selector";
(globalThis as { React?: typeof React }).React = React;
const render = (locations: Array<{ id: string; name: string | null }>, activeLocationId: string | null = locations[0]?.id ?? null) => renderToStaticMarkup(createElement(TenantSelector, { locations, activeLocationId, noun: "brand", onSelect: async () => { throw new Error("Rendering must not select"); } }));
test("one tenant shows its escaped name without an interactive dropdown or UUID", () => {
  const html = render([{ id: "secret-storage-id", name: "Substo & Co" }]);
  assert.match(html, /Substo &amp; Co/);
  assert.doesNotMatch(html, /button|Switch brand|secret-storage-id/);
});
test("multiple memberships offer an accessible selector and show the authorized current tenant", () => {
  const html = render([{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }], "b");
  assert.match(html, /aria-label="Switch brand"/); assert.match(html, />Beta</);
});
test("zero membership, no selected tenant and unnamed tenant are explicit states", () => {
  assert.match(render([]), /No brand access/);
  assert.match(render([{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }], null), /Choose a brand/);
  assert.match(render([{ id: "internal-id", name: " " }]), /Unnamed brand/);
});
