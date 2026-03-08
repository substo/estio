import test from "node:test";
import assert from "node:assert/strict";
import {
    ViewingDateTimeValidationError,
    formatDateTimeLocalInTimeZone,
    parseViewingDateTimeInput,
} from "./datetime";

test("Cyprus local 13:00 resolves to 11:00Z", () => {
    const parsed = parseViewingDateTimeInput({
        scheduledLocal: "2026-03-09T13:00",
        scheduledTimeZone: "Europe/Nicosia",
    });

    assert.equal(parsed.utcDate.toISOString(), "2026-03-09T11:00:00.000Z");
    assert.equal(parsed.scheduledTimeZone, "Europe/Nicosia");
    assert.equal(parsed.scheduledLocal, "2026-03-09T13:00");
});

test("Cyprus datetime round-trips with local clock time", () => {
    const parsed = parseViewingDateTimeInput({
        scheduledLocal: "2026-03-09T13:00",
        scheduledTimeZone: "Europe/Nicosia",
    });

    const renderedLocal = formatDateTimeLocalInTimeZone(parsed.utcDate, "Europe/Nicosia");
    assert.equal(renderedLocal, "2026-03-09T13:00");
});

test("DST spring-forward gap is rejected", () => {
    assert.throws(
        () =>
            parseViewingDateTimeInput({
                scheduledLocal: "2026-03-29T03:30",
                scheduledTimeZone: "Europe/Nicosia",
            }),
        (error: unknown) => {
            assert.ok(error instanceof ViewingDateTimeValidationError);
            assert.equal(error.code, "DST_INVALID_LOCAL_TIME");
            return true;
        }
    );
});

test("DST fall-back ambiguous local time is rejected", () => {
    assert.throws(
        () =>
            parseViewingDateTimeInput({
                scheduledLocal: "2026-10-25T03:30",
                scheduledTimeZone: "Europe/Nicosia",
            }),
        (error: unknown) => {
            assert.ok(error instanceof ViewingDateTimeValidationError);
            assert.equal(error.code, "DST_AMBIGUOUS_LOCAL_TIME");
            return true;
        }
    );
});
