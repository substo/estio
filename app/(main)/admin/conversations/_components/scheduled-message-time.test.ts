import test from "node:test";
import assert from "node:assert/strict";

import {
    getScheduleDelayLocalValue,
    getScheduleTimingWarning,
    parseDatetimeLocalValue,
    toDatetimeLocalValue,
} from "./scheduled-message-time";

test("parseDatetimeLocalValue treats datetime-local input as local calendar fields", () => {
    const parsed = parseDatetimeLocalValue("2026-07-15T19:30");
    assert.ok(parsed);
    assert.equal(parsed.getFullYear(), 2026);
    assert.equal(parsed.getMonth(), 6);
    assert.equal(parsed.getDate(), 15);
    assert.equal(parsed.getHours(), 19);
    assert.equal(parsed.getMinutes(), 30);
});

test("parseDatetimeLocalValue rejects timezone-bearing and malformed inputs", () => {
    assert.equal(parseDatetimeLocalValue("2026-07-15T19:30Z"), null);
    assert.equal(parseDatetimeLocalValue("2026-07-15"), null);
    assert.equal(parseDatetimeLocalValue(""), null);
});

test("schedule delay helpers produce datetime-local values", () => {
    const now = new Date(2026, 6, 15, 19, 18, 0, 0).getTime();
    assert.equal(getScheduleDelayLocalValue(10, now), "2026-07-15T19:28");
    assert.equal(toDatetimeLocalValue(new Date(2026, 6, 15, 19, 30, 0, 0)), "2026-07-15T19:30");
});

test("getScheduleTimingWarning allows common short delays but rejects past values", () => {
    const now = new Date(2026, 6, 15, 19, 18, 0, 0).getTime();
    assert.equal(getScheduleTimingWarning("2026-07-15T19:28", now), null);
    assert.equal(getScheduleTimingWarning("2026-07-15T19:18", now), "Choose a future date and time.");
});
