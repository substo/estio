import assert from "node:assert/strict";
import test from "node:test";
import {
    buildAnalysisPrompt,
    buildGenerationPrompt,
    buildReusablePromptContext,
    normalizeImageEnhancementAnalysis,
    parseJsonObjectFromModelText,
} from "@/lib/ai/property-image-enhancement";
import { resolveNeutralSceneContext } from "@/lib/ai/property-image-enhancement-prompt";
import { resolvePreferredPropertyImageEnhancementModel } from "@/lib/ai/property-image-enhancement-model-preferences";
import { buildPropertyImageModelCatalog } from "@/lib/ai/model-capabilities";
import type { ImageEnhancementAnalysis } from "@/lib/ai/property-image-enhancement-types";
import { mergePropertyImagePromptProfiles, parsePropertyImagePromptProfileUpsertsJson, resolvePromptProfileContext } from "@/lib/ai/property-image-prompt-profiles";
import {
    PROPERTY_IMAGE_ROOM_TYPE_PREDICTION_MIN_CONFIDENCE,
    PROPERTY_IMAGE_ROOM_TYPE_UNCLASSIFIED_KEY,
    resolvePropertyImageRoomType,
    toRoomTypeSelectValue,
} from "@/lib/ai/property-image-room-types";

test("normalizeImageEnhancementAnalysis falls back safely for malformed model output", () => {
    const malformed = {
        sceneSummary: "",
        detectedElements: "not-an-array",
        suggestedFixes: [{ label: "  ", description: "" }],
    } as any;

    const normalized = normalizeImageEnhancementAnalysis(malformed);

    assert.equal(typeof normalized.sceneSummary, "string");
    assert.equal(typeof normalized.sceneContext, "string");
    assert.ok(normalized.sceneSummary.length > 0);
    assert.deepEqual(normalized.detectedElements, []);
    assert.deepEqual(normalized.suggestedFixes, []);
});

test("buildGenerationPrompt includes selected fixes and aggression constraints without leaking deselected fixes", () => {
    const analysis: ImageEnhancementAnalysis = {
        sceneSummary: "Living room shot with mild clutter and flat lighting.",
        sceneContext: "Balance exposure, remove structure clutter, and improve the room carefully.",
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
            {
                id: "remove_structure",
                label: "Remove structure",
                description: "Remove structural clutter.",
                impact: "high",
                defaultSelected: false,
                promptInstruction: "Remove the visible structure near the window.",
            },
        ],
        actionLogDraft: [],
    };

    const prompt = buildGenerationPrompt({
        analysis,
        selectedFixIds: ["balance_exposure"],
        removedDetectedElementIds: [],
        aggression: "balanced",
        userInstructions: "Remove the people reflected in the window if present.",
    });

    assert.match(prompt, /Balanced mode:/);
    assert.match(prompt, /Balance exposure and recover highlights and shadows\./);
    assert.doesNotMatch(prompt, /Remove loose clutter from the floor\./);
    assert.doesNotMatch(prompt, /Remove the visible structure near the window\./);
    assert.doesNotMatch(prompt, /remove structure/i);
    assert.match(prompt, /Remove the people reflected in the window if present\./);
    assert.match(prompt, /preserv.*scene identity/i);
});

test("buildAnalysisPrompt includes operator override instructions when provided", () => {
    const prompt = buildAnalysisPrompt({
        userInstructions: "Look for people near the pool and propose removing them.",
    });

    assert.match(prompt, /operator-reported issues/i);
    assert.match(prompt, /Look for people near the pool and propose removing them\./);
    assert.match(prompt, /sceneContext/);
});

test("buildReusablePromptContext stays concise and excludes legacy nesting markers", () => {
    const analysis: ImageEnhancementAnalysis = {
        sceneSummary: "Pool terrace photo with two loungers and some background clutter.",
        sceneContext: "Pool terrace scene with loungers, paving, and natural daylight.",
        detectedElements: [
            {
                id: "person_poolside",
                label: "Person near pool",
                category: "person",
                severity: "medium",
                confidence: 0.91,
            },
        ],
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
        actionLogDraft: [],
    };

    const prompt = buildReusablePromptContext({
        analysis,
        selectedFixIds: ["remove_people"],
        removedDetectedElementIds: ["person_poolside"],
        aggression: "balanced",
        userInstructions: "Keep the loungers exactly where they are.",
    });

    assert.match(prompt, /Reusable enhancement context/i);
    assert.match(prompt, /Keep the loungers exactly where they are\./);
    assert.match(prompt, /Person near pool/i);
    assert.doesNotMatch(prompt, /Legacy prompt reference:/);
});

test("resolveNeutralSceneContext falls back to scene summary when analyzer context embeds fix instructions", () => {
    const analysis: ImageEnhancementAnalysis = {
        sceneSummary: "Neutral room summary.",
        sceneContext: "Balance exposure and remove the visible structure near the window.",
        detectedElements: [],
        suggestedFixes: [
            {
                id: "balance_exposure",
                label: "Balance exposure",
                description: "Improve exposure.",
                impact: "high",
                defaultSelected: true,
                promptInstruction: "Balance exposure and recover highlights.",
            },
            {
                id: "remove_structure",
                label: "Remove structure",
                description: "Remove structure.",
                impact: "high",
                defaultSelected: false,
                promptInstruction: "Remove the visible structure near the window.",
            },
        ],
        actionLogDraft: [],
    };

    assert.equal(resolveNeutralSceneContext(analysis), "Neutral room summary.");
});

test("buildPropertyImageModelCatalog separates analysis and generation models", () => {
    const catalog = buildPropertyImageModelCatalog([
        { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
        { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
        { value: "gemini-2.5-flash-image", label: "Gemini 2.5 Flash Image (Nano Banana 2)" },
        { value: "gemini-3-pro-image-preview", label: "Gemini 3 Pro Image Preview (Nano Banana Pro)" },
    ], {
        general: "gemini-2.5-flash",
        extraction: "gemini-2.5-pro",
        design: "gemini-3-pro-image-preview",
    });

    assert.deepEqual(
        catalog.analysisModels.map((model) => model.value),
        ["gemini-2.5-flash", "gemini-2.5-pro"]
    );
    assert.deepEqual(
        catalog.generationModels.map((model) => model.value),
        ["gemini-2.5-flash-image", "gemini-3-pro-image-preview"]
    );
    assert.equal(catalog.defaults.analysis, "gemini-2.5-pro");
    assert.equal(catalog.defaults.generation, "gemini-3-pro-image-preview");
});

test("buildPropertyImageModelCatalog falls back when design default is not image-capable", () => {
    const catalog = buildPropertyImageModelCatalog([
        { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
        { value: "gemini-2.5-flash-image", label: "Gemini 2.5 Flash Image (Nano Banana 2)" },
    ], {
        general: "gemini-2.5-flash",
        extraction: "gemini-2.5-flash",
        design: "gemini-2.5-flash",
    });

    assert.equal(catalog.defaults.analysis, "gemini-2.5-flash");
    assert.equal(catalog.defaults.generation, "gemini-2.5-flash-image");
});

test("parseJsonObjectFromModelText extracts JSON from fenced output", () => {
    const raw = "```json\n{\"sceneSummary\":\"ok\"}\n```";
    const parsed = parseJsonObjectFromModelText(raw);
    assert.ok(parsed);
    assert.equal(parsed?.sceneSummary, "ok");
});

test("resolvePreferredPropertyImageEnhancementModel prefers persisted model when current is invalid", () => {
    const resolved = resolvePreferredPropertyImageEnhancementModel({
        allowedValues: ["gemini-2.5-flash-image", "gemini-3-pro-image-preview"],
        currentValue: "gemini-2.5-pro",
        persistedValue: "gemini-2.5-flash-image",
        defaultValue: "gemini-3-pro-image-preview",
        fallbackValue: "gemini-3-pro-image-preview",
    });

    assert.equal(resolved, "gemini-2.5-flash-image");
});

test("resolvePreferredPropertyImageEnhancementModel falls back to first compatible when needed", () => {
    const resolved = resolvePreferredPropertyImageEnhancementModel({
        allowedValues: ["gemini-2.5-flash-image"],
        currentValue: "gemini-2.5-pro",
        persistedValue: "gemini-3-pro-image-preview",
        defaultValue: "gemini-2.5-flash",
        fallbackValue: "gemini-2.5-flash-image",
    });

    assert.equal(resolved, "gemini-2.5-flash-image");
});

test("resolvePropertyImageRoomType normalizes preset and custom room types", () => {
    const preset = resolvePropertyImageRoomType({
        key: "kitchen",
        confidence: 0.89,
    });
    assert.equal(preset.key, "kitchen");
    assert.equal(preset.label, "Kitchen");
    assert.equal(toRoomTypeSelectValue(preset.key), "kitchen");

    const custom = resolvePropertyImageRoomType({
        key: "custom",
        label: "Outdoor Back Patio",
        confidence: 0.71,
    });
    assert.equal(custom.key, "outdoor_back_patio");
    assert.equal(custom.label, "Outdoor Back Patio");
    assert.equal(toRoomTypeSelectValue(custom.key), "__custom__");
});

test("low-confidence room type fallback defaults to unclassified", () => {
    const predicted = resolvePropertyImageRoomType({
        key: "living_room",
        confidence: 0.32,
    });

    const finalType = Number(predicted.confidence || 0) >= PROPERTY_IMAGE_ROOM_TYPE_PREDICTION_MIN_CONFIDENCE
        ? predicted
        : resolvePropertyImageRoomType();

    assert.equal(finalType.key, PROPERTY_IMAGE_ROOM_TYPE_UNCLASSIFIED_KEY);
    assert.equal(finalType.label, "Unclassified");
});

test("mergePropertyImagePromptProfiles applies staged override by room type key", () => {
    const merged = mergePropertyImagePromptProfiles({
        existingProfiles: [
            {
                roomTypeKey: "kitchen",
                roomTypeLabel: "Kitchen",
                promptContext: "Old kitchen prompt",
            },
            {
                roomTypeKey: "living_room",
                roomTypeLabel: "Living Room",
                promptContext: "Living room prompt",
            },
        ],
        stagedUpserts: [
            {
                roomTypeKey: "kitchen",
                roomTypeLabel: "Kitchen",
                promptContext: "New kitchen prompt",
            },
        ],
    });

    const kitchenPrompt = resolvePromptProfileContext({
        profiles: merged,
        roomTypeKey: "kitchen",
    });
    const livingPrompt = resolvePromptProfileContext({
        profiles: merged,
        roomTypeKey: "living_room",
    });

    assert.equal(kitchenPrompt, "New kitchen prompt");
    assert.equal(livingPrompt, "Living room prompt");
});

test("parsePropertyImagePromptProfileUpsertsJson rejects malformed rows and keeps valid upserts", () => {
    const parsed = parsePropertyImagePromptProfileUpsertsJson(JSON.stringify([
        {
            roomTypeKey: "garage",
            roomTypeLabel: "Garage",
            promptContext: "Keep concrete texture and natural shadows.",
        },
        {
            roomTypeKey: "",
            roomTypeLabel: "",
            promptContext: "",
        },
    ]));

    assert.equal(parsed.length, 1);
    assert.equal(parsed[0]?.roomTypeKey, "garage");
});
