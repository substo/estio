import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PublicBlockRenderer } from "@/app/(public-site)/_components/public-block-renderer";
import { hostedBlocks } from "./hosted-content";
import { WebsiteBlogIndex } from "@/components/website/blog-index";
import { WebsiteBlogPost } from "@/components/website/blog-post";
(globalThis as { React?: typeof React }).React = React;

test("hosted content keeps Estio's exact block layout and styling for equivalent generic content", () => {
    const config = { name: "Acme", theme: { primaryColor: "#123456" } };
    const blocks = [
        { type: "hero", headline: "Welcome", subheadline: "Our business", layout: "split-left", animation: "none", theme: "brand-solid", styles: { backgroundColor: "#123456" } },
        { type: "features", title: "Our services", items: [{ title: "Advice", description: "Expert advice", role: "Research & analysis", icon: "Check" }] },
        { type: "form", title: "Get in touch", subtext: "Research & advice" },
    ];
    const estio = renderToStaticMarkup(<PublicBlockRenderer blocks={blocks} siteConfig={config} />);
    const substo = renderToStaticMarkup(<PublicBlockRenderer blocks={hostedBlocks(blocks, "acme", config)} siteConfig={config} />);
    assert.equal(substo, estio);
    assert.match(substo, /lg:grid-cols-2/);
    assert.match(substo, /background-color:#123456/);
    assert.match(substo, /Get in touch|First name/);
});
test("shared blog keeps the same cards and post content while using the edition's website base path", () => {
    const posts = [{ slug: "hello", title: "Hello world", excerpt: "News", content: "<p>Article</p>", authorName: "Alice", coverImage: "https://example.com/cover.jpg", publishedAt: new Date("2026-01-01T00:00:00Z") }];
    const estio = renderToStaticMarkup(<WebsiteBlogIndex posts={posts} />);
    const substo = renderToStaticMarkup(<WebsiteBlogIndex posts={posts} basePath="/sites/acme" />);
    assert.equal(substo.replaceAll("/sites/acme/blog/", "/blog/"), estio);
    assert.match(substo, /md:grid-cols-3/);
    const article = renderToStaticMarkup(<WebsiteBlogPost post={posts[0]} />);
    assert.match(article, /By Alice/); assert.match(article, /<p>Article<\/p>/);
});
