import test from "node:test";
import assert from "node:assert/strict";

import { buildAiDraftModelPickerStateResult, buildAiModelPickerDefaultsResult, resolveAiModelDefault } from "./fetch-models";
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

test("buildAiModelPickerDefaultsResult includes OpenAI models while keeping Gemini defaults", () => {
    const state = buildAiModelPickerDefaultsResult(
        [
            { value: GEMINI_FLASH_LATEST_ALIAS, label: "Gemini Flash Latest" },
            { value: GEMINI_DRAFT_FAST_DEFAULT, label: "Gemini 2.5 Flash-Lite" },
        ],
        [
            { value: "openai:gpt-test-text", label: "OpenAI GPT Test Text" },
        ],
        {
            general: GEMINI_FLASH_LATEST_ALIAS,
            draft: GEMINI_DRAFT_FAST_DEFAULT,
            extraction: GEMINI_FLASH_LATEST_ALIAS,
            design: GEMINI_FLASH_LATEST_ALIAS,
            transcription: GEMINI_DRAFT_FAST_DEFAULT,
            translation: GEMINI_FLASH_LITE_LATEST_ALIAS,
        }
    );

    const values = new Set(state.models.map((model) => model.value));
    assert.equal(values.has("openai:gpt-test-text"), true);
    assert.equal(state.defaults.general, GEMINI_FLASH_LATEST_ALIAS);
    assert.equal(state.defaults.draft, GEMINI_DRAFT_FAST_DEFAULT);
});

test("buildAiModelPickerDefaultsResult uses available OpenAI text default for general and draft", () => {
    const state = buildAiModelPickerDefaultsResult(
        [
            { value: GEMINI_FLASH_LATEST_ALIAS, label: "Gemini Flash Latest" },
            { value: GEMINI_DRAFT_FAST_DEFAULT, label: "Gemini 2.5 Flash-Lite" },
        ],
        [
            { value: "openai:gpt-4o-mini", label: "OpenAI GPT-4o Mini" },
        ],
        {
            general: GEMINI_FLASH_LATEST_ALIAS,
            draft: GEMINI_DRAFT_FAST_DEFAULT,
            extraction: GEMINI_FLASH_LATEST_ALIAS,
            design: GEMINI_FLASH_LATEST_ALIAS,
            transcription: GEMINI_DRAFT_FAST_DEFAULT,
            translation: GEMINI_FLASH_LITE_LATEST_ALIAS,
        },
        { textDefaultModel: "openai:gpt-4o-mini" }
    );

    assert.equal(state.defaults.general, "openai:gpt-4o-mini");
    assert.equal(state.defaults.draft, "openai:gpt-4o-mini");
    assert.equal(state.defaults.extraction, GEMINI_FLASH_LATEST_ALIAS);
    assert.equal(state.defaults.design, GEMINI_FLASH_LATEST_ALIAS);
    assert.equal(state.defaults.transcription, GEMINI_DRAFT_FAST_DEFAULT);
    assert.equal(state.defaults.translation, GEMINI_FLASH_LITE_LATEST_ALIAS);
});

test("buildAiModelPickerDefaultsResult ignores unavailable OpenAI text default", () => {
    const state = buildAiModelPickerDefaultsResult(
        [
            { value: GEMINI_FLASH_LATEST_ALIAS, label: "Gemini Flash Latest" },
            { value: GEMINI_DRAFT_FAST_DEFAULT, label: "Gemini 2.5 Flash-Lite" },
        ],
        [],
        {
            general: GEMINI_FLASH_LATEST_ALIAS,
            draft: GEMINI_DRAFT_FAST_DEFAULT,
            extraction: GEMINI_FLASH_LATEST_ALIAS,
            design: GEMINI_FLASH_LATEST_ALIAS,
            transcription: GEMINI_DRAFT_FAST_DEFAULT,
            translation: GEMINI_FLASH_LITE_LATEST_ALIAS,
        },
        { textDefaultModel: "openai:gpt-4o-mini" }
    );

    assert.equal(state.defaults.general, GEMINI_FLASH_LATEST_ALIAS);
    assert.equal(state.defaults.draft, GEMINI_DRAFT_FAST_DEFAULT);
});

test("buildAiDraftModelPickerStateResult prefers available OpenAI default", () => {
    const state = buildAiDraftModelPickerStateResult(
        [
            { value: GEMINI_DRAFT_FAST_DEFAULT, label: "Gemini 2.5 Flash-Lite" },
        ],
        [
            { value: "openai:gpt-4o-mini", label: "OpenAI GPT-4o Mini" },
        ],
        GEMINI_DRAFT_FAST_DEFAULT,
        "openai:gpt-4o-mini"
    );

    assert.equal(state.defaultModel, "openai:gpt-4o-mini");
    assert.deepEqual(new Set(state.models.map((model) => model.value)), new Set([
        GEMINI_DRAFT_FAST_DEFAULT,
        "openai:gpt-4o-mini",
    ]));
});

test("buildAiDraftModelPickerStateResult prefers direct OpenAI default over subscription default", () => {
    const state = buildAiDraftModelPickerStateResult(
        [
            { value: GEMINI_DRAFT_FAST_DEFAULT, label: "Gemini 2.5 Flash-Lite" },
        ],
        [
            { value: "openai:gpt-4o-mini", label: "OpenAI GPT-4o Mini" },
            { value: "chatgpt_subscription:gpt-5.4-mini", label: "ChatGPT Subscription GPT-5.4 Mini" },
        ],
        GEMINI_DRAFT_FAST_DEFAULT,
        "openai:gpt-4o-mini"
    );

    assert.equal(state.defaultModel, "openai:gpt-4o-mini");
});

test("buildAiDraftModelPickerStateResult falls back to Gemini when OpenAI default is unavailable", () => {
    const state = buildAiDraftModelPickerStateResult(
        [
            { value: GEMINI_DRAFT_FAST_DEFAULT, label: "Gemini 2.5 Flash-Lite" },
        ],
        [],
        GEMINI_DRAFT_FAST_DEFAULT,
        "openai:gpt-4o-mini"
    );

    assert.equal(state.defaultModel, GEMINI_DRAFT_FAST_DEFAULT);
});

test("buildAiDraftModelPickerStateResult keeps Gemini default when only subscription models are added", () => {
    const state = buildAiDraftModelPickerStateResult(
        [
            { value: GEMINI_DRAFT_FAST_DEFAULT, label: "Gemini 2.5 Flash-Lite" },
        ],
        [
            { value: "chatgpt_subscription:gpt-5.4-mini", label: "ChatGPT Subscription GPT-5.4 Mini" },
        ],
        GEMINI_DRAFT_FAST_DEFAULT,
        null
    );

    assert.equal(state.defaultModel, GEMINI_DRAFT_FAST_DEFAULT);
    assert.deepEqual(new Set(state.models.map((model) => model.value)), new Set([
        GEMINI_DRAFT_FAST_DEFAULT,
        "chatgpt_subscription:gpt-5.4-mini",
    ]));
});
