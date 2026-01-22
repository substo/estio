
import { google } from 'googleapis';
import db from '@/lib/db';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = `${process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://estio.co'}/api/google/callback`;

export const createOAuth2Client = () => new google.auth.OAuth2(
    CLIENT_ID,
    CLIENT_SECRET,
    REDIRECT_URI
);

export function getGoogleAuthUrl() {
    const scopes = [
        'https://www.googleapis.com/auth/contacts',
        'https://www.googleapis.com/auth/userinfo.email',
    ];

    const client = createOAuth2Client();
    return client.generateAuthUrl({
        access_type: 'offline', // Crucial for refresh token
        scope: scopes,
        prompt: 'consent' // Force consent to ensure we get a refresh token
    });
}

export async function handleGoogleCallback(code: string, userId: string) {
    const client = createOAuth2Client();
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
