
import { google } from 'googleapis';
import db from '@/lib/db';
import { settingsService } from '@/lib/settings/service';
import {
    SETTINGS_DOMAINS,
    SETTINGS_SECRET_KEYS,
    isSettingsDualWriteLegacyEnabled,
} from '@/lib/settings/constants';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const DEFAULT_BASE_URL = process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://estio.co';

export const createOAuth2Client = (baseUrl?: string) => {
    if (!CLIENT_ID || !CLIENT_SECRET) {
        throw new Error("Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET.");
    }

    const root = baseUrl || DEFAULT_BASE_URL;
    // Ensure no double slash if root ends with /
    const cleanRoot = root.replace(/\/$/, "");
    return new google.auth.OAuth2(
        CLIENT_ID,
        CLIENT_SECRET,
        `${cleanRoot}/api/google/callback`
    );
};

export function getGoogleAuthUrl(baseUrl?: string, state?: string) {
    const scopes = [
        'https://www.googleapis.com/auth/contacts',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/gmail.labels',
        'https://www.googleapis.com/auth/gmail.modify',
        'https://www.googleapis.com/auth/calendar',              // Phase 4: Calendar access
        'https://www.googleapis.com/auth/calendar.events',       // Phase 4: Event management
        'https://www.googleapis.com/auth/tasks',                 // Contact task hub sync
        'https://www.googleapis.com/auth/tasks.readonly',
    ];

    const client = createOAuth2Client(baseUrl);
    return client.generateAuthUrl({
        access_type: 'offline', // Crucial for refresh token
        scope: scopes,
        prompt: 'consent', // Force consent to ensure we get a refresh token
        state,
    });
}

export async function handleGoogleCallback(code: string, userId: string, baseUrl?: string) {
    const client = createOAuth2Client(baseUrl);
    const { tokens } = await client.getToken(code);

    if (!tokens.access_token) throw new Error('Failed to retrieve access token');

    const user = await db.user.findUnique({
        where: { id: userId },
        select: {
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
        }
    });
    if (!user) {
        throw new Error("User not found");
    }

    await settingsService.upsertDocument({
        scopeType: "USER",
        scopeId: userId,
        domain: SETTINGS_DOMAINS.USER_GOOGLE_INTEGRATIONS,
        payload: {
            googleSyncEnabled: true,
            googleSyncDirection: user.googleSyncDirection ?? null,
            googleAutoSyncEnabled: user.googleAutoSyncEnabled ?? false,
            googleAutoSyncLeadCapture: user.googleAutoSyncLeadCapture ?? false,
            googleAutoSyncContactForm: user.googleAutoSyncContactForm ?? false,
            googleAutoSyncWhatsAppInbound: user.googleAutoSyncWhatsAppInbound ?? false,
            googleAutoSyncMode: user.googleAutoSyncMode ?? "LINK_ONLY",
            googleAutoSyncPushUpdates: user.googleAutoSyncPushUpdates ?? false,
            googleTasklistId: user.googleTasklistId ?? null,
            googleTasklistTitle: user.googleTasklistTitle ?? null,
            googleCalendarId: user.googleCalendarId ?? null,
            googleCalendarTitle: user.googleCalendarTitle ?? null,
        },
        actorUserId: userId,
        schemaVersion: 1,
    });
    await settingsService.setSecret({
        scopeType: "USER",
        scopeId: userId,
        domain: SETTINGS_DOMAINS.USER_GOOGLE_INTEGRATIONS,
        secretKey: SETTINGS_SECRET_KEYS.GOOGLE_ACCESS_TOKEN,
        plaintext: tokens.access_token,
        actorUserId: userId,
    });
    if (tokens.refresh_token) {
        await settingsService.setSecret({
            scopeType: "USER",
            scopeId: userId,
            domain: SETTINGS_DOMAINS.USER_GOOGLE_INTEGRATIONS,
            secretKey: SETTINGS_SECRET_KEYS.GOOGLE_REFRESH_TOKEN,
            plaintext: tokens.refresh_token,
            actorUserId: userId,
        });
    }

    if (isSettingsDualWriteLegacyEnabled()) {
        // Save tokens to legacy columns for compatibility during migration window.
        await db.user.update({
            where: { id: userId },
            data: {
                googleAccessToken: tokens.access_token,
                googleRefreshToken: tokens.refresh_token, // Only present on first consent or forced consent
                googleSyncEnabled: true,
            }
        });
    } else {
        await db.user.update({
            where: { id: userId },
            data: {
                googleSyncEnabled: true,
            }
        });
    }

    client.setCredentials({
        access_token: tokens.access_token || undefined,
        refresh_token: tokens.refresh_token || undefined,
    });

    // Start Watching immediately
    // Import dynamically to avoid circular dep if needed, or just import at top if clean.
    // Assuming circular dep might exist if gmail-sync imports auth. 
    // Let's retry lazy import.
    try {
        const { watchGmail, syncRecentMessages } = await import('./gmail-sync');
        // Run initial sync to populate historyId and Email Address
        await syncRecentMessages(userId);
        // Then Start Watch
        await watchGmail(userId);
    } catch (e) {
        console.error("Failed to initialize Gmail Sync on callback:", e);
    }

    return tokens;
}

export async function getValidAccessToken(userId: string) {
    const [user, newAccessToken, newRefreshToken] = await Promise.all([
        db.user.findUnique({
        where: { id: userId },
        select: { googleAccessToken: true, googleRefreshToken: true }
        }),
        settingsService.getSecret({
            scopeType: "USER",
            scopeId: userId,
            domain: SETTINGS_DOMAINS.USER_GOOGLE_INTEGRATIONS,
            secretKey: SETTINGS_SECRET_KEYS.GOOGLE_ACCESS_TOKEN,
        }).catch(() => null),
        settingsService.getSecret({
            scopeType: "USER",
            scopeId: userId,
            domain: SETTINGS_DOMAINS.USER_GOOGLE_INTEGRATIONS,
            secretKey: SETTINGS_SECRET_KEYS.GOOGLE_REFRESH_TOKEN,
        }).catch(() => null),
    ]);

    const accessToken = newAccessToken || user?.googleAccessToken || null;
    const refreshToken = newRefreshToken || user?.googleRefreshToken || null;

    if (!user || (!accessToken && !refreshToken)) {
        throw new Error('User not connected to Google');
    }

    // Refresh uses the same client creds, redirect URI doesn't matter as much for refresh
    // but best to keep it consistent if possible, though we don't know the original Base URL here easily.
    // For refresh, Redirect URI is not sent.
    const client = createOAuth2Client();
    client.setCredentials({
        access_token: accessToken || undefined,
        refresh_token: refreshToken || undefined
    });

    // Handle token refresh events for this specific client instance
    client.on('tokens', async (tokens) => {
        if (tokens.access_token) {
            await settingsService.setSecret({
                scopeType: "USER",
                scopeId: userId,
                domain: SETTINGS_DOMAINS.USER_GOOGLE_INTEGRATIONS,
                secretKey: SETTINGS_SECRET_KEYS.GOOGLE_ACCESS_TOKEN,
                plaintext: tokens.access_token,
                actorUserId: userId,
            });
            if (tokens.refresh_token) {
                await settingsService.setSecret({
                    scopeType: "USER",
                    scopeId: userId,
                    domain: SETTINGS_DOMAINS.USER_GOOGLE_INTEGRATIONS,
                    secretKey: SETTINGS_SECRET_KEYS.GOOGLE_REFRESH_TOKEN,
                    plaintext: tokens.refresh_token,
                    actorUserId: userId,
                });
            }

            if (isSettingsDualWriteLegacyEnabled()) {
                await db.user.update({
                    where: { id: userId },
                    data: {
                        googleAccessToken: tokens.access_token,
                        ...(tokens.refresh_token && { googleRefreshToken: tokens.refresh_token })
                    }
                });
            }
        }
    });

    // Return the client ready to use
    return client;
}
