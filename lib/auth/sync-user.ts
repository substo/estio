import db from "@/lib/db";
import { User as ClerkUser } from "@clerk/nextjs/server";
import type { AuthRealm } from "@/lib/auth/auth-realm";
import { ensureRealmUser, type RealmUserStore } from "@/lib/auth/realm-user-link";
import { getRequestAuthRealm } from "@/lib/auth/request-realm";

const store: RealmUserStore = {
    user: {
        findUnique: (args) => db.user.findUnique(args),
        update: (args) => db.user.update(args),
        create: (args) => db.user.create(args as Parameters<typeof db.user.create>[0]),
    },
};

/**
 * Ensures that a Clerk user exists in the local database, within the identity
 * realm of the request's host (or an explicitly verified realm).
 * A same-realm user found by email (invited/placeholder) is linked to the Clerk ID.
 * Users in another realm are never found or linked, even with the same email.
 */
export async function ensureUserExists(clerkUser: ClerkUser, realm?: AuthRealm) {
    if (!clerkUser) return null;

    try {
        return await ensureRealmUser(store, realm ?? await getRequestAuthRealm(), {
            clerkId: clerkUser.id,
            email: clerkUser.emailAddresses[0]?.emailAddress,
            firstName: clerkUser.firstName,
            lastName: clerkUser.lastName,
        });
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
