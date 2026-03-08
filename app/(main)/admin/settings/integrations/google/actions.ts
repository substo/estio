"use server";

import { auth } from "@clerk/nextjs/server";
import db from "@/lib/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { settingsService } from "@/lib/settings/service";
import {
    SETTINGS_DOMAINS,
    isSettingsDualWriteLegacyEnabled,
    isSettingsParityCheckEnabled,
} from "@/lib/settings/constants";

export type GoogleAutoSyncMode = "LINK_ONLY" | "LINK_OR_CREATE";

type GoogleUserLegacy = {
    id: string;
    googleSyncEnabled: boolean;
    googleSyncDirection: string | null;
    googleAutoSyncEnabled: boolean;
    googleAutoSyncLeadCapture: boolean;
    googleAutoSyncContactForm: boolean;
    googleAutoSyncWhatsAppInbound: boolean;
    googleAutoSyncMode: string;
    googleAutoSyncPushUpdates: boolean;
    googleTasklistId: string | null;
    googleTasklistTitle: string | null;
    googleCalendarId: string | null;
    googleCalendarTitle: string | null;
};

function buildGoogleSettingsPayload(user: GoogleUserLegacy, existing?: Record<string, any>) {
    return {
        ...(existing || {}),
        googleSyncEnabled: existing?.googleSyncEnabled ?? user.googleSyncEnabled ?? false,
        googleSyncDirection: existing?.googleSyncDirection ?? user.googleSyncDirection ?? null,
        googleAutoSyncEnabled: existing?.googleAutoSyncEnabled ?? user.googleAutoSyncEnabled ?? false,
        googleAutoSyncLeadCapture: existing?.googleAutoSyncLeadCapture ?? user.googleAutoSyncLeadCapture ?? false,
        googleAutoSyncContactForm: existing?.googleAutoSyncContactForm ?? user.googleAutoSyncContactForm ?? false,
        googleAutoSyncWhatsAppInbound: existing?.googleAutoSyncWhatsAppInbound ?? user.googleAutoSyncWhatsAppInbound ?? false,
        googleAutoSyncMode: existing?.googleAutoSyncMode ?? user.googleAutoSyncMode ?? "LINK_ONLY",
        googleAutoSyncPushUpdates: existing?.googleAutoSyncPushUpdates ?? user.googleAutoSyncPushUpdates ?? false,
        googleTasklistId: existing?.googleTasklistId ?? user.googleTasklistId ?? null,
        googleTasklistTitle: existing?.googleTasklistTitle ?? user.googleTasklistTitle ?? null,
        googleCalendarId: existing?.googleCalendarId ?? user.googleCalendarId ?? null,
        googleCalendarTitle: existing?.googleCalendarTitle ?? user.googleCalendarTitle ?? null,
    };
}

async function resolveGoogleContext() {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
        throw new Error("Unauthorized");
    }

    const user = await db.user.findUnique({
        where: { clerkId: clerkUserId },
        select: {
            id: true,
            googleSyncEnabled: true,
            googleSyncDirection: true,
            googleAutoSyncEnabled: true,
            googleAutoSyncLeadCapture: true,
            googleAutoSyncContactForm: true,
            googleAutoSyncWhatsAppInbound: true,
            googleAutoSyncMode: true,
            googleAutoSyncPushUpdates: true,
            googleTasklistId: true,
            googleTasklistTitle: true,
            googleCalendarId: true,
            googleCalendarTitle: true,
        },
    });

    if (!user) {
        throw new Error("User not found");
    }

    return { user: user as GoogleUserLegacy };
}

export async function updateGoogleSyncDirection(direction: string) {
    const { user } = await resolveGoogleContext();

    // Validate direction value
    if (!["ESTIO_TO_GOOGLE", "GOOGLE_TO_ESTIO"].includes(direction)) {
        throw new Error("Invalid sync direction");
    }

    const existingDoc = await settingsService.getDocument<any>({
        scopeType: "USER",
        scopeId: user.id,
        domain: SETTINGS_DOMAINS.USER_GOOGLE_INTEGRATIONS,
    });
    const payload = {
        ...buildGoogleSettingsPayload(user, existingDoc?.payload || {}),
        googleSyncDirection: direction,
    };

    await settingsService.upsertDocument({
        scopeType: "USER",
        scopeId: user.id,
        domain: SETTINGS_DOMAINS.USER_GOOGLE_INTEGRATIONS,
        payload,
        actorUserId: user.id,
        schemaVersion: 1,
    });

    if (isSettingsDualWriteLegacyEnabled()) {
        await db.user.update({
            where: { id: user.id },
            data: { googleSyncDirection: direction },
        });
    }

    if (isSettingsDualWriteLegacyEnabled() && isSettingsParityCheckEnabled()) {
        await settingsService.checkDocumentParity({
            scopeType: "USER",
            scopeId: user.id,
            domain: SETTINGS_DOMAINS.USER_GOOGLE_INTEGRATIONS,
            legacyPayload: {
                ...buildGoogleSettingsPayload(user, {}),
                googleSyncDirection: direction,
            },
            actorUserId: user.id,
        });
    }

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
    const { user } = await resolveGoogleContext();

    if (input.mode && !["LINK_ONLY", "LINK_OR_CREATE"].includes(input.mode)) {
        throw new Error("Invalid automation mode");
    }

    const existingDoc = await settingsService.getDocument<any>({
        scopeType: "USER",
        scopeId: user.id,
        domain: SETTINGS_DOMAINS.USER_GOOGLE_INTEGRATIONS,
    });
    const payload = {
        ...buildGoogleSettingsPayload(user, existingDoc?.payload || {}),
    } as Record<string, any>;

    if (typeof input.enabled === "boolean") payload.googleAutoSyncEnabled = input.enabled;
    if (typeof input.leadCapture === "boolean") payload.googleAutoSyncLeadCapture = input.leadCapture;
    if (typeof input.contactForm === "boolean") payload.googleAutoSyncContactForm = input.contactForm;
    if (typeof input.whatsappInbound === "boolean") payload.googleAutoSyncWhatsAppInbound = input.whatsappInbound;
    if (typeof input.pushUpdates === "boolean") payload.googleAutoSyncPushUpdates = input.pushUpdates;
    if (typeof input.mode === "string") payload.googleAutoSyncMode = input.mode;

    await settingsService.upsertDocument({
        scopeType: "USER",
        scopeId: user.id,
        domain: SETTINGS_DOMAINS.USER_GOOGLE_INTEGRATIONS,
        payload,
        actorUserId: user.id,
        schemaVersion: 1,
    });

    if (isSettingsDualWriteLegacyEnabled()) {
        const updateData: Record<string, boolean | string> = {};
        if (typeof input.enabled === "boolean") updateData.googleAutoSyncEnabled = input.enabled;
        if (typeof input.leadCapture === "boolean") updateData.googleAutoSyncLeadCapture = input.leadCapture;
        if (typeof input.contactForm === "boolean") updateData.googleAutoSyncContactForm = input.contactForm;
        if (typeof input.whatsappInbound === "boolean") updateData.googleAutoSyncWhatsAppInbound = input.whatsappInbound;
        if (typeof input.pushUpdates === "boolean") updateData.googleAutoSyncPushUpdates = input.pushUpdates;
        if (typeof input.mode === "string") updateData.googleAutoSyncMode = input.mode;

        if (Object.keys(updateData).length > 0) {
            await db.user.update({
                where: { id: user.id },
                data: updateData,
            });
        }
    }

    if (isSettingsDualWriteLegacyEnabled() && isSettingsParityCheckEnabled()) {
        const legacyPayload = {
            ...buildGoogleSettingsPayload(user, {}),
        };
        if (typeof input.enabled === "boolean") legacyPayload.googleAutoSyncEnabled = input.enabled;
        if (typeof input.leadCapture === "boolean") legacyPayload.googleAutoSyncLeadCapture = input.leadCapture;
        if (typeof input.contactForm === "boolean") legacyPayload.googleAutoSyncContactForm = input.contactForm;
        if (typeof input.whatsappInbound === "boolean") legacyPayload.googleAutoSyncWhatsAppInbound = input.whatsappInbound;
        if (typeof input.pushUpdates === "boolean") legacyPayload.googleAutoSyncPushUpdates = input.pushUpdates;
        if (typeof input.mode === "string") legacyPayload.googleAutoSyncMode = input.mode;

        await settingsService.checkDocumentParity({
            scopeType: "USER",
            scopeId: user.id,
            domain: SETTINGS_DOMAINS.USER_GOOGLE_INTEGRATIONS,
            legacyPayload,
            actorUserId: user.id,
        });
    }

    revalidatePath("/admin/settings/integrations/google");
    return { success: true };
}

const updateGoogleTasklistSettingsSchema = z.object({
    tasklistId: z.string().trim().min(1).max(255),
    tasklistTitle: z.string().trim().max(255).optional().nullable()
});

export async function updateGoogleTasklistSettings(input: z.input<typeof updateGoogleTasklistSettingsSchema>) {
    const { user } = await resolveGoogleContext();

    const parsed = updateGoogleTasklistSettingsSchema.parse(input);

    const existingDoc = await settingsService.getDocument<any>({
        scopeType: "USER",
        scopeId: user.id,
        domain: SETTINGS_DOMAINS.USER_GOOGLE_INTEGRATIONS,
    });
    const payload = {
        ...buildGoogleSettingsPayload(user, existingDoc?.payload || {}),
        googleTasklistId: parsed.tasklistId,
        googleTasklistTitle: parsed.tasklistTitle || null,
    };

    await settingsService.upsertDocument({
        scopeType: "USER",
        scopeId: user.id,
        domain: SETTINGS_DOMAINS.USER_GOOGLE_INTEGRATIONS,
        payload,
        actorUserId: user.id,
        schemaVersion: 1,
    });

    if (isSettingsDualWriteLegacyEnabled()) {
        await db.user.update({
            where: { id: user.id },
            data: {
                googleTasklistId: parsed.tasklistId,
                googleTasklistTitle: parsed.tasklistTitle || null,
            },
        });
    }

    if (isSettingsDualWriteLegacyEnabled() && isSettingsParityCheckEnabled()) {
        await settingsService.checkDocumentParity({
            scopeType: "USER",
            scopeId: user.id,
            domain: SETTINGS_DOMAINS.USER_GOOGLE_INTEGRATIONS,
            legacyPayload: {
                ...buildGoogleSettingsPayload(user, {}),
                googleTasklistId: parsed.tasklistId,
                googleTasklistTitle: parsed.tasklistTitle || null,
            },
            actorUserId: user.id,
        });
    }

    revalidatePath("/admin/settings/integrations/google");
    return { success: true };
}

const updateGoogleCalendarSettingsSchema = z.object({
    calendarId: z.string().trim().min(1).max(255),
    calendarTitle: z.string().trim().max(255).optional().nullable()
});

export async function updateGoogleCalendarSettings(input: z.input<typeof updateGoogleCalendarSettingsSchema>) {
    const { user } = await resolveGoogleContext();

    const parsed = updateGoogleCalendarSettingsSchema.parse(input);

    const existingDoc = await settingsService.getDocument<any>({
        scopeType: "USER",
        scopeId: user.id,
        domain: SETTINGS_DOMAINS.USER_GOOGLE_INTEGRATIONS,
    });
    const payload = {
        ...buildGoogleSettingsPayload(user, existingDoc?.payload || {}),
        googleCalendarId: parsed.calendarId,
        googleCalendarTitle: parsed.calendarTitle || null,
    };

    await settingsService.upsertDocument({
        scopeType: "USER",
        scopeId: user.id,
        domain: SETTINGS_DOMAINS.USER_GOOGLE_INTEGRATIONS,
        payload,
        actorUserId: user.id,
        schemaVersion: 1,
    });

    if (isSettingsDualWriteLegacyEnabled()) {
        await db.user.update({
            where: { id: user.id },
            data: {
                googleCalendarId: parsed.calendarId,
                googleCalendarTitle: parsed.calendarTitle || null,
            },
        });
    }

    if (isSettingsDualWriteLegacyEnabled() && isSettingsParityCheckEnabled()) {
        await settingsService.checkDocumentParity({
            scopeType: "USER",
            scopeId: user.id,
            domain: SETTINGS_DOMAINS.USER_GOOGLE_INTEGRATIONS,
            legacyPayload: {
                ...buildGoogleSettingsPayload(user, {}),
                googleCalendarId: parsed.calendarId,
                googleCalendarTitle: parsed.calendarTitle || null,
            },
            actorUserId: user.id,
        });
    }

    revalidatePath("/admin/settings/integrations/google");
    return { success: true };
}
