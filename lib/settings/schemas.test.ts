import assert from "node:assert/strict";
import test from "node:test";
import { GEMINI_FLASH_LITE_LATEST_ALIAS, GEMINI_FLASH_LATEST_ALIAS, GEMINI_FLASH_STABLE_FALLBACK } from "@/lib/ai/models";
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

    assert.equal(payload.googleAiModelTranslation, GEMINI_FLASH_LITE_LATEST_ALIAS);
    assert.equal(payload.googleAiModelDraft, GEMINI_FLASH_LATEST_ALIAS);
    assert.equal(payload.requirementsIntelligence.mode, "manual_only");
    assert.equal(payload.requirementsIntelligence.model, GEMINI_FLASH_LATEST_ALIAS);
    assert.deepEqual(payload.requirementsIntelligence.allowedPropertyDomains, []);
});

test("location AI settings schema accepts running contact classification progress", () => {
    const payload = validateSettingsPayload(SETTINGS_DOMAINS.LOCATION_AI, {
        googleAiModel: GEMINI_FLASH_LATEST_ALIAS,
        googleAiModelExtraction: GEMINI_FLASH_LATEST_ALIAS,
        googleAiModelDesign: GEMINI_FLASH_LATEST_ALIAS,
        googleAiModelTranscription: GEMINI_FLASH_STABLE_FALLBACK,
        googleAiModelTranslation: GEMINI_FLASH_LATEST_ALIAS,
        defaultReplyLanguage: "en",
        precisionRemoveEnabled: false,
        brandVoice: null,
        outreachConfig: {},
        automationConfig: {},
        requirementsIntelligence: {},
        contactProfileVerification: {
            lastRun: {
                status: "running",
                source: "manual",
                startedAt: "2026-06-08T19:00:00.000Z",
                finishedAt: null,
                durationMs: 1200,
                mode: "manual_only",
                batchSize: 5,
                currentContactId: "contact_123",
                stats: {
                    locationsChecked: 1,
                    checked: 1,
                    verified: 0,
                    proposals: 0,
                    skipped: 0,
                    failures: 0,
                    reprocessedCampaignBlocks: 0,
                },
            },
        },
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

    assert.equal(payload.contactProfileVerification.lastRun.status, "running");
    assert.equal(payload.contactProfileVerification.lastRun.finishedAt, null);
    assert.equal(payload.contactProfileVerification.lastRun.currentContactId, "contact_123");
});

test("user OpenAI settings schema defaults disabled personal integration", () => {
    const payload = validateSettingsPayload(SETTINGS_DOMAINS.USER_OPENAI_INTEGRATIONS, {}) as any;

    assert.equal(payload.enabled, false);
    assert.equal(payload.defaultTextModel, null);
});

test("user OpenAI settings schema trims preferred text model", () => {
    const payload = validateSettingsPayload(SETTINGS_DOMAINS.USER_OPENAI_INTEGRATIONS, {
        enabled: true,
        defaultTextModel: "  openai:gpt-4o-mini  ",
    }) as any;

    assert.equal(payload.enabled, true);
    assert.equal(payload.defaultTextModel, "openai:gpt-4o-mini");
});

test("user ChatGPT subscription settings schema trims preferred text model", () => {
    const payload = validateSettingsPayload(SETTINGS_DOMAINS.USER_CHATGPT_SUBSCRIPTION_INTEGRATIONS, {
        enabled: true,
        defaultTextModel: "  chatgpt_subscription:gpt-5.4-mini  ",
    }) as any;

    assert.equal(payload.enabled, true);
    assert.equal(payload.defaultTextModel, "chatgpt_subscription:gpt-5.4-mini");
});
