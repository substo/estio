import assert from "node:assert/strict";
import test from "node:test";
import {
    buildGenerationPrompt,
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
    });

    assert.match(prompt, /Balanced mode:/);
    assert.match(prompt, /Balance exposure and recover highlights and shadows\./);
    assert.doesNotMatch(prompt, /Remove loose clutter from the floor\./);
    assert.match(prompt, /preserv.*scene identity/i);
});

test("resolveEnhancementModelForTier maps Nano Banana 2 and Pro correctly", () => {
    assert.equal(
        resolveEnhancementModelForTier("nano_banana_2"),
        "gemini-3.1-flash-image-preview"
    );
    assert.equal(
        resolveEnhancementModelForTier("nano_banana_pro"),
        "gemini-3-pro-image-preview"
    );
    assert.equal(
        resolveEnhancementModelForTier(undefined),
        "gemini-3.1-flash-image-preview"
    );
});

test("parseJsonObjectFromModelText extracts JSON from fenced output", () => {
    const raw = "```json\n{\"sceneSummary\":\"ok\"}\n```";
    const parsed = parseJsonObjectFromModelText(raw);
    assert.ok(parsed);
    assert.equal(parsed?.sceneSummary, "ok");
});
