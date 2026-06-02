import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizePhoneDigits, phoneDigitsLikelyMatch } from "./phone-lookup";

test("normalizes phone values to comparable digits", () => {
    assert.equal(normalizePhoneDigits("+357 99 111 222"), "35799111222");
    assert.equal(normalizePhoneDigits("tel:+44 (7700) 900123"), "447700900123");
});

test("phoneDigitsLikelyMatch requires exact match or strong suffix overlap", () => {
    assert.equal(phoneDigitsLikelyMatch("+35799111222", "35799111222"), true);
    assert.equal(phoneDigitsLikelyMatch("+35799111222", "99111222"), false);
    assert.equal(phoneDigitsLikelyMatch("+35799111222", "991112223"), false);
    assert.equal(phoneDigitsLikelyMatch("+35799111222", "+99111222"), false);
    assert.equal(phoneDigitsLikelyMatch("+35799111222", "799111222"), true);
});
