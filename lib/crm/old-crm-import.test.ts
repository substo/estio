import test from "node:test";
import assert from "node:assert/strict";
import {
    extractLegacyCrmRefCandidates,
    hasOldCrmImportCapability,
} from "./old-crm-import";

test("hasOldCrmImportCapability requires crmUrl, crmUsername, and crmPassword", () => {
    assert.deepEqual(
        hasOldCrmImportCapability({
            crmUrl: "https://www.downtowncyprus.com/admin",
            crmUsername: "agent",
            crmPassword: "secret",
        }),
        {
            canImportOldCrmProperties: true,
            missing: [],
        }
    );

    assert.deepEqual(
        hasOldCrmImportCapability({
            crmUrl: "",
            crmUsername: "agent",
            crmPassword: null,
        }),
        {
            canImportOldCrmProperties: false,
            missing: ["crmUrl", "crmPassword"],
        }
    );
});

test("extractLegacyCrmRefCandidates parses explicit DT references", () => {
    assert.deepEqual(
        extractLegacyCrmRefCandidates("Ref. No.: DT3327"),
        [
            {
                publicReference: "DT3327",
                oldCrmPropertyId: "2327",
                source: "explicit_ref",
            },
        ]
    );
});

test("extractLegacyCrmRefCandidates parses Downtown Cyprus public URLs", () => {
    const [candidate] = extractLegacyCrmRefCandidates("https://www.downtowncyprus.com/properties/apartment-for-sale-in-anavargos-paphos-ref-dt3327");
    assert.equal(candidate?.publicReference, "DT3327");
    assert.equal(candidate?.oldCrmPropertyId, "2327");
});

test("extractLegacyCrmRefCandidates deduplicates and keeps multiple DT refs", () => {
    const refs = extractLegacyCrmRefCandidates([
        "Ref. No.: DT3327",
        "https://www.downtowncyprus.com/properties/apartment-for-sale-in-anavargos-paphos-ref-dt3327",
        "Also liked Ref No DT3328",
        "AB3327 should be ignored",
    ].join("\n"));

    assert.deepEqual(refs, [
        {
            publicReference: "DT3327",
            oldCrmPropertyId: "2327",
            source: "explicit_ref",
        },
        {
            publicReference: "DT3328",
            oldCrmPropertyId: "2328",
            source: "explicit_ref",
        },
    ]);
});
