import db from "@/lib/db";
import { AiSettingsForm } from "./ai-settings-form";
import { cookies } from "next/headers";
import { DEFAULT_REPLY_LANGUAGE } from "@/lib/ai/reply-language-options";
import { GEMINI_FLASH_LITE_LATEST_ALIAS, GEMINI_FLASH_STABLE_FALLBACK } from "@/lib/ai/models";
import { getLocationContext } from "@/lib/auth/location-context";
import { settingsService } from "@/lib/settings/service";
import {
    SETTINGS_DOMAINS,
    SETTINGS_SECRET_KEYS,
    isSettingsReadFromNewEnabled,
} from "@/lib/settings/constants";
import { isPrecisionRemoveInfrastructureReady } from "@/lib/ai/property-image-precision-remove-config";
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

export default async function AiSettingsPage(props: { searchParams: Promise<{ locationId?: string }> }) {
    const searchParams = await props.searchParams;
    const cookieStore = await cookies();

    // Try to get location from Context Helper first (User Metadata/DB)
    const contextLocation = await getLocationContext();
    const locationId = searchParams.locationId ||
        contextLocation?.id ||
        cookieStore.get("crm_location_id")?.value;

    if (!locationId) {
        return <div>No location context found.</div>;
    }

    const [siteConfig, aiDoc, hasGoogleAiApiKey] = await Promise.all([
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

    return (
        <div className="p-6 max-w-4xl space-y-6">
            <div>
                <h1 className="text-2xl font-bold tracking-tight">AI Configuration</h1>
                <p className="text-muted-foreground">
                    Manage Gemini models, automation, and brand voice settings.
                </p>
            </div>

            <div className="border rounded-lg p-6 bg-card">
                <AiSettingsForm
                    initialData={initialData}
                    locationId={locationId}
                    settingsVersion={settingsVersion}
                    hasGoogleAiApiKey={hasGoogleAiApiKey || Boolean(siteConfig?.googleAiApiKey)}
                    precisionRemoveInfrastructureReady={isPrecisionRemoveInfrastructureReady()}
                    runtimeSummary={enrichedRuntimeSummary}
                />
            </div>
        </div>
    );
}
