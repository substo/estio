import db from "@/lib/db";
import { currentUser } from "@clerk/nextjs/server";
import { Prisma } from "@prisma/client";

type PublicClerkUser = {
    id: string;
    firstName?: string | null;
    lastName?: string | null;
    emailAddresses: Array<{ emailAddress: string }>;
};

type EnsureContactDependencies = {
    contact: any;
    isUniqueError: (error: unknown) => boolean;
};

function isUniqueConstraintError(error: unknown) {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

const defaultDependencies: EnsureContactDependencies = {
    contact: db.contact,
    isUniqueError: isUniqueConstraintError,
};

async function findClerkContact(clerkUserId: string, dependencies: EnsureContactDependencies) {
    return dependencies.contact.findUnique({
        where: { clerkUserId },
        select: { id: true, locationId: true, name: true, email: true },
    });
}

/**
 * Implements the current one-Clerk-user/one-Contact policy. Existing Clerk
 * identities are never reassigned to another location.
 */
export async function ensureContactForClerkUser(
    locationId: string,
    user: PublicClerkUser,
    dependencies: EnsureContactDependencies = defaultDependencies,
) {
    const existingContact = await findClerkContact(user.id, dependencies);
    if (existingContact) {
        if (existingContact.locationId !== locationId) {
            console.warn("[Fail-Safe] Refusing to reuse a Clerk contact across public-site tenants", {
                clerkUserId: user.id,
                requestedLocationId: locationId,
                contactLocationId: existingContact.locationId,
            });
            return null;
        }
        return existingContact;
    }

    console.log(`[Fail-Safe] Creating Contact for user ${user.id} at location ${locationId}`);
    const name = `${user.firstName || ""} ${user.lastName || ""}`.trim();
    const email = user.emailAddresses[0]?.emailAddress;

    try {
        return await dependencies.contact.create({
            data: {
                location: { connect: { id: locationId } },
                clerkUserId: user.id,
                name,
                email,
                status: "new",
                leadSource: "Website Login (Fail-Safe)",
                leadStage: "New Lead",
            },
            select: { id: true, locationId: true, name: true, email: true },
        });
    } catch (error) {
        if (!dependencies.isUniqueError(error)) throw error;

        // Another request may have linked/created the identity first. Re-read
        // the global unique key and only accept a result in this location.
        const racedContact = await findClerkContact(user.id, dependencies);
        return racedContact?.locationId === locationId ? racedContact : null;
    }
}

/**
 * Fail-safe for OAuth sign-ins whose webhook has not created the Contact yet.
 */
export async function ensureContactExists(locationId: string) {
    try {
        const user = await currentUser();
        if (!user) return null;
        return await ensureContactForClerkUser(locationId, user);
    } catch (error) {
        console.error("[Fail-Safe] Error ensuring contact exists:", error);
        return null;
    }
}
