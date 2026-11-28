import test from "node:test";
import assert from "node:assert/strict";
import { slideTerms, usableSlideText } from "./video-slide-terms";

test("noise OCR is not usable, real slide text is", () => {
  assert.equal(usableSlideText("/ “*> vy -—"), false);
  assert.equal(usableSlideText("Agent ontine Sat 21 Mon 23"), true);
});
test("terms on slides are compared with what was said", () => {
  const t = slideTerms([{ ocr_text: "A2UI Google Apache-2.0 protocol" }, { ocr_text: "~ ^ vy" }, { ocr_text: "Here are the open dates: Chef's counter" }],
    "[00:00:00] Google just released A2UI, a protocol for agents.");
  assert.equal(t.slides, 3); assert.equal(t.slidesWithText, 2);
  assert.ok(t.missing.includes("Apache-2.0") || t.missing.includes("Apache-2.0".replace(/[.-]+$/, "")), "a term never spoken is listed");
  assert.ok(!t.missing.some(w => /a2ui|google/i.test(w)), "spoken terms are not listed");
  assert.ok(t.inSpeech >= 2);
});
