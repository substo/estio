import assert from "node:assert/strict";
import test from "node:test";
import {
    buildAnalysisPrompt,
    buildGenerationPrompt,
    buildReusablePromptContext,
    normalizeImageEnhancementAnalysis,
    parseJsonObjectFromModelText,
    resolveEnhancementModelForTier,
} from "@/lib/ai/property-image-enhancement";
import type { ImageEnhancementAnalysis } from "@/lib/ai/property-image-enhancement-types";

test("normalizeImageEnhancementAnalysis falls back safely for malformed model output", () => {
    const malformed = {
        sceneSummary: "",
        detectedElements: "not-an-array",
        suggestedFixes: [{ label: "  ", description: "" }],
    } as any;

    const normalized = normalizeImageEnhancementAnalysis(malformed);

    assert.equal(typeof normalized.sceneSummary, "string");
    assert.ok(normalized.sceneSummary.length > 0);
    assert.deepEqual(normalized.detectedElements, []);
    assert.deepEqual(normalized.suggestedFixes, []);
});

test("buildGenerationPrompt includes selected fixes and aggression constraints", () => {
    const analysis: ImageEnhancementAnalysis = {
        sceneSummary: "Living room shot with mild clutter and flat lighting.",
        detectedElements: [],
        suggestedFixes: [
            {
                id: "declutter_floor",
                label: "Declutter floor",
                description: "Remove loose objects from floor area.",
                impact: "medium",
                defaultSelected: true,
                promptInstruction: "Remove loose clutter from the floor.",
            },
            {
                id: "balance_exposure",
                label: "Balance exposure",
                description: "Improve shadow/highlight balance.",
                impact: "high",
                defaultSelected: true,
                promptInstruction: "Balance exposure and recover highlights and shadows.",
            },
        ],
        promptPolish: "Create a polished listing-ready living room photo with realistic lighting.",
        actionLogDraft: [],
    };

    const prompt = buildGenerationPrompt({
        analysis,
        selectedFixIds: ["balance_exposure"],
        aggression: "balanced",
        userInstructions: "Remove the people reflected in the window if present.",
    });

    assert.match(prompt, /Balanced mode:/);
    assert.match(prompt, /Balance exposure and recover highlights and shadows\./);
    assert.doesNotMatch(prompt, /Remove loose clutter from the floor\./);
    assert.match(prompt, /Remove the people reflected in the window if present\./);
    assert.match(prompt, /preserv.*scene identity/i);
});

test("buildAnalysisPrompt includes operator override instructions when provided", () => {
    const prompt = buildAnalysisPrompt({
        userInstructions: "Look for people near the pool and propose removing them.",
    });

    assert.match(prompt, /operator-reported issues/i);
    assert.match(prompt, /Look for people near the pool and propose removing them\./);
});

test("buildReusablePromptContext stays concise and excludes legacy nesting markers", () => {
    const analysis: ImageEnhancementAnalysis = {
        sceneSummary: "Pool terrace photo with two loungers and some background clutter.",
        detectedElements: [],
        suggestedFixes: [
            {
                id: "remove_people",
                label: "Remove people",
                description: "Remove casual bystanders from the terrace.",
                impact: "high",
                defaultSelected: true,
                promptInstruction: "Remove the people from the terrace and reconstruct the background naturally.",
            },
        ],
        promptPolish: "Create a clean, premium listing photo with natural daylight and realistic surfaces.",
        actionLogDraft: [],
    };

    const prompt = buildReusablePromptContext({
        analysis,
        selectedFixIds: ["remove_people"],
        aggression: "balanced",
        userInstructions: "Keep the loungers exactly where they are.",
    });

    assert.match(prompt, /Reusable enhancement context/i);
    assert.match(prompt, /Keep the loungers exactly where they are\./);
    assert.doesNotMatch(prompt, /Legacy prompt reference:/);
});

test("resolveEnhancementModelForTier maps Nano Banana 2 and Pro correctly", () => {
    assert.equal(
        resolveEnhancementModelForTier("nano_banana_2"),
        "gemini-2.5-flash-image"
    );
    assert.equal(
        resolveEnhancementModelForTier("nano_banana_pro"),
        "gemini-3-pro-image-preview"
    );
    assert.equal(
        resolveEnhancementModelForTier(undefined),
        "gemini-2.5-flash-image"
    );
});

test("parseJsonObjectFromModelText extracts JSON from fenced output", () => {
    const raw = "```json\n{\"sceneSummary\":\"ok\"}\n```";
    const parsed = parseJsonObjectFromModelText(raw);
    assert.ok(parsed);
    assert.equal(parsed?.sceneSummary, "ok");
});
