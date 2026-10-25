import assert from "node:assert/strict";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TenantHeaderSelector } from "./tenant-header-selector";
(globalThis as { React?: typeof React }).React = React;
const locations = [{ id: "a", name: "Current tenant" }, { id: "b", name: "Another tenant" }];
for (const product of ["crm", "studio"] as const) {
  test(`${product} header has only tenant identity, with cardinality-based selection`, () => {
    for (const app of ["estio", "substo"] as const) {
      const base = { app, product, activeLocationId: "a" };
      const one = renderToStaticMarkup(createElement(TenantHeaderSelector, { ...base, locations: locations.slice(0, 1) }));
      assert.match(one, /Current tenant/); assert.doesNotMatch(one, /<img|<svg|<button|Manage/);
      const multiple = renderToStaticMarkup(createElement(TenantHeaderSelector, { ...base, locations }));
      assert.match(multiple, new RegExp(`aria-label="Switch ${app === "estio" ? "location" : "brand"}"`));
      assert.doesNotMatch(multiple, /<img|Manage brands|Manage locations/);
    }
  });
  test(`${product} preserves the platform admin location dropdown`, () => {
    const html = renderToStaticMarkup(createElement(TenantHeaderSelector, { app: "estio", product, activeLocationId: "a", locations: locations.slice(0, 1), platformLoginLocations: locations.map((location) => ({ ...location, isPlatformMaster: location.id === "a", members: [] })) }));
    assert.match(html, /aria-label="Switch location"/); assert.match(html, /Current tenant/); assert.doesNotMatch(html, /Support access|<img/);
  });
}
