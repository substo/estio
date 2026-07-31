import "server-only";

import { auth } from "@clerk/nextjs/server";
import db from "@/lib/db";
import { getLocationContext } from "@/lib/auth/location-context";
import { verifyUserIsLocationAdmin } from "@/lib/auth/permissions";
import { createPropertyAccessPolicy } from "@/lib/properties/property-access-policy";

const propertyAccessPolicy = createPropertyAccessPolicy({
    getAuthenticatedUserId: async () => (await auth()).userId,
    findAuthenticatedDbUserId: async (clerkUserId) => {
        const user = await db.user.findUnique({
            where: { clerkId: clerkUserId },
            select: { id: true },
        });
        return user?.id || null;
    },
    getActiveLocation: getLocationContext,
    findPropertyInLocation: (propertyId, locationId) => db.property.findFirst({
        where: { id: propertyId, locationId },
        select: { id: true, locationId: true },
    }),
    isLocationAdmin: verifyUserIsLocationAdmin,
});

export const requireAuthenticatedLocationContext = propertyAccessPolicy.requireAuthenticatedLocationContext;
export const requirePropertyInActiveLocation = propertyAccessPolicy.requirePropertyInActiveLocation;
export { PropertyAccessDeniedError } from "@/lib/properties/property-access-policy";
