import { GHL_CONFIG } from '@/config/ghl';
import { GHLTokenResponse, GHLUser } from './types';

export class GHLError extends Error {
    public status: number;
    public data: any;

    constructor(message: string, status: number, data: any) {
        super(message);
        this.name = 'GHLError';
        this.status = status;
        this.data = data;
    }
}

/**
 * Generic fetch wrapper for GoHighLevel API
 */
export async function ghlFetch<T>(
    endpoint: string,
    accessToken: string,
    options: RequestInit = {}
): Promise<T> {
    const url = endpoint.startsWith('http') ? endpoint : `${GHL_CONFIG.API_BASE_URL}${endpoint}`;

    const headers = {
        'Authorization': `Bearer ${accessToken}`,
        'Version': '2021-07-28',
        'Content-Type': 'application/json',
        ...options.headers,
    };

    // DEBUG: Scope/Auth Logging
    console.log(`[GHL DEBUG] Fetching: ${url}`);
    // console.log(`[GHL DEBUG] Headers:`, JSON.stringify(headers, null, 2)); // Careful with logging full keys

    const response = await fetch(url, {
        ...options,
        headers,
    });

    if (!response.ok) {
        let errorData;
        try {
            errorData = await response.json();
        } catch {
            errorData = await response.text();
        }

        console.error(`[GHL ERROR] Status: ${response.status} ${response.statusText}`);
        console.error(`[GHL ERROR] Endpoint: ${endpoint}`);
        console.error(`[GHL ERROR] Data:`, JSON.stringify(errorData, null, 2));

        if (response.status === 429) {
            console.warn('[GHL API] Rate limit exceeded');
            // TODO: Implement retry logic if needed
        }

        throw new GHLError(
            `GHL API Error: ${response.status} ${response.statusText}`,
            response.status,
            errorData
        );
    }

    // Handle 204 No Content
    if (response.status === 204) {
        return {} as T;
    }

    return await response.json() as T;
}

/**
 * Fetches user details from GoHighLevel API
 */
export async function getGHLUser(userId: string, accessToken: string): Promise<GHLUser | null> {
    try {
        return await ghlFetch<GHLUser>(`/users/${userId}`, accessToken);
    } catch (error) {
        console.error(`[GHL API] Failed to fetch user ${userId}:`, error);
        return null;
    }
}

export { ghlFetchWithAuth } from './token';
