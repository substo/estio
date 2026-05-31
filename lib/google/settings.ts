import db from "@/lib/db";
import { settingsService } from "@/lib/settings/service";
import {
    SETTINGS_DOMAINS,
    isSettingsDualWriteLegacyEnabled,
    isSettingsParityCheckEnabled,
    isSettingsReadFromNewEnabled,
} from "@/lib/settings/constants";

export type GoogleAutoSyncMode = "LINK_ONLY" | "LINK_OR_CREATE";

export type GoogleIntegrationSettings = {
    googleSyncEnabled: boolean;
    googleSyncDirection: string | null;
    googleAutoSyncEnabled: boolean;
    googleAutoSyncLeadCapture: boolean;
    googleAutoSyncContactForm: boolean;
    googleAutoSyncWhatsAppInbound: boolean;
    googleAutoSyncMode: GoogleAutoSyncMode;
    googleAutoSyncPushUpdates: boolean;
    googleTasklistId: string | null;
    googleTasklistTitle: string | null;
    googleCalendarId: string | null;
    googleCalendarTitle: string | null;
};

export type GoogleIntegrationLegacyUser = {
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

export const googleIntegrationSettingsSelect = {
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
} as const;

function toGoogleAutoSyncMode(value: string | null | undefined): GoogleAutoSyncMode {
    return value === "LINK_OR_CREATE" ? "LINK_OR_CREATE" : "LINK_ONLY";
}

export function buildGoogleIntegrationSettings(
    user: GoogleIntegrationLegacyUser,
    existing?: Partial<GoogleIntegrationSettings> | null
): GoogleIntegrationSettings {
    return {
        googleSyncEnabled: existing?.googleSyncEnabled ?? user.googleSyncEnabled ?? false,
        googleSyncDirection: existing?.googleSyncDirection ?? user.googleSyncDirection ?? null,
        googleAutoSyncEnabled: existing?.googleAutoSyncEnabled ?? user.googleAutoSyncEnabled ?? false,
        googleAutoSyncLeadCapture: existing?.googleAutoSyncLeadCapture ?? user.googleAutoSyncLeadCapture ?? false,
        googleAutoSyncContactForm: existing?.googleAutoSyncContactForm ?? user.googleAutoSyncContactForm ?? false,
        googleAutoSyncWhatsAppInbound: existing?.googleAutoSyncWhatsAppInbound ?? user.googleAutoSyncWhatsAppInbound ?? false,
        googleAutoSyncMode: toGoogleAutoSyncMode(existing?.googleAutoSyncMode ?? user.googleAutoSyncMode),
        googleAutoSyncPushUpdates: existing?.googleAutoSyncPushUpdates ?? user.googleAutoSyncPushUpdates ?? false,
        googleTasklistId: existing?.googleTasklistId ?? user.googleTasklistId ?? null,
        googleTasklistTitle: existing?.googleTasklistTitle ?? user.googleTasklistTitle ?? null,
        googleCalendarId: existing?.googleCalendarId ?? user.googleCalendarId ?? null,
        googleCalendarTitle: existing?.googleCalendarTitle ?? user.googleCalendarTitle ?? null,
    };
}

export async function getGoogleIntegrationSettingsForRead(user: GoogleIntegrationLegacyUser) {
    if (!isSettingsReadFromNewEnabled()) {
        return buildGoogleIntegrationSettings(user);
    }

    const doc = await settingsService.getDocument<Partial<GoogleIntegrationSettings>>({
        scopeType: "USER",
        scopeId: user.id,
        domain: SETTINGS_DOMAINS.USER_GOOGLE_INTEGRATIONS,
    });

    return buildGoogleIntegrationSettings(user, doc?.payload);
}

function stripUndefined<T extends object>(value: T): Partial<T> {
    return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).filter(([, entryValue]) => entryValue !== undefined)
    ) as Partial<T>;
}

export async function updateGoogleIntegrationSettings(input: {
    user: GoogleIntegrationLegacyUser;
    patch: Partial<GoogleIntegrationSettings>;
    legacyData?: Record<string, boolean | string | null | undefined>;
}) {
    const patch = stripUndefined(input.patch);
    const existingDoc = await settingsService.getDocument<Partial<GoogleIntegrationSettings>>({
        scopeType: "USER",
        scopeId: input.user.id,
        domain: SETTINGS_DOMAINS.USER_GOOGLE_INTEGRATIONS,
    });
    const existingPayload = existingDoc?.payload || {};
    const payload = {
        ...existingPayload,
        ...buildGoogleIntegrationSettings(input.user, existingPayload),
        ...patch,
    };

    await settingsService.upsertDocument({
        scopeType: "USER",
        scopeId: input.user.id,
        domain: SETTINGS_DOMAINS.USER_GOOGLE_INTEGRATIONS,
        payload,
        actorUserId: input.user.id,
        schemaVersion: 1,
    });

    const legacyData = stripUndefined(input.legacyData || {});
    if (isSettingsDualWriteLegacyEnabled() && Object.keys(legacyData).length > 0) {
        await db.user.update({
            where: { id: input.user.id },
            data: legacyData as Record<string, boolean | string | null>,
        });
    }

    if (isSettingsDualWriteLegacyEnabled() && isSettingsParityCheckEnabled()) {
        await settingsService.checkDocumentParity({
            scopeType: "USER",
            scopeId: input.user.id,
            domain: SETTINGS_DOMAINS.USER_GOOGLE_INTEGRATIONS,
            legacyPayload: {
                ...buildGoogleIntegrationSettings(input.user),
                ...patch,
            },
            actorUserId: input.user.id,
        });
    }
}
