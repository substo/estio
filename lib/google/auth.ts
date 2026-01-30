
import { google } from 'googleapis';
import db from '@/lib/db';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const DEFAULT_BASE_URL = process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://estio.co';

export const createOAuth2Client = (baseUrl?: string) => {
    const root = baseUrl || DEFAULT_BASE_URL;
    // Ensure no double slash if root ends with /
    const cleanRoot = root.replace(/\/$/, "");
    return new google.auth.OAuth2(
        CLIENT_ID,
        CLIENT_SECRET,
        `${cleanRoot}/api/google/callback`
    );
};

export function getGoogleAuthUrl(baseUrl?: string) {
    const scopes = [
        'https://www.googleapis.com/auth/contacts',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/gmail.labels',
        'https://www.googleapis.com/auth/gmail.modify',
    ];

    const client = createOAuth2Client(baseUrl);
    return client.generateAuthUrl({
        access_type: 'offline', // Crucial for refresh token
        scope: scopes,
        prompt: 'consent' // Force consent to ensure we get a refresh token
    });
}

export async function handleGoogleCallback(code: string, userId: string, baseUrl?: string) {
    const client = createOAuth2Client(baseUrl);
    const { tokens } = await client.getToken(code);

    if (!tokens.access_token) throw new Error('Failed to retrieve access token');

    // Save tokens to DB
    await db.user.update({
        where: { id: userId },
        data: {
            googleAccessToken: tokens.access_token,
            googleRefreshToken: tokens.refresh_token, // Only present on first consent or forced consent
            googleSyncEnabled: true,
        }
    });

    client.setCredentials(tokens);
    client.setCredentials(tokens);

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
    const user = await db.user.findUnique({
        where: { id: userId },
        select: { googleAccessToken: true, googleRefreshToken: true }
    });

    if (!user || (!user.googleAccessToken && !user.googleRefreshToken)) {
        throw new Error('User not connected to Google');
    }

    // Refresh uses the same client creds, redirect URI doesn't matter as much for refresh
    // but best to keep it consistent if possible, though we don't know the original Base URL here easily.
    // For refresh, Redirect URI is not sent.
    const client = createOAuth2Client();
    client.setCredentials({
        access_token: user.googleAccessToken,
        refresh_token: user.googleRefreshToken || undefined
    });

    // Handle token refresh events for this specific client instance
    client.on('tokens', async (tokens) => {
        if (tokens.access_token) {
            await db.user.update({
                where: { id: userId },
                data: {
                    googleAccessToken: tokens.access_token,
                    // Only update refresh token if a new one is returned
                    ...(tokens.refresh_token && { googleRefreshToken: tokens.refresh_token })
                }
            });
        }
    });

    // Return the client ready to use
    return client;
}
