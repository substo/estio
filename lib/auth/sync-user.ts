import db from "@/lib/db";
import { User as ClerkUser } from "@clerk/nextjs/server";

/**
 * Ensures that a Clerk user exists in the local database.
 * If the user exists by email but has no clerkId, it updates the clerkId.
 * If the user doesn't exist, it creates a new record.
 */
export async function ensureUserExists(clerkUser: ClerkUser) {
    if (!clerkUser) return null;

    const email = clerkUser.emailAddresses[0]?.emailAddress;
    if (!email) return null;

    const firstName = clerkUser.firstName || null;
    const lastName = clerkUser.lastName || null;

    try {
        // Try to find by Clerk ID first
        let user = await db.user.findUnique({
            where: { clerkId: clerkUser.id },
        });

        if (user) {
            // Update names if changed (syncs from Clerk)
            const needsUpdate =
                (firstName && user.firstName !== firstName) ||
                (lastName && user.lastName !== lastName);

            if (needsUpdate) {
                user = await db.user.update({
                    where: { id: user.id },
                    data: {
                        firstName: firstName || user.firstName,
                        lastName: lastName || user.lastName
                    },
                });
            }
            return user;
        }

        // Try to find by email
        user = await db.user.findUnique({
            where: { email },
        });

        if (user) {
            // User exists by email but not linked to Clerk ID yet
            console.log(`[Auth Sync] Linking existing user ${email} to Clerk ID ${clerkUser.id}`);
            user = await db.user.update({
                where: { id: user.id },
                data: {
                    clerkId: clerkUser.id,
                    firstName: firstName || user.firstName,
                    lastName: lastName || user.lastName
                },
            });
            return user;
        }

        // Create new user
        console.log(`[Auth Sync] Creating new user for ${email}`);
        user = await db.user.create({
            data: {
                email,
                clerkId: clerkUser.id,
                firstName,
                lastName,
            },
        });

        return user;
    } catch (error) {
        console.error("[Auth Sync] Error ensuring user exists:", error);
        // Don't throw, just return null so the app doesn't crash, 
        // but functionality might be limited.
        return null;
    }
}

/**
 * Helper to get display name from firstName/lastName
 */
export function getUserDisplayName(user: { firstName?: string | null; lastName?: string | null; email: string }): string {
    const parts = [user.firstName, user.lastName].filter(Boolean);
    return parts.length > 0 ? parts.join(' ') : user.email;
}

/**
 * Helper to get initials from firstName/lastName
 */
export function getUserInitials(user: { firstName?: string | null; lastName?: string | null; email: string }): string {
    if (user.firstName) {
        return user.firstName[0].toUpperCase();
    }
    return user.email[0].toUpperCase();
}
