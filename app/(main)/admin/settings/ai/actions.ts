"use server";

import db from "@/lib/db";
import { auth } from "@clerk/nextjs/server";
import { verifyUserHasAccessToLocation } from "@/lib/auth/permissions";
import { revalidatePath } from "next/cache";

interface AiSettingsState {
    message?: string;
    errors?: {
        _form?: string[];
    };
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
        await db.siteConfig.upsert({
            where: { locationId },
            create: {
                locationId,
                googleAiApiKey: formData.get("googleAiApiKey") as string,
                googleAiModel: formData.get("googleAiModel") as string || "gemini-2.5-flash",
                googleAiModelExtraction: formData.get("googleAiModelExtraction") as string || "gemini-2.5-flash",
                googleAiModelDesign: formData.get("googleAiModelDesign") as string || "gemini-2.5-flash",
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
                googleAiModel: formData.get("googleAiModel") as string || "gemini-2.5-flash",
                googleAiModelExtraction: formData.get("googleAiModelExtraction") as string || "gemini-2.5-flash",
                googleAiModelDesign: formData.get("googleAiModelDesign") as string || "gemini-2.5-flash",
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
