import assert from "node:assert/strict";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProductSwitcher } from "./product-switcher";

// tsx compiles JSX with the classic runtime outside Next.
(globalThis as { React?: typeof React }).React = React;

const render = (props: Parameters<typeof ProductSwitcher>[0]) => renderToStaticMarkup(createElement(ProductSwitcher, props));

test("a brand with a single product shows no switch", () => {
  assert.equal(render({ active: "studio", targets: { studio: { href: "/studio" } } }), "");
});

test("both products render, the active one is current and not a link", () => {
  const html = render({ active: "crm", targets: { crm: { href: "/admin" }, studio: { href: "/studio" } } });
  assert.match(html, /aria-current="page"[^>]*>.*CRM/);
  assert.match(html, /href="\/studio"[^>]*>.*Studio/);
  assert.doesNotMatch(html, /href="\/admin"/);
});

test("action targets submit their hidden fields", () => {
  const html = render({ active: "crm", targets: { crm: { href: "/admin" }, studio: { action: async () => {}, fields: { locationId: "loc_1" } } } });
  assert.match(html, /<input type="hidden" name="locationId" value="loc_1"\/>/);
  assert.match(html, /<button type="submit"/);
});
