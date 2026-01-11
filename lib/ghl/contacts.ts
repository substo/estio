import { ghlFetch } from './client';

export interface GHLContact {
    id: string;
    name: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    locationId: string;
    dateAdded?: string;
    dateUpdated?: string;
    type?: string;
    tags?: string[];
    customFields?: Array<{
        id: string;
        value: any;
    }>;
}

export interface GHLContactsResponse {
    contacts: GHLContact[];
    meta: {
        total: number;
        nextPageUrl?: string;
        startAfterId?: string;
        startAfter?: number;
    };
}

export interface GHLContactResponse {
    contact: GHLContact;
}

/**
 * Fetch a single contact from GHL by ID
 */
export async function getContact(accessToken: string, contactId: string): Promise<GHLContactResponse> {
    return ghlFetch<GHLContactResponse>(`/contacts/${contactId}`, accessToken);
}

/**
 * Search contacts in GHL
 */
export async function searchContacts(accessToken: string, query: string): Promise<GHLContactsResponse> {
    return ghlFetch<GHLContactsResponse>(`/contacts/?query=${encodeURIComponent(query)}`, accessToken);
}
