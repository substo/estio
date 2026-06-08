import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeContactProfileVerificationConfig,
} from "./config";
import { GEMINI_FLASH_STABLE_FALLBACK } from "@/lib/ai/models";

test("contact profile verification config preserves selected classification model", () => {
  const config = normalizeContactProfileVerificationConfig({
    mode: "manual_only",
    model: "gemini-3-flash-preview",
    batchSize: 25,
  });

  assert.equal(config.mode, "manual_only");
  assert.equal(config.model, "gemini-3-flash-preview");
  assert.equal(config.batchSize, 25);
});

test("contact profile verification config defaults blank model to stable Gemini fallback", () => {
  const config = normalizeContactProfileVerificationConfig({
    model: "   ",
  });

  assert.equal(config.model, GEMINI_FLASH_STABLE_FALLBACK);
});
