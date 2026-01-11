import { clerkClient } from '@clerk/nextjs/server';
import type { GHLUser } from './ghl/types';

export interface ClerkUserWithGHL {
    clerkUserId: string;
    email: string;
    ghlUserId?: string;
    ghlRole?: string;
    ghlLocationIds?: string[];
}

/**
 * Creates or updates a Clerk user based on GHL user data
 * Syncs GHL permissions to Clerk metadata
 */
export async function syncGHLUserToClerk(
    ghlUser: GHLUser,
    locationId: string,
    ghlLocationId: string
): Promise<string> {
    const client = await clerkClient();
    const normalizedEmail = ghlUser.email.toLowerCase().trim();

    console.log(`[Clerk Sync] Syncing user: ${normalizedEmail} (Original: ${ghlUser.email})`);

    // Check if user exists by email
    const existingUsers = await client.users.getUserList({
        emailAddress: [normalizedEmail],
    });

    let clerkUserId: string;

    // Find exact match from results (Clerk search might be fuzzy or case-sensitive depending on config)
    const exactMatch = existingUsers.data.find(u =>
        u.emailAddresses.some(e => e.emailAddress.toLowerCase().trim() === normalizedEmail)
    );

    if (exactMatch) {
        // User exists - update their metadata
        clerkUserId = exactMatch.id;

        console.log(`[Clerk Sync] Found existing Clerk user: ${clerkUserId} for email ${normalizedEmail}`);

        await client.users.updateUser(clerkUserId, {
            publicMetadata: {
                ...exactMatch.publicMetadata,
                ghlUserId: ghlUser.id,
                ghlRole: ghlUser.roles?.role || ghlUser.role,
                ghlType: ghlUser.roles?.type || ghlUser.type,
                ghlLocationIds: ghlUser.roles?.locationIds || ghlUser.locationIds,
                ghlLocationId: locationId, // New field name
                ghlPrimaryLocationId: ghlLocationId,
                lastGHLSync: new Date().toISOString(),
            },
        });
        console.log(`[Clerk Sync] Updated metadata for user ${clerkUserId}`);
    } else {
        // User doesn't exist - create new Clerk user
        console.log(`[Clerk Sync] No existing user found for ${normalizedEmail}. Creating new Clerk user...`);
        console.log(`[Clerk Sync] Search results count: ${existingUsers.data.length}`);
        if (existingUsers.data.length > 0) {
            console.log(`[Clerk Sync] Existing users found but no exact email match: ${existingUsers.data.map(u => u.id).join(', ')}`);
        }

        const newUser = await client.users.createUser({
            emailAddress: [normalizedEmail],
            firstName: ghlUser.firstName || ghlUser.name?.split(' ')[0],
            lastName: ghlUser.lastName || ghlUser.name?.split(' ').slice(1).join(' '),
            publicMetadata: {
                ghlUserId: ghlUser.id,
                ghlRole: ghlUser.roles?.role || ghlUser.role,
                ghlType: ghlUser.roles?.type || ghlUser.type,
                ghlLocationIds: ghlUser.roles?.locationIds || ghlUser.locationIds,
                ghlLocationId: locationId, // New field name
                ghlPrimaryLocationId: ghlLocationId,
                source: 'ghl_sso',
                createdViaGHL: true,
                lastGHLSync: new Date().toISOString(),
            },
            skipPasswordRequirement: true, // GHL users don't need password
            skipPasswordChecks: true,
        });

        clerkUserId = newUser.id;
        console.log(`[Clerk Sync] Created new Clerk user: ${clerkUserId}`);
    }

    return clerkUserId;
}

/**
 * Gets GHL context from Clerk user metadata
 * Includes backward compatibility for old field name (ghlTenantId)
 */
export async function getGHLContextFromClerk(clerkUserId: string): Promise<{
    ghlUserId?: string;
    ghlRole?: string;
    ghlLocationIds?: string[];
    ghlLocationId?: string;
} | null> {
    try {
        const client = await clerkClient();
        const user = await client.users.getUser(clerkUserId);

        const metadata = user.publicMetadata as any;

        return {
            ghlUserId: metadata.ghlUserId,
            ghlRole: metadata.ghlRole,
            ghlLocationIds: metadata.ghlLocationIds,
            // Backward compatibility: try new field first, fall back to old field
            ghlLocationId: metadata.ghlLocationId || metadata.ghlTenantId,
        };
    } catch (error) {
        console.error('[Clerk] Failed to get GHL context:', error);
        return null;
    }
}
