import assert from "node:assert/strict";
import test from "node:test";

import {
    findIdsOutsideLocation,
    requireActivePropertyLocation,
} from "./location-boundary";

test("property mutations use the server-resolved active location", () => {
    assert.equal(requireActivePropertyLocation("location-a", "location-a"), "location-a");
    assert.equal(requireActivePropertyLocation("location-a"), "location-a");
});

test("property mutations reject missing or mismatched location context", () => {
    assert.throws(() => requireActivePropertyLocation(null, "location-a"), /Unauthorized/);
    assert.throws(
        () => requireActivePropertyLocation("location-a", "location-b"),
        /Location context mismatch/,
    );
});

test("related records outside the active location are identified", () => {
    assert.deepEqual(
        findIdsOutsideLocation(
            ["contact-a", "contact-b", "contact-a", null],
            ["contact-a"],
        ),
        ["contact-b"],
    );
});
