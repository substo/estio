import test from "node:test";
import assert from "node:assert/strict";
import {
  convertDateTimeLocalToIso,
  formatDateTimeLocalValue,
  isLocalDateTimeWithoutZone,
} from "./datetime-local.ts";

test("convertDateTimeLocalToIso preserves a Europe/Nicosia local pick when given its offset", () => {
  const iso = convertDateTimeLocalToIso("2026-03-13T21:48", -120);
  assert.equal(iso, "2026-03-13T19:48:00.000Z");
});

test("convertDateTimeLocalToIso leaves timezone-aware timestamps unchanged", () => {
  const iso = convertDateTimeLocalToIso("2026-03-13T21:48:00.000Z", -120);
  assert.equal(iso, "2026-03-13T21:48:00.000Z");
});

test("formatDateTimeLocalValue renders a datetime-local compatible value", () => {
  const value = formatDateTimeLocalValue("2026-03-13T19:48:00.000Z");
  assert.match(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
});

test("isLocalDateTimeWithoutZone detects timezone-less local datetimes", () => {
  assert.equal(isLocalDateTimeWithoutZone("2026-03-13T21:48"), true);
  assert.equal(isLocalDateTimeWithoutZone("2026-03-13T21:48:00.000Z"), false);
});
