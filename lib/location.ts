import db from './db';
import { GHL_CONFIG } from '@/config/ghl';

export async function getLocationByGhlContext(ghlAgencyId: string, ghlLocationId: string | null) {
    if (!ghlAgencyId) return null;

    const where = ghlLocationId
        ? { ghlLocationId }
        : { ghlAgencyId };

    return db.location.findFirst({
        where,
    });
}

export async function getLocationById(id: string) {
    return db.location.findUnique({
        where: { id },
    });
}

export async function refreshGhlAccessToken(location: any) {
    // Check if token is expired or about to expire (e.g. within 5 mins)
    const now = new Date();
    const expiresAt = location.ghlExpiresAt ? new Date(location.ghlExpiresAt) : null;

    if (expiresAt && expiresAt.getTime() - now.getTime() > 5 * 60 * 1000) {
        return location;
    }

    if (!location.ghlRefreshToken) {
        throw new Error("No refresh token available");
    }

    // Do NOT strip suffix from Client ID. Use exact value from Env.
    const clientId = process.env.GHL_CLIENT_ID;

    const params = new URLSearchParams();
    params.append('client_id', clientId!);
    params.append('client_secret', process.env.GHL_CLIENT_SECRET!);
    params.append('grant_type', 'refresh_token');
    params.append('refresh_token', location.ghlRefreshToken);

    const response = await fetch(`${GHL_CONFIG.API_BASE_URL}${GHL_CONFIG.ENDPOINTS.TOKEN}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params,
    });

    if (!response.ok) {
        const error = await response.text();
        console.error("Failed to refresh GHL token", error);
        throw new Error("Failed to refresh GHL token");
    }

    const data = await response.json();

    const updatedLocation = await db.location.update({
        where: { id: location.id },
        data: {
            ghlAccessToken: data.access_token,
            ghlRefreshToken: data.refresh_token,
            ghlExpiresAt: new Date(Date.now() + data.expires_in * 1000),
            ghlTokenType: data.token_type,
        },
    });

    return updatedLocation;
}
