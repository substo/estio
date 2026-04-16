import db from "@/lib/db";
import { AiSettingsForm } from "./ai-settings-form";
import { cookies } from "next/headers";
import { DEFAULT_REPLY_LANGUAGE } from "@/lib/ai/reply-language-options";
import { getLocationContext } from "@/lib/auth/location-context";
import { settingsService } from "@/lib/settings/service";
import {
    SETTINGS_DOMAINS,
    SETTINGS_SECRET_KEYS,
    isSettingsReadFromNewEnabled,
} from "@/lib/settings/constants";
import { ensureDefaultSkillPolicies } from "@/lib/ai/runtime/engine";
import { isPrecisionRemoveInfrastructureReady } from "@/lib/ai/property-image-precision-remove-config";

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
        (async () => {
            try {
                await ensureDefaultSkillPolicies(locationId);
                const [
                    totalPolicies,
                    enabledPolicies,
                    nextJob,
                    pendingRuntimeJobs,
                    deadRuntimeJobs,
                    pendingSuggestions,
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
                return {
                    totalPolicies: 0,
                    enabledPolicies: 0,
                    nextRunAt: null,
                    pendingJobs: 0,
                    deadJobs: 0,
                    pendingSuggestions: 0,
                    policies: [],
                    recentDecisions: [],
                    recentJobs: [],
                };
            }
        })(),
    ]);

    const initialData = isSettingsReadFromNewEnabled() && aiDoc
        ? {
            ...aiDoc.payload,
            // keep compatibility for old optional reads
            googleAiModel: aiDoc.payload?.googleAiModel || siteConfig?.googleAiModel,
            googleAiModelExtraction: aiDoc.payload?.googleAiModelExtraction || siteConfig?.googleAiModelExtraction,
            googleAiModelDesign: aiDoc.payload?.googleAiModelDesign || siteConfig?.googleAiModelDesign,
            googleAiModelTranscription: aiDoc.payload?.googleAiModelTranscription || siteConfig?.googleAiModelTranscription,
            defaultReplyLanguage: aiDoc.payload?.defaultReplyLanguage || DEFAULT_REPLY_LANGUAGE,
            precisionRemoveEnabled: aiDoc.payload?.precisionRemoveEnabled === true,
            brandVoice: aiDoc.payload?.brandVoice || siteConfig?.brandVoice,
            outreachConfig: aiDoc.payload?.outreachConfig || siteConfig?.outreachConfig,
            whatsappTranscriptOnDemandEnabled: aiDoc.payload?.whatsappTranscriptOnDemandEnabled ?? siteConfig?.whatsappTranscriptOnDemandEnabled,
            whatsappTranscriptRetentionDays: aiDoc.payload?.whatsappTranscriptRetentionDays ?? siteConfig?.whatsappTranscriptRetentionDays,
            whatsappTranscriptVisibility: aiDoc.payload?.whatsappTranscriptVisibility ?? siteConfig?.whatsappTranscriptVisibility,
            viewingSessionRetentionDays: aiDoc.payload?.viewingSessionRetentionDays ?? siteConfig?.viewingSessionRetentionDays,
            viewingSessionTranscriptVisibility: aiDoc.payload?.viewingSessionTranscriptVisibility ?? siteConfig?.viewingSessionTranscriptVisibility,
            viewingSessionAiDisclosureRequired: aiDoc.payload?.viewingSessionAiDisclosureRequired ?? siteConfig?.viewingSessionAiDisclosureRequired,
            viewingSessionAiDisclosureVersion: aiDoc.payload?.viewingSessionAiDisclosureVersion ?? siteConfig?.viewingSessionAiDisclosureVersion,
            viewingSessionRawAudioStorageEnabled: aiDoc.payload?.viewingSessionRawAudioStorageEnabled ?? siteConfig?.viewingSessionRawAudioStorageEnabled,
            viewingSessionTranslationModel: aiDoc.payload?.viewingSessionTranslationModel ?? siteConfig?.viewingSessionTranslationModel,
            viewingSessionInsightsModel: aiDoc.payload?.viewingSessionInsightsModel ?? siteConfig?.viewingSessionInsightsModel,
            viewingSessionSummaryModel: aiDoc.payload?.viewingSessionSummaryModel ?? siteConfig?.viewingSessionSummaryModel,
        }
        : {
            ...siteConfig,
            defaultReplyLanguage: DEFAULT_REPLY_LANGUAGE,
            precisionRemoveEnabled: aiDoc?.payload?.precisionRemoveEnabled === true,
        };

    const settingsVersion = aiDoc?.version ?? 0;

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
                    runtimeSummary={runtimeSummary}
                />
            </div>
        </div>
    );
}
