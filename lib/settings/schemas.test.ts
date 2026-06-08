import assert from "node:assert/strict";
import test from "node:test";
import { GEMINI_FLASH_LATEST_ALIAS, GEMINI_FLASH_STABLE_FALLBACK } from "@/lib/ai/models";
import { SETTINGS_DOMAINS } from "./constants";
import { validateSettingsPayload } from "./schemas";

test("location AI settings schema fills defaults for legacy payloads", () => {
    const payload = validateSettingsPayload(SETTINGS_DOMAINS.LOCATION_AI, {
        googleAiModel: GEMINI_FLASH_LATEST_ALIAS,
        googleAiModelExtraction: GEMINI_FLASH_LATEST_ALIAS,
        googleAiModelDesign: GEMINI_FLASH_LATEST_ALIAS,
        googleAiModelTranscription: GEMINI_FLASH_STABLE_FALLBACK,
        defaultReplyLanguage: "en",
        precisionRemoveEnabled: false,
        brandVoice: null,
        automationConfig: {},
        contactProfileVerification: {},
        whatsappTranscriptOnDemandEnabled: false,
        whatsappTranscriptRetentionDays: 90,
        whatsappTranscriptVisibility: "team",
        viewingSessionRetentionDays: 90,
        viewingSessionTranscriptVisibility: "team",
        viewingSessionAiDisclosureRequired: true,
        viewingSessionAiDisclosureVersion: "v1",
        viewingSessionRawAudioStorageEnabled: false,
        viewingSessionTranslationModel: null,
        viewingSessionInsightsModel: null,
        viewingSessionSummaryModel: null,
    }) as any;

    assert.equal(payload.googleAiModelTranslation, GEMINI_FLASH_LATEST_ALIAS);
    assert.equal(payload.requirementsIntelligence.mode, "manual_only");
    assert.equal(payload.requirementsIntelligence.model, GEMINI_FLASH_LATEST_ALIAS);
    assert.deepEqual(payload.requirementsIntelligence.allowedPropertyDomains, []);
});
