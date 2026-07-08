import assert from "node:assert/strict";
import test from "node:test";

import {
    buildLegacyPublicListingUrl,
    resolvePropertyPublicUrlFromSettings,
} from "./public-url";

test("buildLegacyPublicListingUrl derives old CRM public URL from crmUrl and slug", () => {
    assert.equal(
        buildLegacyPublicListingUrl({
            crmUrl: "https://www.downtowncyprus.com/admin",
            slug: "apartment-for-rent-in-kato-paphos-universal-paphos-ref-dt5092",
        }),
        "https://www.downtowncyprus.com/properties/apartment-for-rent-in-kato-paphos-universal-paphos-ref-dt5092"
    );
});

test("buildLegacyPublicListingUrl appends preview for inactive old CRM listings", () => {
    assert.equal(
        buildLegacyPublicListingUrl({
            crmUrl: "https://www.downtowncyprus.com/admin",
            slug: "bungalow-for-sale-in-peyia-paphos-ref-dt5079",
            preview: true,
        }),
        "https://www.downtowncyprus.com/properties/bungalow-for-sale-in-peyia-paphos-ref-dt5079?preview=true"
    );
});

test("resolvePropertyPublicUrlFromSettings uses Estio URL by default", () => {
    assert.equal(
        resolvePropertyPublicUrlFromSettings({
            property: { slug: "sea-view" },
            location: { publicListingUrlMode: "ESTIO", siteConfig: { domain: "agency.example" } },
        }),
        "https://agency.example/properties/sea-view"
    );
});

test("resolvePropertyPublicUrlFromSettings prefers property external URL in legacy mode", () => {
    assert.equal(
        resolvePropertyPublicUrlFromSettings({
            property: {
                slug: "sea-view",
                externalPublicUrl: "https://www.downtowncyprus.com/properties/sea-view-ref-dt5000",
            },
            location: {
                publicListingUrlMode: "LEGACY_EXTERNAL",
                siteConfig: { domain: "agency.example" },
            },
        }),
        "https://www.downtowncyprus.com/properties/sea-view-ref-dt5000"
    );
});

test("resolvePropertyPublicUrlFromSettings uses legacy pattern when no override exists", () => {
    assert.equal(
        resolvePropertyPublicUrlFromSettings({
            property: {
                slug: "sea-view-ref-dt5000",
                reference: "DT5000",
                legacyCrmPropertyId: "4000",
            },
            location: {
                publicListingUrlMode: "LEGACY_EXTERNAL",
                legacyPublicListingUrlPattern: "https://legacy.example/properties/{slug}",
                siteConfig: { domain: "agency.example" },
            },
        }),
        "https://legacy.example/properties/sea-view-ref-dt5000"
    );
});
