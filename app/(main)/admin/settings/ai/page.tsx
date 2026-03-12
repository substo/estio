import db from "@/lib/db";
import { AiSettingsForm } from "./ai-settings-form";
import { cookies } from "next/headers";
import { getLocationContext } from "@/lib/auth/location-context";
import { settingsService } from "@/lib/settings/service";
import {
    SETTINGS_DOMAINS,
    SETTINGS_SECRET_KEYS,
    isSettingsReadFromNewEnabled,
} from "@/lib/settings/constants";

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

    const [siteConfig, aiDoc, hasGoogleAiApiKey, automationSummary] = await Promise.all([
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
                const [
                    totalSchedules,
                    enabledSchedules,
                    nextSchedule,
                    pendingJobs,
                    deadJobs,
                    pendingSuggestions,
                ] = await Promise.all([
                    db.aiAutomationSchedule.count({
                        where: { locationId },
                    }),
                    db.aiAutomationSchedule.count({
                        where: { locationId, enabled: true },
                    }),
                    db.aiAutomationSchedule.findFirst({
                        where: {
                            locationId,
                            enabled: true,
                            nextRunAt: { not: null },
                        },
                        orderBy: { nextRunAt: "asc" },
                        select: { nextRunAt: true },
                    }),
                    db.aiAutomationJob.count({
                        where: {
                            locationId,
                            status: "pending",
                        },
                    }),
                    db.aiAutomationJob.count({
                        where: {
                            locationId,
                            status: "dead",
                        },
                    }),
                    db.aiSuggestedResponse.count({
                        where: {
                            locationId,
                            status: "pending",
                            source: { startsWith: "automation:" },
                        },
                    }),
                ]);

                return {
                    totalSchedules,
                    enabledSchedules,
                    nextRunAt: nextSchedule?.nextRunAt ? nextSchedule.nextRunAt.toISOString() : null,
                    pendingJobs,
                    deadJobs,
                    pendingSuggestions,
                };
            } catch (error) {
                console.warn("[AiSettingsPage] Failed to load automation summary:", error);
                return {
                    totalSchedules: 0,
                    enabledSchedules: 0,
                    nextRunAt: null,
                    pendingJobs: 0,
                    deadJobs: 0,
                    pendingSuggestions: 0,
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
            brandVoice: aiDoc.payload?.brandVoice || siteConfig?.brandVoice,
            outreachConfig: aiDoc.payload?.outreachConfig || siteConfig?.outreachConfig,
            whatsappTranscriptOnDemandEnabled: aiDoc.payload?.whatsappTranscriptOnDemandEnabled ?? siteConfig?.whatsappTranscriptOnDemandEnabled,
            whatsappTranscriptRetentionDays: aiDoc.payload?.whatsappTranscriptRetentionDays ?? siteConfig?.whatsappTranscriptRetentionDays,
            whatsappTranscriptVisibility: aiDoc.payload?.whatsappTranscriptVisibility ?? siteConfig?.whatsappTranscriptVisibility,
        }
        : siteConfig;

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
                    automationSummary={automationSummary}
                />
            </div>
        </div>
    );
}
