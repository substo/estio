import assert from "node:assert/strict";
import test from "node:test";

import {
    buildContactRequirementGuide,
    enforceMapSharingInstruction,
    estimateDraftGenerationCost,
    isOpenAiDraftModel,
    looksLikeSendReadyDraftInstruction,
    resolveDraftChannelName,
    stripUngroundedMapUrls,
} from "./coordinator";

test("buildContactRequirementGuide includes non-empty requirement guidance", () => {
    const guide = buildContactRequirementGuide({
        leadGoal: "To Rent",
        requirementStatus: "For Rent",
        requirementDistrict: "Limassol",
        requirementBedrooms: "2",
        requirementMinPrice: "1000",
        requirementMaxPrice: "1600",
        requirementPropertyTypes: ["Apartment", "Penthouse"],
        requirementPropertyLocations: ["Germasogeia", "Neapolis"],
        requirementOtherDetails: "Needs parking.",
        requirementSummary: "Prefers modern buildings near the sea.",
    });

    assert.match(guide, /Client requirement guide:/);
    assert.match(guide, /Lead goal: To Rent/);
    assert.match(guide, /Locations: Germasogeia, Neapolis/);
    assert.match(guide, /Budget: 1000 - 1600/);
    assert.match(guide, /Other details: Needs parking/);
    assert.match(guide, /Use this as relevance guidance/);
});

test("buildContactRequirementGuide omits empty requirement values", () => {
    const guide = buildContactRequirementGuide({
        requirementDistrict: "",
        requirementPropertyTypes: [],
        requirementMaxPrice: "500000",
    });

    assert.doesNotMatch(guide, /District:/);
    assert.doesNotMatch(guide, /Property types:/);
    assert.match(guide, /Budget: Any - 500000/);
});

test("buildContactRequirementGuide handles contacts without recorded requirements", () => {
    assert.equal(
        buildContactRequirementGuide({}),
        "Client requirement guide: No approved requirements recorded."
    );
});

test("stripUngroundedMapUrls removes hallucinated map shortlinks", () => {
    const draft = [
        "Here is the location link for the Tala apartment:",
        "",
        "https://maps.app.goo.gl/uPkaY4Xv7Q9i2pD86",
        "",
        "Let me know if you would like to arrange a viewing.",
    ].join("\n");

    const cleaned = stripUngroundedMapUrls(
        draft,
        "Context: https://www.downtowncyprus.com/properties/apartment-for-sale-in-tala-paphos-ref-dt4145"
    );

    assert.doesNotMatch(cleaned, /maps\.app\.goo\.gl/);
    assert.doesNotMatch(cleaned, /Here is the location link/);
    assert.match(cleaned, /arrange a viewing/);
});

test("stripUngroundedMapUrls keeps map links that were present in context", () => {
    const mapUrl = "https://maps.app.goo.gl/6mx86RZZZLyK5mUr5?g_st=aw";
    const draft = `Here is the map link:\n${mapUrl}`;

    assert.equal(
        stripUngroundedMapUrls(draft, `Internal notes include ${mapUrl}`),
        draft
    );
});

test("enforceMapSharingInstruction removes map links when procedure gates sharing until viewing", () => {
    const mapUrl = "https://maps.app.goo.gl/6mx86RZZZLyK5mUr5?g_st=aw";
    const draft = [
        "Due to internal procedures, we can only share the map URL once the viewing is arranged.",
        mapUrl,
        "I can arrange a viewing and show you the exact location in person.",
    ].join("\n");

    const cleaned = enforceMapSharingInstruction(
        draft,
        "Say due to internal procedures we cannot share maps url before the viewing is arranged."
    );

    assert.doesNotMatch(cleaned, /maps\.app\.goo\.gl/);
    assert.match(cleaned, /viewing is arranged/);
});

test("looksLikeSendReadyDraftInstruction distinguishes operator drafts from commands", () => {
    assert.equal(
        looksLikeSendReadyDraftInstruction(
            "Hi Myrto. Sorry for the late reply.\n\nThe tender deadline is 10:00 AM every Tuesday. Please let me know if you are still searching."
        ),
        true
    );

    assert.equal(
        looksLikeSendReadyDraftInstruction("Make it shorter and friendlier, but keep the details."),
        false
    );
});

test("isOpenAiDraftModel only matches OpenAI-prefixed model selections", () => {
    assert.equal(isOpenAiDraftModel("openai:gpt-4o-mini"), true);
    assert.equal(isOpenAiDraftModel(" gpt-4o-mini "), false);
    assert.equal(isOpenAiDraftModel("gemini-flash-latest"), false);
});

test("resolveDraftChannelName lets explicit composer channel override conversation metadata", () => {
    assert.equal(resolveDraftChannelName({
        selectedChannel: "WhatsApp",
        conversationType: "TYPE_EMAIL",
    }), "WhatsApp");
    assert.equal(resolveDraftChannelName({
        selectedChannel: "Email",
        conversationType: "TYPE_WHATSAPP",
    }), "Email");
    assert.equal(resolveDraftChannelName({
        selectedChannel: "SMS_RELAY",
        conversationType: "TYPE_EMAIL",
    }), "SMS");
    assert.equal(resolveDraftChannelName({
        conversationType: "TYPE_EMAIL",
    }), "Email");
});

test("estimateDraftGenerationCost does not apply Gemini pricing to OpenAI drafts", () => {
    const estimate = estimateDraftGenerationCost({
        provider: "openai",
        model: "openai:gpt-4o-mini",
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
    });

    assert.equal(estimate.amount, 0);
    assert.equal(estimate.provider, "openai");
    assert.equal(estimate.method, "provider_pricing_unavailable");
    assert.match(estimate.note || "", /not available from an official dynamic API/);
});

test("estimateDraftGenerationCost still prices Gemini drafts", () => {
    const estimate = estimateDraftGenerationCost({
        provider: "google_gemini",
        model: "gemini-2.5-flash-lite",
        promptTokens: 1_000_000,
        completionTokens: 1_000_000,
        totalTokens: 2_000_000,
    });

    assert.equal(estimate.amount, 0.5);
    assert.equal(estimate.method, "prompt_completion_only");
});
