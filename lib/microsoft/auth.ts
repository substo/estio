import { Client } from '@microsoft/microsoft-graph-client';
import { randomUUID } from 'crypto';
import db from '@/lib/db';
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

    // Tokens: access_token, refresh_token, expires_in (seconds)
    // Save to DB
    await db.user.update({
        where: { id: userId },
        data: {
            outlookAccessToken: tokens.access_token,
            outlookRefreshToken: tokens.refresh_token,
            outlookSyncEnabled: true,
            // We can also trigger the initial sync here or let the user do it
        }
    });

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
            await db.user.update({
                where: { id: userId },
                data: { outlookSyncEnabled: false } // Session expired
            });
        }
        throw new Error(`Failed to refresh token: ${response.statusText}`);
    }

    const tokens = await response.json();

    // Update DB
    await db.user.update({
        where: { id: userId },
        data: {
            outlookAccessToken: tokens.access_token,
            outlookRefreshToken: tokens.refresh_token || refreshToken, // specific: sometimes refresh token is rotated, sometimes not
        }
    });

    return tokens.access_token;
}
