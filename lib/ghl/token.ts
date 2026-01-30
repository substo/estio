import db from '@/lib/db';
import { GHL_CONFIG } from '@/config/ghl';
import { GHLTokenResponse } from './types';

/**
 * Retrieves a valid access token for the given location.
 * Automatically refreshes the token if it is expired or about to expire.
 */
export async function getAccessToken(locationId: string): Promise<string | null> {
    const location = await db.location.findUnique({
        where: { ghlLocationId: locationId },
    });

    if (!location) {
        console.error(`[GHL Auth Debug] Location not found: ${locationId}`);
        return null;
    }

    // DEBUG: Log token state
    console.log(`[GHL Auth Debug] Token check for ${locationId}: Access=${!!location.ghlAccessToken}, Refresh=${!!location.ghlRefreshToken}`);

    if (!location.ghlAccessToken || !location.ghlRefreshToken) {
        console.error(`[GHL Auth] No tokens found for location: ${locationId}`);
        return null;
    }

    // Check expiry (with 60s buffer)
    const now = new Date();
    const expiresAt = location.ghlExpiresAt ? new Date(location.ghlExpiresAt) : new Date(0);
    const bufferMs = 60 * 1000;

    if (expiresAt.getTime() - now.getTime() > bufferMs) {
        return location.ghlAccessToken;
    }

    console.log(`[GHL Auth] Token expired or expiring soon for ${locationId}. Refreshing...`);
    return await refreshAccessToken(locationId, location.ghlRefreshToken);
}

/**
 * Refreshes the access token using the refresh token.
 * Implements basic locking/concurrency safety by checking if the token was recently updated.
 */
async function refreshAccessToken(locationId: string, currentRefreshToken: string): Promise<string | null> {
    // Double-check DB to ensure we aren't overwriting a fresh token from another process
    const freshLocation = await db.location.findUnique({
        where: { ghlLocationId: locationId },
    });

    if (!freshLocation) return null;

    // If the token in DB is different from what we passed in, someone else might have refreshed it.
    // Or if the expiry is now in the future.
    const now = new Date();
    const expiresAt = freshLocation.ghlExpiresAt ? new Date(freshLocation.ghlExpiresAt) : new Date(0);
    if (expiresAt.getTime() - now.getTime() > 60 * 1000) {
        console.log(`[GHL Auth] Token was already refreshed by another process. Using new token.`);
        return freshLocation.ghlAccessToken;
    }

    try {
        const params = new URLSearchParams();
        params.append('client_id', process.env.GHL_CLIENT_ID!);
        params.append('client_secret', process.env.GHL_CLIENT_SECRET!);
        params.append('grant_type', 'refresh_token');
        params.append('refresh_token', freshLocation.ghlRefreshToken!); // Use the one from DB to be safe

        const response = await fetch(`${GHL_CONFIG.API_BASE_URL}${GHL_CONFIG.ENDPOINTS.TOKEN}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: params,
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[GHL Auth] Refresh failed: ${response.status} ${errorText}`);
            return null;
        }

        const data: GHLTokenResponse = await response.json();

        // Update DB
        await db.location.update({
            where: { id: freshLocation.id }, // Use internal ID for safety
            data: {
                ghlAccessToken: data.access_token,
                ghlRefreshToken: data.refresh_token,
                ghlExpiresAt: new Date(Date.now() + data.expires_in * 1000),
                ghlTokenType: data.token_type,
            },
        });

        console.log(`[GHL Auth] Token refreshed successfully for ${locationId}`);
        return data.access_token;

    } catch (error) {
        console.error(`[GHL Auth] Refresh error:`, error);
        return null;
    }
}

/**
 * Wrapper for GHL API calls that handles authentication, token refreshing, and retries.
 */
export async function ghlFetchWithAuth<T>(
    locationId: string,
    endpoint: string,
    options: RequestInit = {}
): Promise<T> {
    let accessToken = await getAccessToken(locationId);

    if (!accessToken) {
        throw new Error(`[GHL Auth] Failed to obtain access token for ${locationId}`);
    }

    const url = endpoint.startsWith('http') ? endpoint : `${GHL_CONFIG.API_BASE_URL}${endpoint}`;

    const makeRequest = async (token: string) => {
        return fetch(url, {
            ...options,
            headers: {
                ...options.headers,
                'Authorization': `Bearer ${token}`,
                'Version': '2021-07-28',
                'Content-Type': 'application/json',
            },
        });
    };

    let response = await makeRequest(accessToken);

    // Handle 401 Unauthorized (Token might have been revoked or expired despite our check)
    if (response.status === 401) {
        console.warn(`[GHL Auth] 401 Unauthorized for ${endpoint}. Forcing refresh...`);

        // Force refresh by passing the *current* refresh token we know about (or just letting the function re-fetch)
        // We'll call refreshAccessToken directly with the current DB state
        const location = await db.location.findUnique({ where: { ghlLocationId: locationId } });
        if (location?.ghlRefreshToken) {
            const newToken = await refreshAccessToken(locationId, location.ghlRefreshToken);
            if (newToken) {
                accessToken = newToken;
                // Retry request
                response = await makeRequest(accessToken);
            }
        }
    }

    if (!response.ok) {
        let errorData;
        try {
            errorData = await response.json();
        } catch {
            errorData = await response.text();
        }

        const errorMessage = JSON.stringify(errorData);
        if (errorMessage.includes("authorized for this scope")) {
            console.error(`[GHL Auth CRITICAL] Token lacks required scopes for ${endpoint}. User must re-authenticate.`);
            throw new Error(`GHL Scope Error: The current token does not have permission for this action. Please re-authenticate via the One-Time Setup page.`);
        }

        throw new Error(`GHL API Error: ${response.status} ${errorMessage}`);
    }

    if (response.status === 204) {
        return {} as T;
    }

    return await response.json() as T;
}
