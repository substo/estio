import { homeSectionBlocks } from "./home-sections";
import assert from "node:assert/strict";
import test from "node:test";
import { hostedHtml, hostedBlocks } from "./hosted-content";
import { hostedWebsiteConfig } from "./config";
import { websiteDesignPrompt, DESIGN_SYSTEM_PROMPT } from "@/lib/ai/prompts/design-system";

test("shared renderer input preserves layout, animation, colours and generic form blocks", () => {
    const config = hostedWebsiteConfig({ substoSiteConfig: { title: '<script>private()</script>' } }, "my-brand");
    const blocks = hostedBlocks([
        { type: "hero", headline: "Hello &#123;{company_name}}", layout: "split-left", animation: "zoom-in", styles: { backgroundColor: "#112233" }, ctaLink: "/about" },
        { type: "form", title: "Contact us" }, { type: "featured-properties", title: "Properties" },
        { type: "text", htmlContent: '<p onclick="bad()">Published <strong>content</strong></p>' },
    ], "my-brand", config);
    assert.equal(blocks[0].layout, "split-left"); assert.equal(blocks[0].animation, "zoom-in");
    assert.equal(blocks[0].styles.backgroundColor, "#112233");
    assert.equal(blocks[0].ctaLink, "/sites/my-brand/about");
    assert.equal(blocks[1].type, "form");
    assert.equal(blocks.length, 3);
    assert.doesNotMatch(JSON.stringify(blocks), /<script|onclick|featured-properties/);
    assert.match(blocks[0].headline, /&lt;script&gt;/);
});
test("untrusted content cannot add executable HTML, styles, unsafe URLs or nested forms", () => {
    const html = hostedHtml('<p style="position:fixed;color:#ff0000" onclick="steal()">Hello <strong>brand</strong></p><script>steal()</script><iframe src="https://evil.example"></iframe><form><input name="secret"></form><svg><a href="javascript:steal()">svg</a></svg><img src="https://example.com/photo.jpg" onerror="steal()"><a href="jav&#97;script:steal()">unsafe</a><a href="/about">About</a>', "my-brand");
    assert.match(html, /<strong>brand<\/strong>/); assert.match(html, /href="\/sites\/my-brand\/about"/);
    assert.match(html, /color:#ff0000/);
    assert.doesNotMatch(html, /steal|onclick|onerror|position:|<script|<iframe|<form|<input|<svg|javascript:/i);
    const blocks = hostedBlocks([{ type: "hero", image: "javascript:alert(1)", ctaLink: "data:text/html,bad", styles: { backgroundColor: "red;display:none" } }], "my-brand", {});
    assert.equal(blocks[0].image, ""); assert.equal(blocks[0].ctaLink, "#"); assert.equal(blocks[0].styles.backgroundColor, "");
});
test("public design adapter shares existing fields, rebases links and never serializes private config", () => {
    const config = hostedWebsiteConfig({ locationId: "one", googleAiApiKey: "SECRET", location: { apiKey: "SECRET" }, theme: { primaryColor: "#123456", logo: { textTop: "Brand", url: "javascript:bad()" } }, navLinks: [{ label: "About", href: "/about" }], contactInfo: { email: "hello@example.com", apiKey: "SECRET" } }, "my-brand");
    assert.equal(config.theme.primaryColor, "#123456"); assert.equal(config.name, "Brand");
    assert.equal(config.navLinks[0].href, "/sites/my-brand/about");
    assert.doesNotMatch(JSON.stringify(config), /SECRET|javascript/);
    assert.equal(websiteDesignPrompt("estio"), DESIGN_SYSTEM_PROMPT);
    assert.match(websiteDesignPrompt("substo"), /Premium Business/);
    assert.doesNotMatch(websiteDesignPrompt("substo"), /Real Estate|Sold/);
});


test("homepage blocks use the existing section order/hero schema with only property capabilities omitted", () => {
    const config = { homeSections: [{ id: "second", type: "text", enabled: true, order: 2, htmlContent: "About us" }, { id: "hero", type: "hero", enabled: true, order: 0 }, { id: "property", type: "featured-properties", enabled: true, order: 1 }, { id: "off", type: "stats", enabled: false, order: 3 }], heroContent: { headline: "Welcome", layout: "split-left" } };
    const estio = homeSectionBlocks(config);
    const substo = homeSectionBlocks(config, false);
    assert.deepEqual(estio.map(block => block.type), ["hero", "featured-properties", "text"]);
    assert.deepEqual(substo, estio.filter(block => block.type !== "featured-properties"));
    assert.equal(substo[0].headline, "Welcome"); assert.equal(substo[0].layout, "split-left");
});
