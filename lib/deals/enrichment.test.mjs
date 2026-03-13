import test from "node:test";
import assert from "node:assert/strict";
import {
    collectDealPropertyIdsFromContacts,
    getDealEnrichmentJobId,
    getDealEnrichmentState,
    mergeDealEnrichmentMetadata,
} from "./enrichment.ts";

test("mergeDealEnrichmentMetadata preserves unrelated metadata fields", () => {
    const merged = mergeDealEnrichmentMetadata(
        { foo: "bar", enrichment: { status: "pending", queuedAt: "2026-03-13T10:00:00.000Z" } },
        { status: "processing", startedAt: "2026-03-13T10:00:05.000Z" }
    );

    assert.equal(merged.foo, "bar");
    assert.deepEqual(getDealEnrichmentState(merged), {
        version: 1,
        status: "processing",
        queuedAt: "2026-03-13T10:00:00.000Z",
        startedAt: "2026-03-13T10:00:05.000Z",
        completedAt: null,
        failedAt: null,
        error: null,
        propertyCount: null,
    });
});

test("collectDealPropertyIdsFromContacts deduplicates roles and viewings", () => {
    const propertyIds = collectDealPropertyIdsFromContacts([
        {
            propertyRoles: [{ propertyId: "prop_1" }, { propertyId: "prop_2" }],
            viewings: [{ propertyId: "prop_2" }, { propertyId: "prop_3" }],
        },
        {
            propertyRoles: [{ propertyId: "prop_1" }],
            viewings: [{ propertyId: null }, {}],
        },
    ]);

    assert.deepEqual(propertyIds, ["prop_1", "prop_2", "prop_3"]);
});

test("getDealEnrichmentJobId prefixes the normalized deal id", () => {
    assert.equal(getDealEnrichmentJobId("deal_123"), "deal-enrichment:deal_123");
});
