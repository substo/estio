import db from "@/lib/db";
import { AiSettingsForm } from "./ai-settings-form";
import { redirect } from "next/navigation";
import { DEFAULT_REPLY_LANGUAGE } from "@/lib/ai/reply-language-options";
import { GEMINI_FLASH_LITE_LATEST_ALIAS, GEMINI_FLASH_STABLE_FALLBACK } from "@/lib/ai/models";
import { resolveIntegrationAdminContext } from "@/app/(main)/admin/settings/integrations/admin-context";
import { settingsService } from "@/lib/settings/service";
import {
    SETTINGS_DOMAINS,
    SETTINGS_SECRET_KEYS,
    isSettingsReadFromNewEnabled,
} from "@/lib/settings/constants";
import { normalizeContactProfileVerificationConfig } from "@/lib/ai/contact-profile-verification/config";
import { EMPTY_AI_RUNTIME_SUMMARY } from "@/lib/ai/settings/runtime-summary";

function getDefaultRequirementsIntelligence(model?: string | null) {
    return {
        mode: "manual_only",
        model: model || GEMINI_FLASH_STABLE_FALLBACK,
        allowedPropertyDomains: [],
        activityDebounceMinutes: 24 * 60,
        autoReprocessCampaignCandidates: true,
    };
}

function getDefaultContactProfileVerification(value?: unknown, model?: string | null) {
    const normalized = normalizeContactProfileVerificationConfig(value);
    const configuredModel = String((value as any)?.model || "").trim();
    return {
        ...normalized,
        model: configuredModel || model || normalized.model,
    };
}

function buildAiInitialData({
    aiDoc,
    siteConfig,
}: {
    aiDoc: any;
    siteConfig: any;
}) {
    const aiPayload = aiDoc?.payload;

    if (isSettingsReadFromNewEnabled() && aiDoc) {
        return {
            ...aiPayload,
            // keep compatibility for old optional reads
            googleAiModel: aiPayload?.googleAiModel || siteConfig?.googleAiModel,
            googleAiModelDraft: aiPayload?.googleAiModelDraft || aiPayload?.googleAiModel || siteConfig?.googleAiModel,
            googleAiModelExtraction: aiPayload?.googleAiModelExtraction || siteConfig?.googleAiModelExtraction,
            googleAiModelDesign: aiPayload?.googleAiModelDesign || siteConfig?.googleAiModelDesign,
            googleAiModelTranscription: aiPayload?.googleAiModelTranscription || siteConfig?.googleAiModelTranscription,
            googleAiModelTranslation: aiPayload?.googleAiModelTranslation || (siteConfig as any)?.googleAiModelTranslation || GEMINI_FLASH_LITE_LATEST_ALIAS,
            openAiTextModel: aiPayload?.openAiTextModel || null,
            defaultReplyLanguage: aiPayload?.defaultReplyLanguage || DEFAULT_REPLY_LANGUAGE,
            precisionRemoveEnabled: aiPayload?.precisionRemoveEnabled === true,
            brandVoice: aiPayload?.brandVoice || siteConfig?.brandVoice,
            outreachConfig: aiPayload?.outreachConfig || siteConfig?.outreachConfig,
            whatsappTranscriptOnDemandEnabled: aiPayload?.whatsappTranscriptOnDemandEnabled ?? siteConfig?.whatsappTranscriptOnDemandEnabled,
            whatsappTranscriptRetentionDays: aiPayload?.whatsappTranscriptRetentionDays ?? siteConfig?.whatsappTranscriptRetentionDays,
            whatsappTranscriptVisibility: aiPayload?.whatsappTranscriptVisibility ?? siteConfig?.whatsappTranscriptVisibility,
            viewingSessionRetentionDays: aiPayload?.viewingSessionRetentionDays ?? siteConfig?.viewingSessionRetentionDays,
            viewingSessionTranscriptVisibility: aiPayload?.viewingSessionTranscriptVisibility ?? siteConfig?.viewingSessionTranscriptVisibility,
            viewingSessionAiDisclosureRequired: aiPayload?.viewingSessionAiDisclosureRequired ?? siteConfig?.viewingSessionAiDisclosureRequired,
            viewingSessionAiDisclosureVersion: aiPayload?.viewingSessionAiDisclosureVersion ?? siteConfig?.viewingSessionAiDisclosureVersion,
            viewingSessionRawAudioStorageEnabled: aiPayload?.viewingSessionRawAudioStorageEnabled ?? siteConfig?.viewingSessionRawAudioStorageEnabled,
            viewingSessionTranslationModel: aiPayload?.viewingSessionTranslationModel ?? siteConfig?.viewingSessionTranslationModel,
            viewingSessionInsightsModel: aiPayload?.viewingSessionInsightsModel ?? siteConfig?.viewingSessionInsightsModel,
            viewingSessionSummaryModel: aiPayload?.viewingSessionSummaryModel ?? siteConfig?.viewingSessionSummaryModel,
            requirementsIntelligence: aiPayload?.requirementsIntelligence || getDefaultRequirementsIntelligence(
                aiPayload?.googleAiModelExtraction || siteConfig?.googleAiModelExtraction
            ),
            contactProfileVerification: getDefaultContactProfileVerification(
                aiPayload?.contactProfileVerification,
                aiPayload?.googleAiModelExtraction || siteConfig?.googleAiModelExtraction || aiPayload?.googleAiModel || siteConfig?.googleAiModel
            ),
        };
    }

    return {
        ...siteConfig,
        googleAiModelDraft: aiPayload?.googleAiModelDraft || siteConfig?.googleAiModel,
        googleAiModelTranslation: (siteConfig as any)?.googleAiModelTranslation || GEMINI_FLASH_LITE_LATEST_ALIAS,
        openAiTextModel: aiPayload?.openAiTextModel || null,
        defaultReplyLanguage: DEFAULT_REPLY_LANGUAGE,
        precisionRemoveEnabled: aiPayload?.precisionRemoveEnabled === true,
        requirementsIntelligence: aiPayload?.requirementsIntelligence || getDefaultRequirementsIntelligence(
            siteConfig?.googleAiModelExtraction
        ),
        contactProfileVerification: getDefaultContactProfileVerification(
            aiPayload?.contactProfileVerification,
            siteConfig?.googleAiModelExtraction || siteConfig?.googleAiModel
        ),
    };
}

export default async function AiSettingsPage() {
    let context: Awaited<ReturnType<typeof resolveIntegrationAdminContext>>;
    try {
        context = await resolveIntegrationAdminContext();
    } catch {
        redirect("/sign-in");
    }
    const locationId = context.locationId;

    const localUser = await db.user.findUnique({ where: { clerkId: context.userId }, select: { id: true } });
    const [siteConfig, aiDoc, hasGoogleAiApiKey, hasOpenAiApiKey, locationIntegrations, personalChatGpt, hasLocationAccessToken, hasLocationAuthCache, hasPersonalChatGptCredential] = await Promise.all([
        db.siteConfig.findUnique({
            where: { locationId },
        }),
        settingsService.getDocument<any>({
            scopeType: "LOCATION",
            scopeId: locationId,
            domain: SETTINGS_DOMAINS.LOCATION_AI,
        }),
        settingsService.hasSecret({
            scopeType: "LOCATION",
            scopeId: locationId,
            domain: SETTINGS_DOMAINS.LOCATION_AI,
            secretKey: SETTINGS_SECRET_KEYS.GOOGLE_AI_API_KEY,
        }).catch(() => false),
        settingsService.hasSecret({
            scopeType: "LOCATION",
            scopeId: locationId,
            domain: SETTINGS_DOMAINS.LOCATION_AI,
            secretKey: SETTINGS_SECRET_KEYS.OPENAI_API_KEY,
        }).catch(() => false),
        settingsService.getDocument<any>({
            scopeType: "LOCATION",
            scopeId: locationId,
            domain: SETTINGS_DOMAINS.LOCATION_INTEGRATIONS,
        }).catch(() => null),
        localUser?.id ? settingsService.getDocument<any>({
            scopeType: "USER",
            scopeId: localUser.id,
            domain: SETTINGS_DOMAINS.USER_CHATGPT_SUBSCRIPTION_INTEGRATIONS,
        }).catch(() => null) : Promise.resolve(null),
        settingsService.hasSecret({
            scopeType: "LOCATION",
            scopeId: locationId,
            domain: SETTINGS_DOMAINS.LOCATION_INTEGRATIONS,
            secretKey: SETTINGS_SECRET_KEYS.CHATGPT_CODEX_ACCESS_TOKEN,
        }).catch(() => false),
        settingsService.hasSecret({
            scopeType: "LOCATION",
            scopeId: locationId,
            domain: SETTINGS_DOMAINS.LOCATION_INTEGRATIONS,
            secretKey: SETTINGS_SECRET_KEYS.CHATGPT_CODEX_AUTH_CACHE,
        }).catch(() => false),
        localUser?.id ? settingsService.hasSecret({
            scopeType: "USER",
            scopeId: localUser.id,
            domain: SETTINGS_DOMAINS.USER_CHATGPT_SUBSCRIPTION_INTEGRATIONS,
            secretKey: SETTINGS_SECRET_KEYS.CHATGPT_CODEX_AUTH_CACHE,
        }).catch(() => false) : Promise.resolve(false),
    ]);

    const initialData = buildAiInitialData({ aiDoc, siteConfig });

    const settingsVersion = aiDoc?.version ?? 0;
    const enrichedRuntimeSummary = {
        ...EMPTY_AI_RUNTIME_SUMMARY,
        requirementsIntelligence: initialData?.requirementsIntelligence || {
            mode: "manual_only",
            model: GEMINI_FLASH_STABLE_FALLBACK,
            lastRun: null,
        },
        contactProfileVerification: initialData?.contactProfileVerification || getDefaultContactProfileVerification(
            null,
            initialData?.googleAiModelExtraction || initialData?.googleAiModel
        ),
    };
    const geminiConnected = hasGoogleAiApiKey || Boolean(siteConfig?.googleAiApiKey);
    const hasLocationChatGptCredential = hasLocationAccessToken || hasLocationAuthCache;
    const locationChatGptConnected = locationIntegrations?.payload?.chatGptSubscription?.enabled === true
        && locationIntegrations?.payload?.chatGptSubscription?.health === "connected"
        && hasLocationChatGptCredential;
    const personalChatGptConnected = personalChatGpt?.payload?.enabled === true
        && personalChatGpt?.payload?.health === "connected"
        && Boolean(personalChatGpt?.payload?.verifiedAt)
        && hasPersonalChatGptCredential;
    const configuredPrimaryModel = String(initialData?.googleAiModel || "").trim();
    const primaryProvider = configuredPrimaryModel.startsWith("openai:")
        ? "OpenAI API"
        : configuredPrimaryModel.startsWith("chatgpt_subscription:")
            ? "ChatGPT subscription (Codex)"
            : geminiConnected
                ? "Google Gemini"
                : hasOpenAiApiKey
                    ? "OpenAI API"
                    : locationChatGptConnected
                        ? "ChatGPT subscription (Codex)"
                        : "Not configured";
    const fallbackProvider = primaryProvider !== "Google Gemini" && geminiConnected
        ? "Google Gemini"
        : primaryProvider !== "OpenAI API" && hasOpenAiApiKey
            ? "OpenAI API"
            : primaryProvider !== "ChatGPT subscription (Codex)" && locationChatGptConnected
                ? "ChatGPT subscription (Codex)"
                : "None";

    return (
        <div className="p-6 max-w-4xl space-y-6">
            <div>
                <h1 className="text-2xl font-bold tracking-tight">AI Configuration</h1>
                <p className="text-muted-foreground">
                    Manage default models, automation, and brand voice settings across connected AI providers.
                </p>
            </div>

            <div className="border rounded-lg p-6 bg-card">
                <AiSettingsForm
                    initialData={initialData}
                    locationId={locationId}
                    settingsVersion={settingsVersion}
                    hasGoogleAiApiKey={hasGoogleAiApiKey || Boolean(siteConfig?.googleAiApiKey)}
                    connectionSummary={{
                        primaryProvider,
                        fallbackProvider,
                        gemini: geminiConnected,
                        openAi: hasOpenAiApiKey,
                        locationChatGpt: locationChatGptConnected,
                        personalChatGpt: personalChatGptConnected,
                    }}
                    runtimeSummary={enrichedRuntimeSummary}
                />
            </div>
        </div>
    );
}
