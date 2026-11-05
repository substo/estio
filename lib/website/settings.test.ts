import assert from "node:assert/strict";
import test from "node:test";
import { mergeWebsiteDocuments, overlayWebsiteLayout, websiteLayoutOnly } from "./settings";
import { planWebsiteMerge } from "./merge-plan";

test("the website document keeps layout only", () => {
    const out = websiteLayoutOnly({ navLinks: [1], contactInfo: { email: "a@b.c" }, footerBio: "x", domain: "d", theme: { primaryColor: "#000000", backgroundColor: "#ffffff", logo: { url: "u", textTop: "DOWN TOWN" } } });
    assert.deepEqual(out, { navLinks: [1], theme: { backgroundColor: "#ffffff", logo: { textTop: "DOWN TOWN" } } });
});

test("layout from the document replaces the stored row; brand colours and logos stay for the profile overlay", () => {
    const row = { navLinks: ["old"], heroContent: "old", theme: { primaryColor: "#111111", backgroundColor: "#000000", logo: { url: "logo.png", textTop: "OLD" } } };
    const out = overlayWebsiteLayout(row, { navLinks: ["new"], theme: { backgroundColor: "#ffffff", primaryColor: "#999999", logo: { textTop: "NEW", url: "stale.png" } } });
    assert.deepEqual(out.navLinks, ["new"]); assert.equal(out.heroContent, "old");
    assert.equal(out.theme.backgroundColor, "#ffffff"); assert.equal(out.theme.primaryColor, "#111111");
    assert.equal(out.theme.logo.textTop, "NEW"); assert.equal(out.theme.logo.url, "logo.png");
    assert.equal(overlayWebsiteLayout(row, null), row);
});

test("merging documents: the newer document wins a differing key, and the conflict is reported", () => {
    const old = new Date("2026-01-01"), newer = new Date("2026-06-01");
    const r = mergeWebsiteDocuments({ publicSite: { navLinks: ["site"], theme: {} }, publicSiteAt: old, navigation: { navLinks: ["nav"], menuStyle: "top", socialLinks: [1] }, navigationAt: newer, content: { homeSections: [1] }, contentAt: old });
    assert.deepEqual(r.payload.navLinks, ["nav"]); assert.deepEqual(r.payload.homeSections, [1]); assert.equal(r.payload.theme.menuStyle, "top");
    assert.equal(r.payload.socialLinks, undefined); assert.equal(r.conflicts.length, 1);
    const same = mergeWebsiteDocuments({ publicSite: { navLinks: ["site"] }, publicSiteAt: newer, navigation: { navLinks: ["nav"] }, navigationAt: old });
    assert.deepEqual(same.payload.navLinks, ["site"]);
});

test("the merge plan flags business values missing from the profile and strips brand voice from AI settings", () => {
    const at = new Date();
    const plan = planWebsiteMerge({ publicSite: { payload: { contactInfo: { email: "a@b.c" }, theme: {} }, updatedAt: at }, navigation: null, content: null,
        ai: { payload: { brandVoice: "warm", googleAiModel: "m" }, updatedAt: at }, business: null });
    assert.deepEqual(plan.ai, { googleAiModel: "m" });
    assert.ok(plan.stripped.every(s => !s.inProfile));
    assert.deepEqual(plan.stripped.map(s => s.key).sort(), ["ai.brandVoice", "public_site.contactInfo"]);
});
