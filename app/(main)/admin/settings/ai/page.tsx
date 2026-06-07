import db from "@/lib/db";
import { AiSettingsForm } from "./ai-settings-form";
import { cookies } from "next/headers";
import { DEFAULT_REPLY_LANGUAGE } from "@/lib/ai/reply-language-options";
import { GEMINI_FLASH_LATEST_ALIAS, GEMINI_FLASH_STABLE_FALLBACK } from "@/lib/ai/models";
import { getLocationContext } from "@/lib/auth/location-context";
import { settingsService } from "@/lib/settings/service";
import {
    SETTINGS_DOMAINS,
    SETTINGS_SECRET_KEYS,
    isSettingsReadFromNewEnabled,
} from "@/lib/settings/constants";
import { ensureDefaultSkillPolicies } from "@/lib/ai/runtime/engine";
import { isPrecisionRemoveInfrastructureReady } from "@/lib/ai/property-image-precision-remove-config";

const EMPTY_AI_RUNTIME_SUMMARY = {
    totalPolicies: 0,
    enabledPolicies: 0,
    nextRunAt: null,
    pendingJobs: 0,
    deadJobs: 0,
    pendingSuggestions: 0,
    pendingRequirementProposals: 0,
    policies: [],
    recentDecisions: [],
    recentJobs: [],
};

async function loadAiRuntimeSummary(locationId: string) {
    try {
        await ensureDefaultSkillPolicies(locationId);
        const [
            totalPolicies,
            enabledPolicies,
            nextJob,
            pendingRuntimeJobs,
            deadRuntimeJobs,
            pendingSuggestions,
            pendingRequirementProposals,
            policies,
            recentDecisions,
            recentRuntimeJobs,
        ] = await Promise.all([
            db.aiSkillPolicy.count({
                where: { locationId },
            }),
            db.aiSkillPolicy.count({
                where: { locationId, enabled: true },
            }),
            db.aiRuntimeJob.findFirst({
                where: {
                    locationId,
                    status: "pending",
                },
                orderBy: { scheduledAt: "asc" },
                select: { scheduledAt: true },
            }),
            db.aiRuntimeJob.count({
                where: {
                    locationId,
                    status: "pending",
                },
            }),
            db.aiRuntimeJob.count({
                where: {
                    locationId,
                    status: "dead",
                },
            }),
            db.aiSuggestedResponse.count({
                where: {
                    locationId,
                    status: "pending",
                    source: { contains: "skill:" },
                },
            }),
            db.contactRequirementProposal.count({
                where: {
                    locationId,
                    status: "pending",
                },
            }),
            db.aiSkillPolicy.findMany({
                where: { locationId },
                orderBy: [{ enabled: "desc" }, { objective: "asc" }, { skillId: "asc" }],
                select: {
                    id: true,
                    skillId: true,
                    objective: true,
                    enabled: true,
                    version: true,
                    decisionPolicy: true,
                    channelPolicy: true,
                    compliancePolicy: true,
                    updatedAt: true,
                },
                take: 80,
            }),
            db.aiDecision.findMany({
                where: { locationId },
                orderBy: { createdAt: "desc" },
                select: {
                    id: true,
                    selectedSkillId: true,
                    selectedObjective: true,
                    selectedScore: true,
                    status: true,
                    source: true,
                    holdReason: true,
                    traceId: true,
                    createdAt: true,
                },
                take: 40,
            }),
            db.aiRuntimeJob.findMany({
                where: { locationId },
                orderBy: { createdAt: "desc" },
                select: {
                    id: true,
                    status: true,
                    attemptCount: true,
                    maxAttempts: true,
                    scheduledAt: true,
                    processedAt: true,
                    traceId: true,
                    lastError: true,
                    decision: {
                        select: {
                            selectedSkillId: true,
                            selectedObjective: true,
                        },
                    },
                    createdAt: true,
                },
                take: 30,
            }),
        ]);

        return {
            totalPolicies,
            enabledPolicies,
            nextRunAt: nextJob?.scheduledAt ? nextJob.scheduledAt.toISOString() : null,
            pendingJobs: pendingRuntimeJobs,
            deadJobs: deadRuntimeJobs,
            pendingSuggestions,
            pendingRequirementProposals,
            policies: policies.map((item) => ({
                id: item.id,
                skillId: item.skillId,
                objective: item.objective,
                enabled: item.enabled,
                version: item.version,
                decisionPolicy: item.decisionPolicy || {},
                channelPolicy: item.channelPolicy || {},
                compliancePolicy: item.compliancePolicy || {},
                updatedAt: item.updatedAt.toISOString(),
            })),
            recentDecisions: recentDecisions.map((item) => ({
                id: item.id,
                selectedSkillId: item.selectedSkillId || null,
                selectedObjective: item.selectedObjective || null,
                selectedScore: item.selectedScore || null,
                status: item.status,
                source: item.source,
                holdReason: item.holdReason || null,
                traceId: item.traceId || null,
                createdAt: item.createdAt.toISOString(),
            })),
            recentJobs: recentRuntimeJobs.map((item) => ({
                id: item.id,
                selectedSkillId: item.decision?.selectedSkillId || null,
                selectedObjective: item.decision?.selectedObjective || null,
                status: item.status,
                attemptCount: item.attemptCount,
                maxAttempts: item.maxAttempts,
                scheduledAt: item.scheduledAt.toISOString(),
                processedAt: item.processedAt ? item.processedAt.toISOString() : null,
                traceId: item.traceId || null,
                lastError: item.lastError || null,
                createdAt: item.createdAt.toISOString(),
            })),
        };
    } catch (error) {
        console.warn("[AiSettingsPage] Failed to load automation summary:", error);
        return EMPTY_AI_RUNTIME_SUMMARY;
    }
}

function getDefaultRequirementsIntelligence(model?: string | null) {
    return {
        mode: "manual_only",
        model: model || GEMINI_FLASH_STABLE_FALLBACK,
        allowedPropertyDomains: [],
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
            googleAiModelTranslation: aiPayload?.googleAiModelTranslation || (siteConfig as any)?.googleAiModelTranslation || GEMINI_FLASH_LATEST_ALIAS,
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
        };
    }

    return {
        ...siteConfig,
        googleAiModelTranslation: (siteConfig as any)?.googleAiModelTranslation || GEMINI_FLASH_LATEST_ALIAS,
        defaultReplyLanguage: DEFAULT_REPLY_LANGUAGE,
        precisionRemoveEnabled: aiPayload?.precisionRemoveEnabled === true,
        requirementsIntelligence: aiPayload?.requirementsIntelligence || getDefaultRequirementsIntelligence(
            siteConfig?.googleAiModelExtraction
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

    const [siteConfig, aiDoc, hasGoogleAiApiKey, runtimeSummary] = await Promise.all([
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
        loadAiRuntimeSummary(locationId),
    ]);

    const initialData = buildAiInitialData({ aiDoc, siteConfig });

    const settingsVersion = aiDoc?.version ?? 0;
    const enrichedRuntimeSummary = {
        ...runtimeSummary,
        requirementsIntelligence: initialData?.requirementsIntelligence || {
            mode: "manual_only",
            model: GEMINI_FLASH_STABLE_FALLBACK,
            lastRun: null,
        },
    };

    return (
        <div className="p-6 max-w-4xl space-y-6">
            <div>
                <h1 className="text-2xl font-bold tracking-tight">AI Configuration</h1>
                <p className="text-muted-foreground">
                    Manage AI models, API keys, and brand voice settings.
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
