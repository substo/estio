"use server";

import db from "@/lib/db";
import { auth } from "@clerk/nextjs/server";
import { verifyUserHasAccessToLocation } from "@/lib/auth/permissions";
import { revalidatePath } from "next/cache";
import { GEMINI_FLASH_LATEST_ALIAS, GEMINI_FLASH_STABLE_FALLBACK } from "@/lib/ai/models";

interface AiSettingsState {
    message?: string;
    errors?: {
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

    const hasAccess = await verifyUserHasAccessToLocation(userId, locationId);
    if (!hasAccess) {
        return { message: "Unauthorized: You do not have access to this location." };
    }

    try {
        const transcriptionModel = normalizeTranscriptionModel(formData.get("googleAiModelTranscription"));
        const transcriptOnDemandEnabled = formData.get("whatsappTranscriptOnDemandEnabled") === "on";
        const transcriptRetentionDays = normalizeTranscriptRetentionDays(formData.get("whatsappTranscriptRetentionDays"));
        const transcriptVisibility = normalizeTranscriptVisibility(formData.get("whatsappTranscriptVisibility"));

        await db.siteConfig.upsert({
            where: { locationId },
            create: {
                locationId,
                googleAiApiKey: formData.get("googleAiApiKey") as string,
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
                }
            },
            update: {
                googleAiApiKey: formData.get("googleAiApiKey") as string,
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
                }
            },
        });

        revalidatePath("/admin/settings/ai");
        return { message: "AI Settings saved successfully" };
    } catch (error: any) {
        console.error(error);
        return { message: "Database error occurred." };
    }
}
