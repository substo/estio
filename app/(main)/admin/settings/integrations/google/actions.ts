"use server";

import { auth } from "@clerk/nextjs/server";
import db from "@/lib/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
    googleIntegrationSettingsSelect,
    updateGoogleIntegrationSettings,
    type GoogleAutoSyncMode,
    type GoogleIntegrationSettings,
    type GoogleIntegrationLegacyUser,
} from "@/lib/google/settings";

export type { GoogleAutoSyncMode } from "@/lib/google/settings";

const GOOGLE_SETTINGS_PATH = "/admin/settings/integrations/google";

async function resolveGoogleContext() {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
        throw new Error("Unauthorized");
    }

    const user = await db.user.findUnique({
        where: { clerkId: clerkUserId },
        select: {
            id: true,
            ...googleIntegrationSettingsSelect,
        },
    });

    if (!user) {
        throw new Error("User not found");
    }

    return { user: user as GoogleIntegrationLegacyUser };
}

async function saveGoogleSettings({
    user,
    patch,
}: {
    user: GoogleIntegrationLegacyUser;
    patch: Partial<GoogleIntegrationSettings>;
}) {
    await updateGoogleIntegrationSettings({
        user,
        patch,
        legacyData: patch,
    });

    revalidatePath(GOOGLE_SETTINGS_PATH);
}

export async function updateGoogleSyncDirection(direction: string) {
    const { user } = await resolveGoogleContext();

    // Validate direction value
    if (!["ESTIO_TO_GOOGLE", "GOOGLE_TO_ESTIO"].includes(direction)) {
        throw new Error("Invalid sync direction");
    }

    await saveGoogleSettings({
        user,
        patch: { googleSyncDirection: direction },
    });
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
    const { user } = await resolveGoogleContext();

    if (input.mode && !["LINK_ONLY", "LINK_OR_CREATE"].includes(input.mode)) {
        throw new Error("Invalid automation mode");
    }

    const patch = {
        googleAutoSyncEnabled: input.enabled,
        googleAutoSyncLeadCapture: input.leadCapture,
        googleAutoSyncContactForm: input.contactForm,
        googleAutoSyncWhatsAppInbound: input.whatsappInbound,
        googleAutoSyncPushUpdates: input.pushUpdates,
        googleAutoSyncMode: input.mode,
    };

    await saveGoogleSettings({
        user,
        patch,
    });

    return { success: true };
}

const updateGoogleTasklistSettingsSchema = z.object({
    tasklistId: z.string().trim().min(1).max(255),
    tasklistTitle: z.string().trim().max(255).optional().nullable()
});

export async function updateGoogleTasklistSettings(input: z.input<typeof updateGoogleTasklistSettingsSchema>) {
    const { user } = await resolveGoogleContext();

    const parsed = updateGoogleTasklistSettingsSchema.parse(input);

    const patch = {
        googleTasklistId: parsed.tasklistId,
        googleTasklistTitle: parsed.tasklistTitle || null,
    };

    await saveGoogleSettings({ user, patch });

    return { success: true };
}

const updateGoogleCalendarSettingsSchema = z.object({
    calendarId: z.string().trim().min(1).max(255),
    calendarTitle: z.string().trim().max(255).optional().nullable()
});

export async function updateGoogleCalendarSettings(input: z.input<typeof updateGoogleCalendarSettingsSchema>) {
    const { user } = await resolveGoogleContext();

    const parsed = updateGoogleCalendarSettingsSchema.parse(input);

    const patch = {
        googleCalendarId: parsed.calendarId,
        googleCalendarTitle: parsed.calendarTitle || null,
    };

    await saveGoogleSettings({ user, patch });

    return { success: true };
}
