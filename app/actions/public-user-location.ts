import { z } from "zod";
import type { PublicSiteContextResult } from "@/lib/auth/public-site-contact-context";
import type { Prisma } from "@prisma/client";

export type PublicPropertyState = {
    success: boolean;
    error?: string;
    fieldErrors?: Record<string, string[]>;
    propertyId?: string;
};

export type PublicUserLocationDependencies = {
    db: any;
    resolveContext: (options: {
        expectedLocationId: string;
        assertedLocationId?: string | null;
        requireContact?: boolean;
    }) => Promise<PublicSiteContextResult>;
    ensureContact: (locationId: string) => Promise<{
        id: string;
        locationId: string;
        name?: string | null;
        email?: string | null;
    } | null>;
    visibleMedia: (media: any[]) => any[];
    recordPropertyAnalytics: (input: any) => Promise<any>;
    revalidate: (path: string) => void;
};

class PublicTenantAuthorizationChangedError extends Error {}

const publicPropertySchema = z.object({
    title: z.string().min(3, "Title must be at least 3 characters"),
    description: z.string().min(10, "Description must be at least 10 characters"),
    price: z.coerce.number().min(0, "Price must be a positive number"),
    currency: z.string().default("EUR"),
    // This is an optional consistency assertion from the browser, never authority.
    locationId: z.string().min(1, "Location ID is required").optional(),
    propertyLocation: z.string().nonempty("District is required"),
    propertyArea: z.string().optional(),
    addressLine1: z.string().optional(),
    category: z.string().nonempty("Category is required"),
    type: z.string().nonempty("Property Type is required"),
    bedrooms: z.coerce.number().int().min(0).optional(),
    bathrooms: z.coerce.number().int().min(0).optional(),
    coveredAreaSqm: z.coerce.number().int().min(0).optional(),
    plotAreaSqm: z.coerce.number().int().min(0).optional(),
    mediaJson: z.string().optional(),
});

export function publicOwnerPropertyWhere(input: {
    locationId: string;
    contactId: string;
    propertyId?: string;
}): Prisma.PropertyWhereInput {
    return {
        ...(input.propertyId ? { id: input.propertyId } : {}),
        locationId: input.locationId,
        contactRoles: {
            some: {
                contactId: input.contactId,
                role: "Owner",
                contact: { locationId: input.locationId },
            },
        },
    };
}

function contextError(reason?: string) {
    if (reason === "unauthenticated") return "You must be signed in.";
    if (reason === "domain_unavailable") return "This site is temporarily unavailable.";
    return "This action is not available for this site.";
}

function formRecord(formData: FormData) {
    const rawData: Record<string, FormDataEntryValue> = {};
    for (const [key, value] of formData.entries()) rawData[key] = value;
    return rawData;
}

function parseMedia(mediaJson?: string) {
    if (!mediaJson) return null;
    try {
        const parsed = JSON.parse(mediaJson);
        if (!Array.isArray(parsed)) return null;
        return parsed.filter((item) => item && typeof item.url === "string");
    } catch {
        return null;
    }
}

export async function toggleFavoriteAtLocation(
    expectedLocationId: string,
    propertyId: string,
    deps: PublicUserLocationDependencies,
): Promise<{ success: boolean; isFavorited: boolean; error?: string }> {
    try {
        const result = await deps.resolveContext({ expectedLocationId });
        if (!result.ok || !result.context.contact) {
            return { success: false, isFavorited: false, error: contextError(result.ok ? undefined : result.reason) };
        }
        const { contact, locationId } = result.context;
        const property = await deps.db.property.findFirst({
            where: { id: propertyId, locationId },
            select: { id: true, locationId: true, slug: true, title: true },
        });
        if (!property) {
            return { success: false, isFavorited: false, error: "Property not found." };
        }

        const currentFavorites = contact.propertiesInterested || [];
        const isCurrentlyFavorited = currentFavorites.includes(propertyId);
        const nextFavorites = isCurrentlyFavorited
            ? currentFavorites.filter((id) => id !== propertyId)
            : [...currentFavorites, propertyId];
        const update = await deps.db.contact.updateMany({
            where: { id: contact.id, locationId },
            data: { propertiesInterested: nextFavorites },
        });
        if (update.count !== 1) {
            return { success: false, isFavorited: false, error: "User profile not found." };
        }

        await deps.recordPropertyAnalytics({
            eventName: isCurrentlyFavorited ? "favorite_remove" : "favorite_add",
            locationId,
            contactId: contact.id,
            propertyId,
            metadata: { slug: property.slug || null, title: property.title || null },
        });
        deps.revalidate("/favorites");
        return { success: true, isFavorited: !isCurrentlyFavorited };
    } catch (error) {
        console.error("[toggleFavorite] Error:", error);
        return { success: false, isFavorited: false, error: "Failed to update favorite" };
    }
}

export async function isFavoritedAtLocation(
    expectedLocationId: string,
    propertyId: string,
    deps: PublicUserLocationDependencies,
): Promise<boolean> {
    try {
        const result = await deps.resolveContext({ expectedLocationId });
        if (!result.ok || !result.context.contact?.propertiesInterested?.includes(propertyId)) return false;

        const property = await deps.db.property.findFirst({
            where: { id: propertyId, locationId: result.context.locationId },
            select: { id: true },
        });
        return !!property;
    } catch (error) {
        console.error("[isFavorited] Error:", error);
        return false;
    }
}

export async function getFavoritesAtLocation(
    expectedLocationId: string,
    deps: PublicUserLocationDependencies,
) {
    try {
        const result = await deps.resolveContext({ expectedLocationId });
        if (!result.ok || !result.context.contact?.propertiesInterested?.length) return [];

        const properties = await deps.db.property.findMany({
            where: {
                id: { in: result.context.contact.propertiesInterested },
                locationId: result.context.locationId,
                publicationStatus: "PUBLISHED",
            },
            include: { media: { orderBy: { sortOrder: "asc" } } },
        });
        return properties.map((property: any) => ({
            ...property,
            media: deps.visibleMedia(property.media || []),
        }));
    } catch (error) {
        console.error("[getFavorites] Error:", error);
        return [];
    }
}

export async function getFavoriteIdsAtLocation(
    expectedLocationId: string,
    deps: PublicUserLocationDependencies,
): Promise<string[]> {
    try {
        const result = await deps.resolveContext({ expectedLocationId });
        if (!result.ok || !result.context.contact?.propertiesInterested?.length) return [];
        const properties = await deps.db.property.findMany({
            where: {
                id: { in: result.context.contact.propertiesInterested },
                locationId: result.context.locationId,
            },
            select: { id: true },
        });
        return properties.map((property: { id: string }) => property.id);
    } catch (error) {
        console.error("[getFavoriteIds] Error:", error);
        return [];
    }
}

export async function submitPublicPropertyAtLocation(
    expectedLocationId: string,
    _previousState: unknown,
    formData: FormData,
    deps: PublicUserLocationDependencies,
): Promise<PublicPropertyState> {
    try {
        const validated = publicPropertySchema.safeParse(formRecord(formData));
        if (!validated.success) {
            return {
                success: false,
                error: "Validation failed. Please check your inputs.",
                fieldErrors: validated.error.flatten().fieldErrors,
            };
        }
        const data = validated.data;
        const result = await deps.resolveContext({
            expectedLocationId,
            assertedLocationId: data.locationId,
            requireContact: false,
        });
        if (!result.ok) return { success: false, error: contextError(result.reason) };

        const contact = result.context.contact || await deps.ensureContact(result.context.locationId);
        if (!contact || contact.locationId !== result.context.locationId) {
            return { success: false, error: "Could not identify a user profile for this site." };
        }

        const slug = `${data.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now().toString().slice(-6)}`;
        const property = await deps.db.property.create({
            data: {
                locationId: result.context.locationId,
                title: data.title,
                slug,
                description: data.description,
                price: data.price,
                currency: data.currency,
                propertyLocation: data.propertyLocation,
                propertyArea: data.propertyArea,
                addressLine1: data.addressLine1,
                category: data.category,
                type: data.type,
                bedrooms: data.bedrooms,
                bathrooms: data.bathrooms,
                coveredAreaSqm: data.coveredAreaSqm,
                plotAreaSqm: data.plotAreaSqm,
                publicationStatus: "PENDING",
                status: "ACTIVE",
                goal: "SALE",
                source: "Public Submission",
                originalCreatorName: contact.name || null,
                originalCreatorEmail: contact.email || null,
                contactRoles: { create: { contactId: contact.id, role: "Owner" } },
            },
        });

        const mediaItems = parseMedia(data.mediaJson);
        if (mediaItems?.length) {
            try {
                await deps.db.propertyMedia.createMany({
                    data: mediaItems.map((item: any, index: number) => ({
                        propertyId: property.id,
                        url: item.url,
                        cloudflareImageId: item.cloudflareImageId,
                        kind: "IMAGE",
                        sortOrder: index,
                    })),
                });
            } catch (error) {
                console.error("Failed to process media JSON", error);
            }
        }
        deps.revalidate("/properties");
        return { success: true, propertyId: property.id };
    } catch (error) {
        console.error("Submit Property Error:", error);
        return { success: false, error: "An unexpected error occurred. Please try again." };
    }
}

export async function getUserSubmissionsAtLocation(
    expectedLocationId: string,
    deps: PublicUserLocationDependencies,
) {
    try {
        const result = await deps.resolveContext({ expectedLocationId });
        if (!result.ok || !result.context.contact) return [];
        const { contact, locationId } = result.context;
        const properties = await deps.db.property.findMany({
            where: publicOwnerPropertyWhere({ locationId, contactId: contact.id }),
            include: { media: { orderBy: { sortOrder: "asc" } } },
            orderBy: { createdAt: "desc" },
        });

        return properties.map((property: any) => {
            let displayStatus = property.status as string;
            if (property.publicationStatus === "PENDING") displayStatus = "Pending Review";
            else if (property.publicationStatus === "DRAFT") displayStatus = "Draft";
            else if (property.publicationStatus === "UNLISTED") displayStatus = "Archived";
            return {
                ...property,
                media: deps.visibleMedia(property.media || []),
                status: displayStatus,
            };
        });
    } catch (error) {
        console.error("[getUserSubmissions] Error:", error);
        return [];
    }
}

export async function updatePublicPropertyAtLocation(
    expectedLocationId: string,
    _previousState: unknown,
    formData: FormData,
    deps: PublicUserLocationDependencies,
): Promise<PublicPropertyState> {
    try {
        const propertyId = formData.get("propertyId");
        if (typeof propertyId !== "string" || !propertyId) {
            return { success: false, error: "Property ID is required." };
        }
        const validated = publicPropertySchema.safeParse(formRecord(formData));
        if (!validated.success) {
            return {
                success: false,
                error: "Validation failed. Please check your inputs.",
                fieldErrors: validated.error.flatten().fieldErrors,
            };
        }
        const data = validated.data;
        const result = await deps.resolveContext({
            expectedLocationId,
            assertedLocationId: data.locationId,
        });
        if (!result.ok || !result.context.contact) {
            return { success: false, error: contextError(result.ok ? undefined : result.reason) };
        }
        const { contact, locationId } = result.context;
        const ownershipWhere = publicOwnerPropertyWhere({
            propertyId,
            locationId,
            contactId: contact.id,
        });
        const existingProperty = await deps.db.property.findFirst({
            where: ownershipWhere,
            select: { id: true },
        });
        if (!existingProperty) {
            return { success: false, error: "Property not found or access denied." };
        }

        const updateData = {
            title: data.title,
            description: data.description,
            price: data.price,
            currency: data.currency,
            propertyLocation: data.propertyLocation,
            propertyArea: data.propertyArea,
            addressLine1: data.addressLine1,
            category: data.category,
            type: data.type,
            bedrooms: data.bedrooms,
            bathrooms: data.bathrooms,
            coveredAreaSqm: data.coveredAreaSqm,
            plotAreaSqm: data.plotAreaSqm,
            publicationStatus: "PENDING",
        };
        const mediaItems = parseMedia(data.mediaJson);
        if (mediaItems) {
            try {
                const updated = await deps.db.$transaction(async (tx: any) => {
                    const update = await tx.property.updateMany({ where: ownershipWhere, data: updateData });
                    if (update.count !== 1) throw new PublicTenantAuthorizationChangedError();

                    // Re-check inside the mutation transaction before replacing media.
                    const stillAuthorized = await tx.property.findFirst({
                        where: ownershipWhere,
                        select: { id: true },
                    });
                    if (!stillAuthorized) throw new PublicTenantAuthorizationChangedError();

                    await tx.propertyMedia.deleteMany({
                        where: { propertyId, property: ownershipWhere },
                    });
                    if (mediaItems.length) {
                        await tx.propertyMedia.createMany({
                            data: mediaItems.map((item: any, index: number) => ({
                                propertyId,
                                url: item.url,
                                cloudflareImageId: item.cloudflareImageId,
                                kind: "IMAGE",
                                sortOrder: index,
                            })),
                        });
                    }
                    return true;
                }, { isolationLevel: "Serializable" });
                if (!updated) throw new PublicTenantAuthorizationChangedError();
            } catch (error) {
                if (error instanceof PublicTenantAuthorizationChangedError) {
                    return { success: false, error: "Property not found or access denied." };
                }
                console.error("Failed to process media JSON on update", error);
                return { success: false, error: "An unexpected error occurred. Please try again." };
            }
        } else {
            const update = await deps.db.property.updateMany({ where: ownershipWhere, data: updateData });
            if (update.count !== 1) {
                return { success: false, error: "Property not found or access denied." };
            }
        }

        deps.revalidate("/submissions");
        deps.revalidate(`/submissions/${propertyId}`);
        return { success: true, propertyId };
    } catch (error) {
        console.error("Update Property Error:", error);
        return { success: false, error: "An unexpected error occurred. Please try again." };
    }
}
