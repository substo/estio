import assert from "node:assert/strict";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PublicRichText, PublicPageContent } from "./content";
import { websiteSettings } from "./policy";
(globalThis as { React?: typeof React }).React = React;
const rich = (html: string) => renderToStaticMarkup(createElement(PublicRichText, { html, slug: "my-brand" }));

test("published rich text preserves formatting while removing executable markup, events, styles and forms", () => {
  const html = rich(`<p style="position:fixed" onclick="steal()">Hello <strong>brand</strong></p><script>steal()</script><iframe src="https://evil.example"></iframe><form action="/api/private"><input name="password"></form><svg><a href="javascript:steal()">svg</a></svg><math><mtext>bad</mtext></math><img src="https://example.com/photo.jpg" onerror="steal()"><a href="jav&#97;script:steal()">unsafe</a><a href="/about">About</a>`);
  assert.match(html, /<strong>brand<\/strong>/);
  assert.match(html, /href="\/sites\/my-brand\/about"/);
  assert.match(html, /src="https:\/\/example.com\/photo.jpg"/);
  assert.doesNotMatch(html, /steal|onclick|onerror|position:|<script|<iframe|<form|<input|<svg|<math|javascript:/i);
});

test("text and attribute escapes cannot reintroduce tags or event handlers", () => {
  const html = rich(`<p>&lt;script&gt;evil()&lt;/script&gt;</p><img src="https://example.com/x" alt='" onerror="evil()'><a href="https://example.com" target="_top">safe</a>`);
  assert.doesNotMatch(html, /<script|alt="" onerror=|target="_top"/);
  assert.match(html, /&lt;script&gt;/);
});

test("generic blocks reuse safe text and URL handling; forms/property widgets never become public controls", () => {
  const html = renderToStaticMarkup(createElement(PublicPageContent, {
    slug: "my-brand", settings: websiteSettings({ title: '<script>private()</script>' }), blocks: [
      { type: "hero", headline: "Hello {{company_name}}", subheadline: "<em>Our work</em>", ctaText: "About", ctaLink: "/about" },
      { type: "text", htmlContent: '<p onclick="bad()">Published content</p>' },
      { type: "form", title: "Do not render form" }, { type: "featured-properties", title: "Do not render properties" },
    ],
  }));
  assert.match(html, /Our work|Published content/);
  assert.match(html, /href="\/sites\/my-brand\/about"/);
  assert.doesNotMatch(html, /<script|onclick|Do not render/);
});
