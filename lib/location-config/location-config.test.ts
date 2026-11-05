import assert from "node:assert/strict";
import test from "node:test";
import { assembleLocationConfig, routeConfigPatch, LOCATION_CONFIG_DEFAULTS } from "./model";
import { planSiteConfigRetirement } from "./retire";

test("the config row takes AI settings, search defaults, site title and routing from their homes, with defaults otherwise", () => {
    const row = assembleLocationConfig({ locationId: "l1", location: { domain: "agency.example", websiteSlug: "my-brand", websitePublished: true },
        ai: { googleAiModel: "gemini-3", whatsappTranscriptRetentionDays: 30 }, website: { defaultCity: "Paphos", publicListingEnabled: false, siteTitle: "Brand" } });
    assert.equal(row.googleAiModel, "gemini-3"); assert.equal(row.whatsappTranscriptRetentionDays, 30);
    assert.equal(row.googleAiModelDesign, LOCATION_CONFIG_DEFAULTS.googleAiModelDesign);
    assert.equal(row.defaultCity, "Paphos"); assert.equal(row.publicListingEnabled, false);
    assert.equal(row.domain, "agency.example"); assert.equal(row.substoSiteSlug, "my-brand"); assert.equal(row.substoSitePublished, true);
    assert.deepEqual(row.substoSiteConfig, { title: "Brand" });
    const bare = assembleLocationConfig({ locationId: "l2", location: null, ai: null, website: null });
    assert.equal(bare.publicListingEnabled, true); assert.equal(bare.substoSiteConfig, null); assert.equal(bare.domain, null);
});

test("saving routes each key to its home and refuses business details", () => {
    const r = routeConfigPatch({ googleAiModel: "m", minPrice: 100, theme: {}, domain: "x.example", substoSiteSlug: "s", substoSitePublished: true, substoSiteConfig: { title: "T" }, contactInfo: {}, brandVoice: "v" } as any);
    assert.deepEqual(r.ai, { googleAiModel: "m" });
    assert.deepEqual(r.website, { minPrice: 100, theme: {}, siteTitle: "T" });
    assert.deepEqual(r.location, { domain: "x.example", websiteSlug: "s", websitePublished: true });
    assert.deepEqual(r.business, ["contactInfo", "brandVoice"]);
});

test("retirement copies only missing non-default values, keeps documents and reports differences", () => {
    const plan = planSiteConfigRetirement({
        row: { googleAiModel: "gemini-flash-latest", googleAiModelExtraction: "gemini-1.5-flash", whatsappTranscriptOnDemandEnabled: true, viewingSessionSummaryModel: null,
            publicListingEnabled: false, defaultCity: "Paphos", domain: "agency.example", substoSiteConfig: { title: "Brand" } },
        locationDomain: null, ai: { googleAiModel: "gemini-flash-latest" }, website: { publicListingEnabled: true },
    });
    assert.deepEqual(plan.ai, { whatsappTranscriptOnDemandEnabled: true });
    assert.deepEqual(plan.website, { defaultCity: "Paphos", siteTitle: "Brand" });
    assert.equal(plan.domain, "agency.example");
    assert.ok(plan.report.some(line => /keep website\.publicListingEnabled true \(table had false\)/.test(line)));
});
