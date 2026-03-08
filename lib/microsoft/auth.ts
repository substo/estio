import { Client } from '@microsoft/microsoft-graph-client';
import { randomUUID } from 'crypto';
import db from '@/lib/db';
import { settingsService } from '@/lib/settings/service';
import {
    SETTINGS_DOMAINS,
    SETTINGS_SECRET_KEYS,
    isSettingsDualWriteLegacyEnabled,
} from '@/lib/settings/constants';
import 'isomorphic-fetch';

const CLIENT_ID = process.env.MICROSOFT_CLIENT_ID;
const CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET;
const TOKEN_ENDPOINT = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const AUTH_ENDPOINT = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';

// Scopes required for the application
const SCOPES = [
    'offline_access',
    'User.Read',
    'Mail.ReadWrite',
    'Mail.Send',
    'Contacts.ReadWrite'
];

/**
 * Generates the Microsoft OAuth Authorization URL
 */
export function getMicrosoftAuthUrl(baseUrl: string, userId?: string): string {
    if (!CLIENT_ID) throw new Error('MICROSOFT_CLIENT_ID is not defined');

    const redirectUri = `${baseUrl}/api/microsoft/callback`;

    // Generate cryptographically secure state for CSRF protection
    // Optionally include userId for post-auth context (base64 encoded)
    const statePayload = JSON.stringify({
        nonce: randomUUID(),
        userId: userId || null,
        timestamp: Date.now()
    });
    const state = Buffer.from(statePayload).toString('base64url');

    const params = new URLSearchParams({
        client_id: CLIENT_ID,
        response_type: 'code',
        redirect_uri: redirectUri,
        response_mode: 'query',
        scope: SCOPES.join(' '),
        state,
        prompt: 'consent' // Ensure we get a refresh token
    });

    return `${AUTH_ENDPOINT}?${params.toString()}`;
}

/**
 * Exchanges authorization code for tokens
 */
export async function handleMicrosoftCallback(code: string, userId: string, baseUrl: string) {
    if (!CLIENT_ID || !CLIENT_SECRET) {
        throw new Error('Missing Microsoft Credentials');
    }

    const redirectUri = `${baseUrl}/api/microsoft/callback`;

    // Exchange code for tokens
    const body = new URLSearchParams({
        client_id: CLIENT_ID,
        scope: SCOPES.join(' '),
        code: code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        client_secret: CLIENT_SECRET,
    });

    const response = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: body.toString()
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error('Microsoft Token Error:', errorText);
        throw new Error(`Failed to exchange code: ${response.statusText}`);
    }

    const tokens = await response.json();

    const user = await db.user.findUnique({
        where: { id: userId },
        select: {
            outlookSubscriptionId: true,
            outlookSubscriptionExpiry: true,
            outlookEmail: true,
            outlookSessionExpiry: true,
        }
    });
    if (!user) {
        throw new Error("User not found");
    }

    await settingsService.upsertDocument({
        scopeType: "USER",
        scopeId: userId,
        domain: SETTINGS_DOMAINS.USER_MICROSOFT_INTEGRATIONS,
        payload: {
            outlookSyncEnabled: true,
            outlookSubscriptionId: user.outlookSubscriptionId ?? null,
            outlookSubscriptionExpiry: user.outlookSubscriptionExpiry
                ? user.outlookSubscriptionExpiry.toISOString()
                : null,
            outlookAuthMethod: "oauth",
            outlookEmail: user.outlookEmail ?? null,
            outlookSessionExpiry: user.outlookSessionExpiry
                ? user.outlookSessionExpiry.toISOString()
                : null,
        },
        actorUserId: userId,
        schemaVersion: 1,
    });
    await settingsService.setSecret({
        scopeType: "USER",
        scopeId: userId,
        domain: SETTINGS_DOMAINS.USER_MICROSOFT_INTEGRATIONS,
        secretKey: SETTINGS_SECRET_KEYS.OUTLOOK_ACCESS_TOKEN,
        plaintext: tokens.access_token,
        actorUserId: userId,
    });
    if (tokens.refresh_token) {
        await settingsService.setSecret({
            scopeType: "USER",
            scopeId: userId,
            domain: SETTINGS_DOMAINS.USER_MICROSOFT_INTEGRATIONS,
            secretKey: SETTINGS_SECRET_KEYS.OUTLOOK_REFRESH_TOKEN,
            plaintext: tokens.refresh_token,
            actorUserId: userId,
        });
    }

    if (isSettingsDualWriteLegacyEnabled()) {
        // Save to legacy columns for compatibility during migration window.
        await db.user.update({
            where: { id: userId },
            data: {
                outlookAccessToken: tokens.access_token,
                outlookRefreshToken: tokens.refresh_token,
                outlookAuthMethod: 'oauth',
                outlookSyncEnabled: true,
            }
        });
    } else {
        await db.user.update({
            where: { id: userId },
            data: {
                outlookAuthMethod: 'oauth',
                outlookSyncEnabled: true,
            }
        });
    }

    // Optional: Trigger Initial Sync via Queue or return success
    console.log(`Microsoft Auth Success for User ${userId}`);
    return tokens;
}

/**
 * Refreshes the Access Token using the Refresh Token
 */
export async function refreshMicrosoftToken(userId: string, refreshToken: string) {
    if (!CLIENT_ID || !CLIENT_SECRET) {
        throw new Error('Missing Microsoft Credentials');
    }

    const body = new URLSearchParams({
        client_id: CLIENT_ID,
        scope: SCOPES.join(' '),
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
        client_secret: CLIENT_SECRET,
    });

    const response = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: body.toString()
    });

    if (!response.ok) {
        // If refresh fails (e.g. revoked), we should update the user status
        if (response.status === 400 || response.status === 401) {
            const existingDoc = await settingsService.getDocument<any>({
                scopeType: "USER",
                scopeId: userId,
                domain: SETTINGS_DOMAINS.USER_MICROSOFT_INTEGRATIONS,
            });
            await settingsService.upsertDocument({
                scopeType: "USER",
                scopeId: userId,
                domain: SETTINGS_DOMAINS.USER_MICROSOFT_INTEGRATIONS,
                payload: {
                    ...(existingDoc?.payload || {}),
                    outlookSyncEnabled: false,
                },
                actorUserId: userId,
                schemaVersion: 1,
            });
            await db.user.update({
                where: { id: userId },
                data: { outlookSyncEnabled: false } // Session expired
            });
        }
        throw new Error(`Failed to refresh token: ${response.statusText}`);
    }

    const tokens = await response.json();

    const nextRefreshToken = tokens.refresh_token || refreshToken;

    await settingsService.setSecret({
        scopeType: "USER",
        scopeId: userId,
        domain: SETTINGS_DOMAINS.USER_MICROSOFT_INTEGRATIONS,
        secretKey: SETTINGS_SECRET_KEYS.OUTLOOK_ACCESS_TOKEN,
        plaintext: tokens.access_token,
        actorUserId: userId,
    });
    await settingsService.setSecret({
        scopeType: "USER",
        scopeId: userId,
        domain: SETTINGS_DOMAINS.USER_MICROSOFT_INTEGRATIONS,
        secretKey: SETTINGS_SECRET_KEYS.OUTLOOK_REFRESH_TOKEN,
        plaintext: nextRefreshToken,
        actorUserId: userId,
    });

    if (isSettingsDualWriteLegacyEnabled()) {
        await db.user.update({
            where: { id: userId },
            data: {
                outlookAccessToken: tokens.access_token,
                outlookRefreshToken: nextRefreshToken,
            }
        });
    }

    return tokens.access_token;
}
