import assert from "node:assert/strict";
import test from "node:test";

import { listBoundedLocationImages } from "./location-image-gallery";

test("location gallery scans beyond the first global page without exposing foreign images or totals", async () => {
    const pages = [
        [
            { id: "foreign-1", filename: "x", uploaded: "", variants: [], meta: { locationId: "location-b" } },
            { id: "foreign-2", filename: "x", uploaded: "", variants: [], meta: { locationId: "location-b" } },
        ],
        [
            { id: "local-1", filename: "x", uploaded: "", variants: [], meta: { locationId: "location-a" } },
        ],
    ];
    const result = await listBoundedLocationImages({
        locationId: "location-a",
        limit: 50,
        pageSize: 2,
        maxScanPages: 5,
        fetchPage: async (page) => pages[page - 1] || [],
    });

    assert.deepEqual(result.images.map(({ id }) => id), ["local-1"]);
    assert.equal(result.scanComplete, true);
    assert.equal("total" in result, false);
});
