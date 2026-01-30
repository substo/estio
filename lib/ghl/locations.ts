
import { ghlFetch } from './client';

export interface GHLLocationDetails {
    id: string;
    name: string;
    email?: string;
    phone?: string;
    address?: string;
    city?: string;
    state?: string;
    country?: string;
    postalCode?: string;
    website?: string;
    timezone?: string;
    firstName?: string;
    lastName?: string;
}

export interface GHLLocationResponse {
    location: GHLLocationDetails;
}

/**
 * Fetch a single location from GHL by ID
 */
export async function getLocation(accessToken: string, locationId: string): Promise<GHLLocationResponse> {
    return ghlFetch<GHLLocationResponse>(`/locations/${locationId}`, accessToken);
}
