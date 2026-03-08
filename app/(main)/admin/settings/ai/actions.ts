"use server";

import db from "@/lib/db";
import { auth } from "@clerk/nextjs/server";
import { verifyUserIsLocationAdmin } from "@/lib/auth/permissions";
import { revalidatePath } from "next/cache";
import { GEMINI_FLASH_LATEST_ALIAS, GEMINI_FLASH_STABLE_FALLBACK } from "@/lib/ai/models";
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
        const expectedVersionRaw = (formData.get("settingsVersion") as string | null)?.trim();
        const expectedVersionCandidate = expectedVersionRaw ? Number(expectedVersionRaw) : null;
        const expectedVersion = Number.isFinite(expectedVersionCandidate) ? expectedVersionCandidate : null;

        const transcriptionModel = normalizeTranscriptionModel(formData.get("googleAiModelTranscription"));
        const transcriptOnDemandEnabled = formData.get("whatsappTranscriptOnDemandEnabled") === "on";
        const transcriptRetentionDays = normalizeTranscriptRetentionDays(formData.get("whatsappTranscriptRetentionDays"));
        const transcriptVisibility = normalizeTranscriptVisibility(formData.get("whatsappTranscriptVisibility"));
        const payload = {
            googleAiModel: formData.get("googleAiModel") as string || GEMINI_FLASH_LATEST_ALIAS,
            googleAiModelExtraction: formData.get("googleAiModelExtraction") as string || GEMINI_FLASH_LATEST_ALIAS,
            googleAiModelDesign: formData.get("googleAiModelDesign") as string || GEMINI_FLASH_LATEST_ALIAS,
            googleAiModelTranscription: transcriptionModel,
            whatsappTranscriptOnDemandEnabled: transcriptOnDemandEnabled,
            whatsappTranscriptRetentionDays: transcriptRetentionDays,
            whatsappTranscriptVisibility: transcriptVisibility,
            brandVoice: formData.get("brandVoice") as string,
            outreachConfig: {
                enabled: formData.get("outreachEnabled") === "on",
                visionIdPrompt: formData.get("visionIdPrompt") as string,
                icebreakerPrompt: formData.get("icebreakerPrompt") as string,
                qualifierPrompt: formData.get("qualifierPrompt") as string,
            },
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
                    brandVoice: payload.brandVoice,
                    outreachConfig: payload.outreachConfig,
                },
            });
        }

        if (isSettingsDualWriteLegacyEnabled() && isSettingsParityCheckEnabled()) {
            await settingsService.checkDocumentParity({
                scopeType: "LOCATION",
                scopeId: locationId,
                domain: SETTINGS_DOMAINS.LOCATION_AI,
                legacyPayload: payload,
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
