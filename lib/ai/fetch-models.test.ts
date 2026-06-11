import test from "node:test";
import assert from "node:assert/strict";

import { resolveAiModelDefault } from "./fetch-models";
import {
    GEMINI_DRAFT_FAST_DEFAULT,
    GEMINI_FLASH_LITE_LATEST_ALIAS,
    GEMINI_FLASH_LATEST_ALIAS,
} from "./models";

test("resolveAiModelDefault defaults translation to flash-lite latest when available", async () => {
    const model = await resolveAiModelDefault(undefined, "translation", [
        { value: GEMINI_FLASH_LATEST_ALIAS, label: "Gemini Flash Latest" },
        { value: GEMINI_FLASH_LITE_LATEST_ALIAS, label: "Gemini Flash-Lite Latest" },
    ]);

    assert.equal(model, GEMINI_FLASH_LITE_LATEST_ALIAS);
});

test("resolveAiModelDefault falls back to pinned flash-lite for translation", async () => {
    const model = await resolveAiModelDefault(undefined, "translation", [
        { value: GEMINI_FLASH_LATEST_ALIAS, label: "Gemini Flash Latest" },
        { value: GEMINI_DRAFT_FAST_DEFAULT, label: "Gemini 2.5 Flash-Lite" },
    ]);

    assert.equal(model, GEMINI_DRAFT_FAST_DEFAULT);
});
