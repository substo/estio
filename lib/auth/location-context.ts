import { auth, clerkClient } from '@clerk/nextjs/server';
import db from '@/lib/db';
import { Location } from '@prisma/client';

/**
 * Get the current user's location context.
 *
 * OPTIMIZED: Uses DB-first approach to avoid Clerk Backend API calls.
 * - Happy path: 0 Clerk API calls (auth() is JWT-local, location from DB)
 * - Fallback (first-time user): 1-2 Clerk API calls with 429 protection
 */
export async function getLocationContext(): Promise<Location | null> {
    const { userId } = await auth();

    if (!userId) {
        return null;
    }

    // ── DB-FIRST: Check local database (no Clerk API call) ──────────────
    const userWithLocations = await db.user.findUnique({
        where: { clerkId: userId },
        include: { locations: { take: 1 } }
    });

    if (userWithLocations?.locations?.[0]) {
        // User exists in DB with a location — return full location object
        const location = await db.location.findUnique({
            where: { id: userWithLocations.locations[0].id },
        });
        if (location) {
            return location;
        }
    }

    // ── FALLBACK: User not in DB or has no location — use Clerk API ─────
    // This only happens for brand-new users on their very first request.
    // Wrapped in try/catch to gracefully handle Clerk 429 rate limits.
    console.log(`[Location Context] User ${userId} not found in DB or has no location. Falling back to Clerk API.`);

    let client;
    let clerkUser;
    try {
        client = await clerkClient();
        clerkUser = await client.users.getUser(userId);
    } catch (e: any) {
        if (e?.status === 429) {
            console.warn('[Location Context] Clerk rate limited (429). Returning null gracefully.');
            return null;
        }
        throw e;
    }

    const metadata = clerkUser.publicMetadata as any;

    // Check if Clerk metadata has a location ID we haven't synced to DB yet
    const internalLocationId = metadata.ghlLocationId || metadata.ghlTenantId || metadata.locationId;

    if (internalLocationId) {
        const location = await db.location.findUnique({
            where: { id: internalLocationId },
        });
        if (location) {
            // Self-heal: ensure the local DB user is linked to this location
            if (userWithLocations && !userWithLocations.locations?.length) {
                try {
                    await db.user.update({
                        where: { id: userWithLocations.id },
                        data: { locations: { connect: { id: location.id } } }
                    });
                    console.log(`[Location Context] Self-healed DB: linked user ${userId} to location ${location.id}`);
                } catch (e) {
                    console.warn("[Location Context] Failed to self-heal DB link", e);
                }
            }
            return location;
        }
    }

    // Create a "Standalone" location for brand-new users
    console.log(`[Location Context] Creating standalone location for user ${userId}`);

    let localUser = userWithLocations;
    if (!localUser) {
        const email = clerkUser.emailAddresses[0]?.emailAddress;
        if (email) {
            localUser = await db.user.create({
                data: {
                    clerkId: userId,
                    email: email,
                    firstName: clerkUser.firstName,
                    lastName: clerkUser.lastName,
                }
            });
        }
    }

    const newLocation = await db.location.create({
        data: {
            name: `${clerkUser.firstName || 'User'}'s Business`,
            users: localUser ? {
                connect: { id: localUser.id }
            } : undefined
        },
    });

    // Link location to user in Clerk metadata (with 429 protection)
    try {
        await client.users.updateUser(userId, {
            publicMetadata: {
                ...metadata,
                ghlLocationId: newLocation.id,
                locationId: newLocation.id,
                ghlRole: 'admin',
                source: 'standalone',
            },
        });
    } catch (e: any) {
        if (e?.status === 429) {
            console.warn('[Location Context] Clerk rate limited on metadata update. Location created but metadata not synced.');
        } else {
            console.warn("[Location Context] Failed to update Clerk metadata", e);
        }
    }

    return newLocation;
}
