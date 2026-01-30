import { ghlFetchWithAuth } from './token';
import { GHLUser } from './types';

/**
 * Creates a new user in GoHighLevel
 */
export async function createGHLUser(
    locationId: string,
    userData: {
        firstName: string;
        lastName: string;
        email: string;
        password?: string;
        type?: 'employee' | 'account_admin' | 'agency_admin' | 'agency_user';
        role?: 'user' | 'admin';
    }
): Promise<GHLUser> {
    const payload = {
        firstName: userData.firstName,
        lastName: userData.lastName,
        email: userData.email,
        password: userData.password || 'TempPass123!',
        type: userData.type || 'account_user', // Changed from 'employee' to 'account_user'
        role: userData.role || 'user',
        locationIds: [locationId]
    };

    console.log('[GHL Create User] Sending payload:', JSON.stringify(payload, null, 2));

    try {
        const result = await ghlFetchWithAuth<GHLUser>(locationId, '/users/', {
            method: 'POST',
            body: JSON.stringify(payload),
        });
        console.log('[GHL Create User] Success:', result);
        return result;
    } catch (error) {
        console.error('[GHL Create User] Failed:', error);
        throw error;
    }
}

/**
 * Search for users in GHL
 * Note: GHL V2 API for searching users can be tricky; mostly relies on 'lookup' or filtering list.
 * We'll use the list endpoint with a query if supported, or fetch list and filter.
 */
export async function searchGHLUsers(
    locationId: string,
    query: string
): Promise<GHLUser[]> {
    // Try to search by v2/users/search or just v2/users/
    // The Standard V2 API for users usually supports locationId as a filter
    const response = await ghlFetchWithAuth<{ users: GHLUser[] }>(
        locationId,
        `/users/?locationId=${locationId}&query=${encodeURIComponent(query)}`
    );

    return response.users || [];
}

/**
 * Updates an existing user in GoHighLevel
 */
export async function updateGHLUser(
    locationId: string,
    userId: string,
    userData: {
        firstName?: string;
        lastName?: string;
        phone?: string;
        email?: string;
    }
): Promise<GHLUser> {
    const payload = {
        firstName: userData.firstName,
        lastName: userData.lastName,
        phone: userData.phone,
        email: userData.email,
    };

    console.log(`[GHL Update User] Updating user ${userId}:`, JSON.stringify(payload, null, 2));

    try {
        const result = await ghlFetchWithAuth<GHLUser>(locationId, `/users/${userId}`, {
            method: 'PUT',
            body: JSON.stringify(payload),
        });
        console.log('[GHL Update User] Success:', result);
        return result;
    } catch (error) {
        console.error('[GHL Update User] Failed:', error);
        throw error;
    }
}

/**
 * Removes a user from a specific GHL Location.
 * Rely on DELETE /users/{userId}.
 */
export async function removeGHLUserFromLocation(
    locationId: string,
    ghlUserId: string
): Promise<boolean> {
    console.log(`[GHL Remove User] Removing user ${ghlUserId} from location ${locationId}`);

    try {
        await ghlFetchWithAuth(locationId, `/users/${ghlUserId}`, {
            method: 'DELETE',
        });
        console.log('[GHL Remove User] Success');
        return true;
    } catch (error) {
        console.error('[GHL Remove User] Failed:', error);
        return false;
    }
}

