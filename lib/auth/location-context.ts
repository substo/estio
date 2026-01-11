import { auth, clerkClient } from '@clerk/nextjs/server';
import db from '@/lib/db';
import { Location } from '@prisma/client';

export async function getLocationContext(): Promise<Location | null> {
    const { userId } = await auth();

    if (!userId) {
        return null;
    }

    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const metadata = user.publicMetadata as any;

    // 1. Check if user already has a location linked
    // Note: In clerk-sync.ts, 'ghlLocationId' in metadata actually stores the INTERNAL Location ID (UUID)
    // We also check 'locationId' which is used by the invitation system
    const internalLocationId = metadata.ghlLocationId || metadata.ghlTenantId || metadata.locationId;

    if (internalLocationId) {
        const location = await db.location.findUnique({
            where: { id: internalLocationId },
        });
        if (location) {
            return location;
        }
        // If location lookup by ID failed, falling through to checks below is safer than creating standalone immediately
    }

    // 1.5. Safety Check: Does the user ALREADY have a location in the DB?
    // This handles cases where the Webhook linked them, but Metadata hasn't been updated/synced yet.
    // We shouldn't create a Standalone location if they are already a member of a real location.
    const userWithLocations = await db.user.findUnique({
        where: { clerkId: userId },
        include: { locations: { take: 1 } }
    });

    if (userWithLocations?.locations?.[0]) {
        console.log(`[Location Context] User ${userId} has DB location but missing Metadata. Using DB location.`);
        const location = userWithLocations.locations[0];

        // Self-heal: Update metadata so next time it's faster
        try {
            await client.users.updateUser(userId, {
                publicMetadata: {
                    ...metadata,
                    ghlLocationId: location.id,
                    locationId: location.id,
                },
            });
        } catch (e) {
            console.warn("[Location Context] Failed to self-heal metadata", e);
        }

        return location;
    }

    // 2. If no location found in Metadata OR DB, create a "Standalone" location
    console.log(`[Location Context] Creating standalone location for user ${userId}`);

    // Ensure user exists in local DB first
    let localUser = null;
    if (userWithLocations) {
        localUser = userWithLocations;
    } else {
        const email = user.emailAddresses[0]?.emailAddress;
        if (email) {
            localUser = await db.user.create({
                data: {
                    clerkId: userId,
                    email: email,
                    firstName: user.firstName,
                    lastName: user.lastName,
                }
            });
        }
    }

    const newLocation = await db.location.create({
        data: {
            name: `${user.firstName || 'User'}'s Business`,
            // Connect to the user immediately
            users: localUser ? {
                connect: { id: localUser.id }
            } : undefined
        },
    });

    // 3. Link location to user
    await client.users.updateUser(userId, {
        publicMetadata: {
            ...metadata,
            ghlLocationId: newLocation.id, // Storing Internal ID
            locationId: newLocation.id,    // Keep both consistent
            ghlRole: 'admin',
            source: 'standalone',
        },
    });

    return newLocation;
}
