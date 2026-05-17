import test from "node:test";
import assert from "node:assert/strict";
import { getSmsSegmentInfo } from "./segments";

test("160 GSM-7 characters fit in one SMS segment", () => {
    const result = getSmsSegmentInfo("a".repeat(160));

    assert.equal(result.encoding, "gsm-7");
    assert.equal(result.units, 160);
    assert.equal(result.segments, 1);
    assert.equal(result.segmentLimit, 160);
    assert.equal(result.remaining, 0);
});

test("161 GSM-7 characters become two SMS segments", () => {
    const result = getSmsSegmentInfo("a".repeat(161));

    assert.equal(result.encoding, "gsm-7");
    assert.equal(result.units, 161);
    assert.equal(result.segments, 2);
    assert.equal(result.segmentLimit, 153);
    assert.equal(result.remaining, 145);
});

test("GSM-7 extended characters count as two units", () => {
    const result = getSmsSegmentInfo("^{}\\[]~|€");

    assert.equal(result.encoding, "gsm-7");
    assert.equal(result.units, 18);
    assert.equal(result.segments, 1);
    assert.equal(result.remaining, 142);
});

test("70 Unicode characters fit in one SMS segment", () => {
    const result = getSmsSegmentInfo("Ж".repeat(70));

    assert.equal(result.encoding, "unicode");
    assert.equal(result.units, 70);
    assert.equal(result.segments, 1);
    assert.equal(result.segmentLimit, 70);
    assert.equal(result.remaining, 0);
});

test("71 Unicode characters become two SMS segments", () => {
    const result = getSmsSegmentInfo("Ж".repeat(71));

    assert.equal(result.encoding, "unicode");
    assert.equal(result.units, 71);
    assert.equal(result.segments, 2);
    assert.equal(result.segmentLimit, 67);
    assert.equal(result.remaining, 63);
});

test("emoji and smart quotes use Unicode SMS limits", () => {
    assert.equal(getSmsSegmentInfo("Hello 😊").encoding, "unicode");
    assert.equal(getSmsSegmentInfo("“Hello”").encoding, "unicode");
});
