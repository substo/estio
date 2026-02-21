"use server";

import { auth } from "@clerk/nextjs/server";
import db from "@/lib/db";
import { revalidatePath } from "next/cache";

export type GoogleAutoSyncMode = "LINK_ONLY" | "LINK_OR_CREATE";

export async function updateGoogleSyncDirection(direction: string) {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) throw new Error("Unauthorized");

    // Validate direction value
    if (!["ESTIO_TO_GOOGLE", "GOOGLE_TO_ESTIO"].includes(direction)) {
        throw new Error("Invalid sync direction");
    }

    await db.user.update({
        where: { clerkId: clerkUserId },
        data: { googleSyncDirection: direction }
    });

    revalidatePath("/admin/settings/integrations/google");
    return { success: true };
}

type GoogleAutomationSettingsInput = {
    enabled?: boolean;
    leadCapture?: boolean;
    contactForm?: boolean;
    whatsappInbound?: boolean;
    mode?: GoogleAutoSyncMode;
    pushUpdates?: boolean;
};

export async function updateGoogleAutomationSettings(input: GoogleAutomationSettingsInput) {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) throw new Error("Unauthorized");

    if (input.mode && !["LINK_ONLY", "LINK_OR_CREATE"].includes(input.mode)) {
        throw new Error("Invalid automation mode");
    }

    const updateData: Record<string, boolean | string> = {};
    if (typeof input.enabled === "boolean") updateData.googleAutoSyncEnabled = input.enabled;
    if (typeof input.leadCapture === "boolean") updateData.googleAutoSyncLeadCapture = input.leadCapture;
    if (typeof input.contactForm === "boolean") updateData.googleAutoSyncContactForm = input.contactForm;
    if (typeof input.whatsappInbound === "boolean") updateData.googleAutoSyncWhatsAppInbound = input.whatsappInbound;
    if (typeof input.pushUpdates === "boolean") updateData.googleAutoSyncPushUpdates = input.pushUpdates;
    if (typeof input.mode === "string") updateData.googleAutoSyncMode = input.mode;

    await db.user.update({
        where: { clerkId: clerkUserId },
        data: updateData
    });

    revalidatePath("/admin/settings/integrations/google");
    return { success: true };
}
