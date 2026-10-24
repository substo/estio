import { test } from "node:test";
import assert from "node:assert/strict";
import { isScheduleRequest, readScheduleDraft } from "./schedule-policy";
function draft(patch: Record<string, string> = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries({ presetId: "idea-review", query: "  exact focus  ", intervalHours: "24", dailyTime: "09:00", ...patch })) form.set(key, value);
  return form;
}
test("preserves focus and validates supported local cadence", () => {
  assert.deepEqual(readScheduleDraft(draft()), { presetId: "idea-review", query: "  exact focus  ", intervalHours: 24, dailyTime: "09:00" });
  assert.equal(readScheduleDraft(draft({ intervalHours: "168", presetId: "youtube-discovery" })).intervalHours, 168);
});
test("rejects unsupported workflow, cadence, times, and unsafe focus", () => {
  const invalid: Record<string, string>[] = [{ presetId: "toString" }, { presetId: "knowledge-extract" }, { intervalHours: "1" }, { dailyTime: "24:00" }, { dailyTime: "9:00" }, { query: "x".repeat(161) }, { query: "a\nb" }];
  for (const patch of invalid) {
    assert.throws(() => readScheduleDraft(draft(patch)));
  }
});
test("requires UUID and safe nonnegative optimistic version", () => {
  const id = "81000000-0000-4000-8000-000000000001";
  assert.equal(isScheduleRequest(id, 0), true);
  for (const version of [-1, NaN, 1.1, Number.MAX_SAFE_INTEGER + 1]) assert.equal(isScheduleRequest(id, version), false);
  assert.equal(isScheduleRequest("invalid", 1), false);
});
