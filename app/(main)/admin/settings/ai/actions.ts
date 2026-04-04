"use server";

import db from "@/lib/db";
import { auth } from "@clerk/nextjs/server";
import { verifyUserIsLocationAdmin } from "@/lib/auth/permissions";
import { revalidatePath } from "next/cache";
import { GEMINI_FLASH_LATEST_ALIAS, GEMINI_FLASH_STABLE_FALLBACK } from "@/lib/ai/models";
import {
    listAiDecisions,
    listAiRuntimeJobs,
    listSkillPolicies,
    runAiRuntimeNow,
    simulateSkillDecision,
    updateAiAutomationConfig,
    upsertSkillPolicy,
} from "@/app/(main)/admin/conversations/actions";
import { settingsService } from "@/lib/settings/service";
import {
    SETTINGS_DOMAINS,
    SETTINGS_SECRET_KEYS,
    isSettingsDualWriteLegacyEnabled,
    isSettingsParityCheckEnabled,
} from "@/lib/settings/constants";
import { SettingsVersionConflictError } from "@/lib/settings/errors";

interface AiSettingsState {
    message?: string;
    version?: number;
    errors?: {
        _version?: string[];
        _form?: string[];
    };
}

type RunAiAutomationNowResult = {
    success: boolean;
    error?: string;
    stats?: any;
};

type UpdateAiAutomationConfigResult = Awaited<ReturnType<typeof updateAiAutomationConfig>>;

function normalizeTranscriptionModel(value: unknown): string {
    const normalized = String(value || "").trim();
    if (!normalized) return GEMINI_FLASH_STABLE_FALLBACK;

    const lower = normalized.toLowerCase();
    const disallowed = ["embedding", "image", "robotics"];
    const looksAudioCapable =
        lower.includes("gemini")
        && lower.includes("flash")
        && !disallowed.some((token) => lower.includes(token));

    return looksAudioCapable ? normalized : GEMINI_FLASH_STABLE_FALLBACK;
}

function normalizeTranscriptRetentionDays(value: unknown): number {
    const numeric = Number(value);
    if (numeric === 30 || numeric === 90 || numeric === 365) return numeric;
    return 90;
}

function normalizeTranscriptVisibility(value: unknown): "team" | "admin_only" {
    const normalized = String(value || "").trim().toLowerCase();
    return normalized === "admin_only" ? "admin_only" : "team";
}

function normalizeOptionalModelOverride(value: unknown): string | null {
    const normalized = String(value || "").trim();
    return normalized || null;
}

export async function updateAiSettings(
    prevState: AiSettingsState,
    formData: FormData
): Promise<AiSettingsState> {
    const { userId } = await auth();
    if (!userId) return { message: "Unauthorized" };

    const locationId = formData.get("locationId") as string;
    if (!locationId) {
        return { message: "Location ID is missing" };
    }

    const isAdmin = await verifyUserIsLocationAdmin(userId, locationId);
    if (!isAdmin) {
        return { message: "Unauthorized: Admin access is required to update settings." };
    }

    try {
        const localUser = await db.user.findUnique({
            where: { clerkId: userId },
            select: { id: true },
        });
        const existingAiDoc = await settingsService.getDocument<any>({
            scopeType: "LOCATION",
            scopeId: locationId,
            domain: SETTINGS_DOMAINS.LOCATION_AI,
        });
        const existingPayload = (existingAiDoc?.payload && typeof existingAiDoc.payload === "object")
            ? existingAiDoc.payload
            : {};
        const expectedVersionRaw = (formData.get("settingsVersion") as string | null)?.trim();
        const expectedVersionCandidate = expectedVersionRaw ? Number(expectedVersionRaw) : null;
        const expectedVersion = Number.isFinite(expectedVersionCandidate) ? expectedVersionCandidate : null;

        const transcriptionModel = normalizeTranscriptionModel(formData.get("googleAiModelTranscription"));
        const transcriptOnDemandEnabled = formData.get("whatsappTranscriptOnDemandEnabled") === "on";
        const transcriptRetentionDays = normalizeTranscriptRetentionDays(formData.get("whatsappTranscriptRetentionDays"));
        const transcriptVisibility = normalizeTranscriptVisibility(formData.get("whatsappTranscriptVisibility"));
        const viewingSessionRetentionDays = normalizeTranscriptRetentionDays(formData.get("viewingSessionRetentionDays"));
        const viewingSessionTranscriptVisibility = normalizeTranscriptVisibility(formData.get("viewingSessionTranscriptVisibility"));
        const viewingSessionAiDisclosureRequired = formData.get("viewingSessionAiDisclosureRequired") === "on";
        const viewingSessionAiDisclosureVersion = String(formData.get("viewingSessionAiDisclosureVersion") || "").trim() || "v1";
        const viewingSessionRawAudioStorageEnabled = formData.get("viewingSessionRawAudioStorageEnabled") === "on";
        const viewingSessionTranslationModel = normalizeOptionalModelOverride(formData.get("viewingSessionTranslationModel"));
        const viewingSessionInsightsModel = normalizeOptionalModelOverride(formData.get("viewingSessionInsightsModel"));
        const viewingSessionSummaryModel = normalizeOptionalModelOverride(formData.get("viewingSessionSummaryModel"));
        const payload = {
            ...existingPayload,
            googleAiModel: formData.get("googleAiModel") as string || GEMINI_FLASH_LATEST_ALIAS,
            googleAiModelExtraction: formData.get("googleAiModelExtraction") as string || GEMINI_FLASH_LATEST_ALIAS,
            googleAiModelDesign: formData.get("googleAiModelDesign") as string || GEMINI_FLASH_LATEST_ALIAS,
            googleAiModelTranscription: transcriptionModel,
            precisionRemoveEnabled: formData.get("precisionRemoveEnabled") === "on",
            whatsappTranscriptOnDemandEnabled: transcriptOnDemandEnabled,
            whatsappTranscriptRetentionDays: transcriptRetentionDays,
            whatsappTranscriptVisibility: transcriptVisibility,
            viewingSessionRetentionDays,
            viewingSessionTranscriptVisibility,
            viewingSessionAiDisclosureRequired,
            viewingSessionAiDisclosureVersion,
            viewingSessionRawAudioStorageEnabled,
            viewingSessionTranslationModel,
            viewingSessionInsightsModel,
            viewingSessionSummaryModel,
            brandVoice: formData.get("brandVoice") as string,
            outreachConfig: {
                enabled: formData.get("outreachEnabled") === "on",
                visionIdPrompt: formData.get("visionIdPrompt") as string,
                icebreakerPrompt: formData.get("icebreakerPrompt") as string,
                qualifierPrompt: formData.get("qualifierPrompt") as string,
            },
            automationConfig: (existingPayload as any)?.automationConfig,
        };

        const savedDoc = await settingsService.upsertDocument({
            scopeType: "LOCATION",
            scopeId: locationId,
            domain: SETTINGS_DOMAINS.LOCATION_AI,
            payload,
            expectedVersion,
            actorUserId: localUser?.id,
            schemaVersion: 1,
        });

        const clearGoogleAiApiKey = formData.get("clearGoogleAiApiKey") === "on";
        const googleAiApiKey = String(formData.get("googleAiApiKey") || "").trim();
        let legacySecretAction: "keep" | "clear" | "set" = "keep";

        if (clearGoogleAiApiKey) {
            await settingsService.clearSecret({
                scopeType: "LOCATION",
                scopeId: locationId,
                domain: SETTINGS_DOMAINS.LOCATION_AI,
                secretKey: SETTINGS_SECRET_KEYS.GOOGLE_AI_API_KEY,
                actorUserId: localUser?.id,
            });
            legacySecretAction = "clear";
        } else if (googleAiApiKey) {
            await settingsService.setSecret({
                scopeType: "LOCATION",
                scopeId: locationId,
                domain: SETTINGS_DOMAINS.LOCATION_AI,
                secretKey: SETTINGS_SECRET_KEYS.GOOGLE_AI_API_KEY,
                plaintext: googleAiApiKey,
                actorUserId: localUser?.id,
            });
            legacySecretAction = "set";
        }

        if (isSettingsDualWriteLegacyEnabled()) {
            await db.siteConfig.upsert({
                where: { locationId },
                create: {
                    locationId,
                    googleAiApiKey: legacySecretAction === "set" ? googleAiApiKey : null,
                    googleAiModel: payload.googleAiModel,
                    googleAiModelExtraction: payload.googleAiModelExtraction,
                    googleAiModelDesign: payload.googleAiModelDesign,
                    googleAiModelTranscription: payload.googleAiModelTranscription,
                    whatsappTranscriptOnDemandEnabled: payload.whatsappTranscriptOnDemandEnabled,
                    whatsappTranscriptRetentionDays: payload.whatsappTranscriptRetentionDays,
                    whatsappTranscriptVisibility: payload.whatsappTranscriptVisibility,
                    viewingSessionRetentionDays: payload.viewingSessionRetentionDays,
                    viewingSessionTranscriptVisibility: payload.viewingSessionTranscriptVisibility,
                    viewingSessionAiDisclosureRequired: payload.viewingSessionAiDisclosureRequired,
                    viewingSessionAiDisclosureVersion: payload.viewingSessionAiDisclosureVersion,
                    viewingSessionRawAudioStorageEnabled: payload.viewingSessionRawAudioStorageEnabled,
                    viewingSessionTranslationModel: payload.viewingSessionTranslationModel,
                    viewingSessionInsightsModel: payload.viewingSessionInsightsModel,
                    viewingSessionSummaryModel: payload.viewingSessionSummaryModel,
                    brandVoice: payload.brandVoice,
                    outreachConfig: payload.outreachConfig,
                },
                update: {
                    ...(legacySecretAction === "set" ? { googleAiApiKey } : {}),
                    ...(legacySecretAction === "clear" ? { googleAiApiKey: null } : {}),
                    googleAiModel: payload.googleAiModel,
                    googleAiModelExtraction: payload.googleAiModelExtraction,
                    googleAiModelDesign: payload.googleAiModelDesign,
                    googleAiModelTranscription: payload.googleAiModelTranscription,
                    whatsappTranscriptOnDemandEnabled: payload.whatsappTranscriptOnDemandEnabled,
                    whatsappTranscriptRetentionDays: payload.whatsappTranscriptRetentionDays,
                    whatsappTranscriptVisibility: payload.whatsappTranscriptVisibility,
                    viewingSessionRetentionDays: payload.viewingSessionRetentionDays,
                    viewingSessionTranscriptVisibility: payload.viewingSessionTranscriptVisibility,
                    viewingSessionAiDisclosureRequired: payload.viewingSessionAiDisclosureRequired,
                    viewingSessionAiDisclosureVersion: payload.viewingSessionAiDisclosureVersion,
                    viewingSessionRawAudioStorageEnabled: payload.viewingSessionRawAudioStorageEnabled,
                    viewingSessionTranslationModel: payload.viewingSessionTranslationModel,
                    viewingSessionInsightsModel: payload.viewingSessionInsightsModel,
                    viewingSessionSummaryModel: payload.viewingSessionSummaryModel,
                    brandVoice: payload.brandVoice,
                    outreachConfig: payload.outreachConfig,
                },
            });
        }

        if (isSettingsDualWriteLegacyEnabled() && isSettingsParityCheckEnabled()) {
            const legacyComparablePayload: Record<string, unknown> = { ...payload };
            delete legacyComparablePayload.automationConfig;
            await settingsService.checkDocumentParity({
                scopeType: "LOCATION",
                scopeId: locationId,
                domain: SETTINGS_DOMAINS.LOCATION_AI,
                legacyPayload: legacyComparablePayload,
                ignoreKeys: ["precisionRemoveEnabled"],
                actorUserId: localUser?.id,
            });
        }

        revalidatePath("/admin/settings/ai");
        return { message: "AI Settings saved successfully", version: savedDoc.version };
    } catch (error: any) {
        console.error(error);
        if (error instanceof SettingsVersionConflictError) {
            return { errors: { _version: ["This form is out of date. Refresh and try again."] } };
        }
        return { message: "Database error occurred." };
    }
}

export async function runAiAutomationNowAction(
    locationId: string,
    options?: { plannerOnly?: boolean; batchSize?: number }
): Promise<RunAiAutomationNowResult> {
    const { userId } = await auth();
    if (!userId) return { success: false, error: "Unauthorized" };

    const targetLocationId = String(locationId || "").trim();
    if (!targetLocationId) return { success: false, error: "Missing location ID." };

    const isAdmin = await verifyUserIsLocationAdmin(userId, targetLocationId);
    if (!isAdmin) return { success: false, error: "Unauthorized: Admin access is required." };

    try {
        const runtime = await runAiRuntimeNow(targetLocationId, {
            plannerOnly: !!options?.plannerOnly,
            batchSize: Math.max(1, Math.min(300, Number(options?.batchSize || 80))),
            source: "automation",
        });
        if (!runtime.success) {
            return { success: false, error: runtime.error || "Failed to run AI runtime cron." };
        }

        revalidatePath("/admin/settings/ai");
        return { success: true, stats: runtime.stats };
    } catch (error: any) {
        console.error("[runAiRuntimeNowAction] Error:", error);
        return { success: false, error: error?.message || "Failed to run runtime cron." };
    }
}

export async function runAiRuntimeNowAction(
    locationId: string,
    options?: { plannerOnly?: boolean; batchSize?: number }
): Promise<RunAiAutomationNowResult> {
    return runAiAutomationNowAction(locationId, options);
}

export async function updateAiAutomationConfigFromSettingsAction(
    locationId: string,
    config: unknown
): Promise<UpdateAiAutomationConfigResult> {
    return updateAiAutomationConfig(locationId, config);
}

export async function listSkillPoliciesFromSettingsAction(locationId: string) {
    const { userId } = await auth();
    if (!userId) return [];
    const targetLocationId = String(locationId || "").trim();
    if (!targetLocationId) return [];
    const isAdmin = await verifyUserIsLocationAdmin(userId, targetLocationId);
    if (!isAdmin) return [];
    return listSkillPolicies(targetLocationId);
}

export async function upsertSkillPolicyFromSettingsAction(locationId: string, skillId: string, policy: unknown) {
    const { userId } = await auth();
    if (!userId) return { success: false as const, error: "Unauthorized" };
    const targetLocationId = String(locationId || "").trim();
    if (!targetLocationId) return { success: false as const, error: "Missing location ID." };
    const isAdmin = await verifyUserIsLocationAdmin(userId, targetLocationId);
    if (!isAdmin) return { success: false as const, error: "Unauthorized: Admin access is required." };
    return upsertSkillPolicy(targetLocationId, skillId, policy);
}

export async function listAiRuntimeDecisionsFromSettingsAction(locationId: string, input?: {
    status?: string | null;
    skillId?: string | null;
    since?: string | null;
    limit?: number;
}) {
    const { userId } = await auth();
    if (!userId) return [];
    const targetLocationId = String(locationId || "").trim();
    if (!targetLocationId) return [];
    const isAdmin = await verifyUserIsLocationAdmin(userId, targetLocationId);
    if (!isAdmin) return [];
    return listAiDecisions({
        ...input,
        locationId: targetLocationId,
        limit: Math.max(1, Math.min(120, Number(input?.limit || 40))),
    });
}

export async function listAiRuntimeJobsFromSettingsAction(locationId: string, input?: {
    status?: string | null;
    since?: string | null;
    limit?: number;
}) {
    const { userId } = await auth();
    if (!userId) return [];
    const targetLocationId = String(locationId || "").trim();
    if (!targetLocationId) return [];
    const isAdmin = await verifyUserIsLocationAdmin(userId, targetLocationId);
    if (!isAdmin) return [];
    return listAiRuntimeJobs({
        ...input,
        locationId: targetLocationId,
        limit: Math.max(1, Math.min(120, Number(input?.limit || 40))),
    });
}

export async function simulateSkillDecisionFromSettingsAction(input: {
    locationId: string;
    conversationId?: string | null;
    dealId?: string | null;
    contactId?: string | null;
}) {
    const { userId } = await auth();
    if (!userId) return { success: false as const, error: "Unauthorized" };
    const targetLocationId = String(input.locationId || "").trim();
    if (!targetLocationId) return { success: false as const, error: "Missing location ID." };
    const isAdmin = await verifyUserIsLocationAdmin(userId, targetLocationId);
    if (!isAdmin) return { success: false as const, error: "Unauthorized: Admin access is required." };
    return simulateSkillDecision(input);
}
