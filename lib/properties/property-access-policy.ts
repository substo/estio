export class PropertyAccessDeniedError extends Error {
    constructor() {
        super("Property access denied");
        this.name = "PropertyAccessDeniedError";
    }
}

type LocationLike = { id: string };

export type PropertyAccessPolicyDependencies<TLocation extends LocationLike> = {
    getAuthenticatedUserId: () => Promise<string | null>;
    findAuthenticatedDbUserId: (clerkUserId: string) => Promise<string | null>;
    getActiveLocation: () => Promise<TLocation | null>;
    findPropertyInLocation: (propertyId: string, locationId: string) => Promise<{ id: string; locationId: string } | null>;
    isLocationAdmin: (clerkUserId: string, locationId: string) => Promise<boolean>;
};

export function createPropertyAccessPolicy<TLocation extends LocationLike>(
    dependencies: PropertyAccessPolicyDependencies<TLocation>,
) {
    async function requireAuthenticatedLocationContext(requestedLocationId?: string | null) {
        const clerkUserId = await dependencies.getAuthenticatedUserId();
        if (!clerkUserId) {
            throw new PropertyAccessDeniedError();
        }
        // Resolve location first because first-time setup may create/link the
        // local database user needed for attribution.
        const location = await dependencies.getActiveLocation();
        const dbUserId = await dependencies.findAuthenticatedDbUserId(clerkUserId);
        if (!location?.id || !dbUserId) throw new PropertyAccessDeniedError();

        if (requestedLocationId && requestedLocationId !== location.id) {
            throw new PropertyAccessDeniedError();
        }

        return { clerkUserId, dbUserId, location, locationId: location.id };
    }

    async function requirePropertyInActiveLocation(
        propertyId: string,
        options: { requestedLocationId?: string | null; adminOnly?: boolean } = {},
    ) {
        const normalizedPropertyId = String(propertyId || "").trim();
        if (!normalizedPropertyId) throw new PropertyAccessDeniedError();

        const context = await requireAuthenticatedLocationContext(options.requestedLocationId);

        if (options.adminOnly) {
            const isAdmin = await dependencies.isLocationAdmin(context.clerkUserId, context.locationId);
            if (!isAdmin) throw new PropertyAccessDeniedError();
        }

        const property = await dependencies.findPropertyInLocation(normalizedPropertyId, context.locationId);
        if (!property) throw new PropertyAccessDeniedError();

        return { ...context, property };
    }

    return {
        requireAuthenticatedLocationContext,
        requirePropertyInActiveLocation,
    };
}
