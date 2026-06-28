"use server";

import db from "@/lib/db";
import { auth } from "@clerk/nextjs/server";
import { verifyUserIsLocationAdmin } from "@/lib/auth/permissions";
import { revalidatePath } from "next/cache";
import { DEFAULT_REPLY_LANGUAGE, normalizeReplyLanguage } from "@/lib/ai/reply-language-options";
import { GEMINI_FLASH_LITE_LATEST_ALIAS, GEMINI_FLASH_LATEST_ALIAS, GEMINI_FLASH_STABLE_FALLBACK } from "@/lib/ai/models";
import {
    listAiDecisions,
    listAiRuntimeJobs,
    listAgentLearningProposalsAction,
    listLocationAiPromptVersionsAction,
    listSkillPolicies,
    approveAgentLearningProposalAction,
    dismissAgentLearningProposalAction,
    revertLocationAiPromptAction,
    runAiRuntimeNow,
    simulateSkillDecision,
    submitAgentLearningProposalAction,
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
import { runRequirementsIntelligenceCron } from "@/lib/ai/requirements-intelligence/service";
import { normalizeAllowedPropertyDomains } from "@/lib/ai/property-evidence-resolver/domain-policy";
import {
    runContactProfileVerificationCron,
    triggerGlobalContactProfileRecertification,
} from "@/lib/ai/contact-profile-verification/cron";
import {
    normalizeContactProfileVerificationBatchSize,
    normalizeContactProfileVerificationConfig,
    normalizeContactProfileVerificationDelayHours,
    normalizeContactProfileVerificationMode,
    normalizeContactProfileVerificationRecertificationDays,
} from "@/lib/ai/contact-profile-verification/config";

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

type AiSettingsAuthorization =
    | { ok: true; userId: string; locationId: string }
    | { ok: false; error: string };

async function authorizeAiSettingsLocation(
    locationId: unknown,
    options: {
        missingLocationError?: string;
        adminError?: string;
        trimLocationId?: boolean;
    } = {}
): Promise<AiSettingsAuthorization> {
    const { userId } = await auth();
    if (!userId) return { ok: false, error: "Unauthorized" };

    const rawLocationId = String(locationId || "");
    const targetLocationId = options.trimLocationId === false ? rawLocationId : rawLocationId.trim();
    if (!targetLocationId) {
        return { ok: false, error: options.missingLocationError || "Missing location ID." };
    }

    const isAdmin = await verifyUserIsLocationAdmin(userId, targetLocationId);
    if (!isAdmin) {
        return { ok: false, error: options.adminError || "Unauthorized: Admin access is required." };
    }

    return { ok: true, userId, locationId: targetLocationId };
}

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
    const authorization = await authorizeAiSettingsLocation(formData.get("locationId"), {
        missingLocationError: "Location ID is missing",
        adminError: "Unauthorized: Admin access is required to update settings.",
        trimLocationId: false,
    });
    if (!authorization.ok) return { message: authorization.error };

    const { userId, locationId } = authorization;

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
        const translationModel = String(formData.get("googleAiModelTranslation") || "").trim() || GEMINI_FLASH_LITE_LATEST_ALIAS;
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
        const leadIntelligenceModeRaw = String(formData.get("leadIntelligenceMode") || "").trim();
        const legacyRequirementsModeRaw = String(formData.get("requirementsIntelligenceMode") || "").trim();
        const requirementsIntelligenceModeRaw = leadIntelligenceModeRaw === "automatic"
            ? "daily_and_new_activity"
            : leadIntelligenceModeRaw === "off" || leadIntelligenceModeRaw === "manual_only"
                ? leadIntelligenceModeRaw
                : legacyRequirementsModeRaw;
        const requirementsIntelligenceMode = ["off", "manual_only", "new_activity", "daily_and_new_activity"].includes(requirementsIntelligenceModeRaw)
            ? requirementsIntelligenceModeRaw
            : "manual_only";
        const requirementsIntelligenceModel = normalizeOptionalModelOverride(formData.get("requirementsIntelligenceModel")) || transcriptionModel;
        const openAiTextModel = normalizeOptionalModelOverride(formData.get("openAiTextModel"));
        const requirementsAllowedPropertyDomains = normalizeAllowedPropertyDomains(formData.get("requirementsAllowedPropertyDomains"));
        const requirementsActivityWaitHoursRaw = Number(formData.get("requirementsActivityWaitHours"));
        const requirementsActivityDebounceRaw = Number(formData.get("requirementsActivityDebounceMinutes"));
        const requirementsActivityDebounceMinutes = Number.isFinite(requirementsActivityWaitHoursRaw)
            ? Math.max(0, Math.min(24, Math.trunc(requirementsActivityWaitHoursRaw))) * 60
            : Number.isFinite(requirementsActivityDebounceRaw)
                ? Math.max(0, Math.min(24 * 60, Math.trunc(requirementsActivityDebounceRaw)))
                : 24 * 60;
        const autoReprocessCampaignCandidates = formData.get("leadIntelligenceAutoReprocessCampaignCandidates") === "on"
            || formData.get("contactProfileVerificationAutoReprocessCampaignBlocks") === "on";
        const existingContactProfileVerification = normalizeContactProfileVerificationConfig((existingPayload as any)?.contactProfileVerification);
        const mappedContactProfileVerificationMode = leadIntelligenceModeRaw === "automatic"
            ? "daily_due_and_new_contacts"
            : leadIntelligenceModeRaw === "off" || leadIntelligenceModeRaw === "manual_only"
                ? leadIntelligenceModeRaw
                : formData.get("contactProfileVerificationMode");
        const contactProfileVerificationMode = normalizeContactProfileVerificationMode(mappedContactProfileVerificationMode);
        const contactProfileVerificationModel = normalizeOptionalModelOverride(formData.get("contactProfileVerificationModel"))
            || requirementsIntelligenceModel
            || transcriptionModel;
        const defaultReplyLanguage = normalizeReplyLanguage(String(formData.get("defaultReplyLanguage") || "")) || DEFAULT_REPLY_LANGUAGE;
        const payload = {
            ...existingPayload,
            googleAiModel: formData.get("googleAiModel") as string || GEMINI_FLASH_LATEST_ALIAS,
            googleAiModelExtraction: formData.get("googleAiModelExtraction") as string || GEMINI_FLASH_LATEST_ALIAS,
            googleAiModelDesign: formData.get("googleAiModelDesign") as string || GEMINI_FLASH_LATEST_ALIAS,
            googleAiModelTranscription: transcriptionModel,
            googleAiModelTranslation: translationModel,
            openAiTextModel,
            defaultReplyLanguage,
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
            requirementsIntelligence: {
                mode: requirementsIntelligenceMode,
                model: requirementsIntelligenceModel,
                allowedPropertyDomains: requirementsAllowedPropertyDomains,
                activityDebounceMinutes: requirementsActivityDebounceMinutes,
                autoReprocessCampaignCandidates,
            },
            contactProfileVerification: {
                ...existingContactProfileVerification,
                mode: contactProfileVerificationMode,
                model: contactProfileVerificationModel,
                newContactDelayHours: normalizeContactProfileVerificationDelayHours(formData.get("contactProfileVerificationNewContactDelayHours"), existingContactProfileVerification.newContactDelayHours ?? 0),
                recertificationDays: normalizeContactProfileVerificationRecertificationDays(formData.get("contactProfileVerificationRecertificationDays"), existingContactProfileVerification.recertificationDays ?? 90),
                recertifyOnNewActivity: false,
                batchSize: normalizeContactProfileVerificationBatchSize(formData.get("leadIntelligenceBatchSize"), existingContactProfileVerification.batchSize ?? 50),
                autoReprocessCampaignBlocks: autoReprocessCampaignCandidates,
            },
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
        const clearOpenAiApiKey = formData.get("clearOpenAiApiKey") === "on";
        const openAiApiKey = String(formData.get("openAiApiKey") || "").trim();
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

        if (clearOpenAiApiKey) {
            await settingsService.clearSecret({
                scopeType: "LOCATION",
                scopeId: locationId,
                domain: SETTINGS_DOMAINS.LOCATION_AI,
                secretKey: SETTINGS_SECRET_KEYS.OPENAI_API_KEY,
                actorUserId: localUser?.id,
            });
        } else if (openAiApiKey) {
            await settingsService.setSecret({
                scopeType: "LOCATION",
                scopeId: locationId,
                domain: SETTINGS_DOMAINS.LOCATION_AI,
                secretKey: SETTINGS_SECRET_KEYS.OPENAI_API_KEY,
                plaintext: openAiApiKey,
                actorUserId: localUser?.id,
            });
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
                    googleAiModelTranslation: payload.googleAiModelTranslation,
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
                    googleAiModelTranslation: payload.googleAiModelTranslation,
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
            delete legacyComparablePayload.defaultReplyLanguage;
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
    const authorization = await authorizeAiSettingsLocation(locationId);
    if (!authorization.ok) return { success: false, error: authorization.error };

    try {
        const runtime = await runAiRuntimeNow(authorization.locationId, {
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

export async function getOpenAiTextModelPickerStateAction(locationId: string) {
    const authorization = await authorizeAiSettingsLocation(locationId);
    if (!authorization.ok) {
        return { models: [], defaultModel: "" };
    }

    const { getOpenAiTextModelPickerState } = await import("@/lib/ai/openai-models");
    return getOpenAiTextModelPickerState(authorization.locationId, { includeAuthenticatedUser: false });
}

export async function runAiRuntimeNowAction(
    locationId: string,
    options?: { plannerOnly?: boolean; batchSize?: number }
): Promise<RunAiAutomationNowResult> {
    return runAiAutomationNowAction(locationId, options);
}

export async function runRequirementsIntelligenceNowAction(
    locationId: string,
    options?: { batchSize?: number }
): Promise<RunAiAutomationNowResult> {
    const authorization = await authorizeAiSettingsLocation(locationId);
    if (!authorization.ok) return { success: false, error: authorization.error };

    try {
        const stats = await runRequirementsIntelligenceCron({
            locationId: authorization.locationId,
            batchSize: Math.max(1, Math.min(100, Number(options?.batchSize || 40))),
            source: "manual",
            force: true,
        });
        revalidatePath("/admin/settings/ai");
        return { success: true, stats };
    } catch (error: any) {
        console.error("[runRequirementsIntelligenceNowAction] Error:", error);
        return { success: false, error: error?.message || "Failed to run Requirements Intelligence scan." };
    }
}

export async function runContactProfileVerificationNowAction(
    locationId: string,
    options?: { batchSize?: number }
): Promise<RunAiAutomationNowResult> {
    const authorization = await authorizeAiSettingsLocation(locationId);
    if (!authorization.ok) return { success: false, error: authorization.error };

    try {
        const stats = await runContactProfileVerificationCron({
            locationId: authorization.locationId,
            batchSize: normalizeContactProfileVerificationBatchSize(options?.batchSize),
            source: "manual",
            force: true,
        });
        revalidatePath("/admin/settings/ai");
        return { success: true, stats };
    } catch (error: any) {
        console.error("[runContactProfileVerificationNowAction] Error:", error);
        return { success: false, error: error?.message || "Failed to run Contact Classification." };
    }
}

export async function triggerGlobalContactProfileRecertificationAction(locationId: string) {
    const authorization = await authorizeAiSettingsLocation(locationId);
    if (!authorization.ok) return { success: false as const, error: authorization.error };

    try {
        const result = await triggerGlobalContactProfileRecertification({
            locationId: authorization.locationId,
        });
        revalidatePath("/admin/settings/ai");
        return result;
    } catch (error: any) {
        console.error("[triggerGlobalContactProfileRecertificationAction] Error:", error);
        return { success: false as const, error: error?.message || "Failed to trigger global recertification." };
    }
}

export async function updateAiAutomationConfigFromSettingsAction(
    locationId: string,
    config: unknown
): Promise<UpdateAiAutomationConfigResult> {
    return updateAiAutomationConfig(locationId, config);
}

export async function listSkillPoliciesFromSettingsAction(locationId: string) {
    const authorization = await authorizeAiSettingsLocation(locationId);
    if (!authorization.ok) return [];
    return listSkillPolicies(authorization.locationId);
}

export async function upsertSkillPolicyFromSettingsAction(locationId: string, skillId: string, policy: unknown) {
    const authorization = await authorizeAiSettingsLocation(locationId);
    if (!authorization.ok) return { success: false as const, error: authorization.error };
    return upsertSkillPolicy(authorization.locationId, skillId, policy);
}

export async function submitAgentLearningProposalFromSettingsAction(locationId: string, input: {
    skillId?: string | null;
    type?: "style_policy" | "location_knowledge" | string | null;
    title?: string | null;
    description?: string | null;
    proposedContent?: string | null;
    category?: string | null;
    key?: string | null;
}) {
    return submitAgentLearningProposalAction({
        ...input,
        locationId,
    });
}

export async function listAgentLearningProposalsFromSettingsAction(locationId: string, input?: {
    status?: string | null;
    limit?: number;
}) {
    const authorization = await authorizeAiSettingsLocation(locationId);
    if (!authorization.ok) return [];
    return listAgentLearningProposalsAction({
        locationId: authorization.locationId,
        status: input?.status ?? null,
        limit: input?.limit,
    });
}

export async function approveAgentLearningProposalFromSettingsAction(locationId: string, proposalId: string) {
    const authorization = await authorizeAiSettingsLocation(locationId);
    if (!authorization.ok) return { success: false as const, error: authorization.error };
    return approveAgentLearningProposalAction({
        locationId: authorization.locationId,
        proposalId,
    });
}

export async function dismissAgentLearningProposalFromSettingsAction(locationId: string, proposalId: string) {
    const authorization = await authorizeAiSettingsLocation(locationId);
    if (!authorization.ok) return { success: false as const, error: authorization.error };
    return dismissAgentLearningProposalAction({
        locationId: authorization.locationId,
        proposalId,
    });
}

export async function revertLocationAiPromptFromSettingsAction(locationId: string, input: {
    skillId: string;
    versionId?: string | null;
}) {
    const authorization = await authorizeAiSettingsLocation(locationId);
    if (!authorization.ok) return { success: false as const, error: authorization.error };
    return revertLocationAiPromptAction({
        locationId: authorization.locationId,
        skillId: input.skillId,
        versionId: input.versionId || null,
        targetKind: "style_policy",
    });
}

export async function listLocationAiPromptVersionsFromSettingsAction(locationId: string, input?: {
    skillId?: string | null;
    limit?: number;
}) {
    const authorization = await authorizeAiSettingsLocation(locationId);
    if (!authorization.ok) return [];
    return listLocationAiPromptVersionsAction({
        locationId: authorization.locationId,
        skillId: input?.skillId || null,
        targetKind: "style_policy",
        limit: input?.limit,
    });
}

export async function listAiRuntimeDecisionsFromSettingsAction(locationId: string, input?: {
    status?: string | null;
    skillId?: string | null;
    since?: string | null;
    limit?: number;
}) {
    const authorization = await authorizeAiSettingsLocation(locationId);
    if (!authorization.ok) return [];
    return listAiDecisions({
        ...input,
        locationId: authorization.locationId,
        limit: Math.max(1, Math.min(120, Number(input?.limit || 40))),
    });
}

export async function listAiRuntimeJobsFromSettingsAction(locationId: string, input?: {
    status?: string | null;
    since?: string | null;
    limit?: number;
}) {
    const authorization = await authorizeAiSettingsLocation(locationId);
    if (!authorization.ok) return [];
    return listAiRuntimeJobs({
        ...input,
        locationId: authorization.locationId,
        limit: Math.max(1, Math.min(120, Number(input?.limit || 40))),
    });
}

export async function simulateSkillDecisionFromSettingsAction(input: {
    locationId: string;
    conversationId?: string | null;
    dealId?: string | null;
    contactId?: string | null;
}) {
    const authorization = await authorizeAiSettingsLocation(input.locationId);
    if (!authorization.ok) return { success: false as const, error: authorization.error };
    return simulateSkillDecision(input);
}
