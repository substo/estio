"use server";

import { auth } from "@clerk/nextjs/server";
import db from "@/lib/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { MediaKind } from "@prisma/client";

/**
 * Toggle favorite status for a property.
 * Uses Contact.propertiesInterested array (not ContactPropertyRole which is for CRM relationships).
 */
export async function toggleFavorite(propertyId: string): Promise<{ success: boolean; isFavorited: boolean; error?: string }> {
    try {
        const { userId } = await auth();
        if (!userId) {
            return { success: false, isFavorited: false, error: "Must be signed in to favorite properties" };
        }

        // Find contact linked to this Clerk user
        const contact = await db.contact.findUnique({
            where: { clerkUserId: userId },
            select: { id: true, propertiesInterested: true }
        });

        if (!contact) {
            return { success: false, isFavorited: false, error: "User profile not found" };
        }

        const currentFavorites = contact.propertiesInterested || [];
        const isCurrentlyFavorited = currentFavorites.includes(propertyId);

        if (isCurrentlyFavorited) {
            // Remove from favorites
            await db.contact.update({
                where: { id: contact.id },
                data: {
                    propertiesInterested: currentFavorites.filter(id => id !== propertyId)
                }
            });
            revalidatePath(`/favorites`);
            return { success: true, isFavorited: false };
        } else {
            // Add to favorites
            await db.contact.update({
                where: { id: contact.id },
                data: {
                    propertiesInterested: [...currentFavorites, propertyId]
                }
            });
            revalidatePath(`/favorites`);
            return { success: true, isFavorited: true };
        }
    } catch (error) {
        console.error("[toggleFavorite] Error:", error);
        return { success: false, isFavorited: false, error: "Failed to update favorite" };
    }
}

/**
 * Check if a property is favorited by the current user.
 */
export async function isFavorited(propertyId: string): Promise<boolean> {
    try {
        const { userId } = await auth();
        if (!userId) return false;

        const contact = await db.contact.findUnique({
            where: { clerkUserId: userId },
            select: { propertiesInterested: true }
        });

        if (!contact) return false;

        return (contact.propertiesInterested || []).includes(propertyId);
    } catch (error) {
        console.error("[isFavorited] Error:", error);
        return false;
    }
}

/**
 * Get all favorited properties for the current user.
 */
export async function getFavorites() {
    try {
        const { userId } = await auth();
        if (!userId) return [];

        const contact = await db.contact.findUnique({
            where: { clerkUserId: userId },
            select: { propertiesInterested: true }
        });

        if (!contact || !contact.propertiesInterested?.length) return [];

        // Fetch the actual property objects
        const properties = await db.property.findMany({
            where: {
                id: { in: contact.propertiesInterested },
                publicationStatus: 'PUBLISHED'
            },
            include: {
                media: {
                    orderBy: { sortOrder: 'asc' },
                    take: 1
                }
            }
        });

        return properties;
    } catch (error) {
        console.error("[getFavorites] Error:", error);
        return [];
    }
}

/**
 * Get favorite property IDs for the current user (for bulk checking on listings).
 */
export async function getFavoriteIds(): Promise<string[]> {
    try {
        const { userId } = await auth();
        if (!userId) return [];

        const contact = await db.contact.findUnique({
            where: { clerkUserId: userId },
            select: { propertiesInterested: true }
        });

        return contact?.propertiesInterested || [];
    } catch (error) {
        console.error("[getFavoriteIds] Error:", error);
        return [];
    }
}

// =====================================================
// SAVED SEARCHES
// =====================================================

export interface SavedSearchFilters {
    status?: string;      // 'sale' or 'rent'
    locations?: string[]; // districts
    areas?: string[];     // areas within districts
    categories?: string[];
    types?: string[];
    bedrooms?: string[];
    features?: string[];
    minPrice?: string;
    maxPrice?: string;
    condition?: string;
}

/**
 * Save search filters for the current user.
 * Uses Contact.requirement* fields for storage.
 */
export async function saveSearch(filters: SavedSearchFilters): Promise<{ success: boolean; error?: string }> {
    try {
        const { userId } = await auth();
        if (!userId) {
            return { success: false, error: "Must be signed in to save searches" };
        }

        const contact = await db.contact.findUnique({
            where: { clerkUserId: userId },
            select: { id: true }
        });

        if (!contact) {
            return { success: false, error: "User profile not found" };
        }

        await db.contact.update({
            where: { id: contact.id },
            data: {
                requirementStatus: filters.status === 'rent' ? 'For Rent' : 'For Sale',
                requirementPropertyLocations: [...(filters.locations || []), ...(filters.areas || [])],
                requirementPropertyTypes: [...(filters.categories || []), ...(filters.types || [])],
                requirementBedrooms: filters.bedrooms?.length ? filters.bedrooms.join(',') : 'Any Bedrooms',
                requirementMinPrice: filters.minPrice || 'Any',
                requirementMaxPrice: filters.maxPrice || 'Any',
                requirementCondition: filters.condition || 'Any Condition',
                requirementOtherDetails: filters.features?.length ? filters.features.join(',') : null,
            }
        });

        return { success: true };
    } catch (error) {
        console.error("[saveSearch] Error:", error);
        return { success: false, error: "Failed to save search" };
    }
}

/**
 * Get saved search for the current user as URL query params.
 */
export async function getSavedSearch(): Promise<{ hasSearch: boolean; queryString: string }> {
    try {
        const { userId } = await auth();
        if (!userId) return { hasSearch: false, queryString: '' };

        const contact = await db.contact.findUnique({
            where: { clerkUserId: userId },
            select: {
                requirementStatus: true,
                requirementPropertyLocations: true,
                requirementPropertyTypes: true,
                requirementBedrooms: true,
                requirementMinPrice: true,
                requirementMaxPrice: true,
                requirementCondition: true,
                requirementOtherDetails: true,
            }
        });

        if (!contact) return { hasSearch: false, queryString: '' };

        // Check if any meaningful filters are saved
        const hasFilters =
            contact.requirementStatus !== 'For Sale' ||
            contact.requirementPropertyLocations.length > 0 ||
            contact.requirementPropertyTypes.length > 0 ||
            contact.requirementBedrooms !== 'Any Bedrooms' ||
            contact.requirementMinPrice !== 'Any' ||
            contact.requirementMaxPrice !== 'Any' ||
            contact.requirementCondition !== 'Any Condition' ||
            contact.requirementOtherDetails;

        if (!hasFilters) return { hasSearch: false, queryString: '' };

        // Build query string
        const params = new URLSearchParams();

        // Status
        if (contact.requirementStatus === 'For Rent') {
            params.set('status', 'rent');
        } else if (contact.requirementStatus === 'For Sale') {
            params.set('status', 'sale');
        }

        // Locations (all in one array)
        if (contact.requirementPropertyLocations.length > 0) {
            params.set('locations', contact.requirementPropertyLocations.join(','));
        }

        // Types
        if (contact.requirementPropertyTypes.length > 0) {
            params.set('types', contact.requirementPropertyTypes.join(','));
        }

        // Bedrooms
        if (contact.requirementBedrooms && contact.requirementBedrooms !== 'Any Bedrooms') {
            params.set('bedrooms', contact.requirementBedrooms);
        }

        // Price
        if (contact.requirementMinPrice && contact.requirementMinPrice !== 'Any') {
            params.set('min_price', contact.requirementMinPrice);
        }
        if (contact.requirementMaxPrice && contact.requirementMaxPrice !== 'Any') {
            params.set('max_price', contact.requirementMaxPrice);
        }

        // Condition
        if (contact.requirementCondition && contact.requirementCondition !== 'Any Condition') {
            params.set('condition', contact.requirementCondition);
        }

        // Features
        if (contact.requirementOtherDetails) {
            params.set('features', contact.requirementOtherDetails);
        }

        return { hasSearch: true, queryString: params.toString() };
    } catch (error) {
        console.error("[getSavedSearch] Error:", error);
        return { hasSearch: false, queryString: '' };
    }
}


// =====================================================
// PROPERTY SUBMISSION
// =====================================================

const publicPropertySchema = z.object({
    title: z.string().min(3, "Title must be at least 3 characters"),
    description: z.string().min(10, "Description must be at least 10 characters"),
    price: z.coerce.number().min(0, "Price must be a positive number"),
    currency: z.string().default("EUR"),
    locationId: z.string().min(1, "Location ID is required"),

    // Address/Location
    propertyLocation: z.string().nonempty("District is required"), // District
    propertyArea: z.string().optional(), // Area/Village
    addressLine1: z.string().optional(),

    // Specs
    category: z.string().nonempty("Category is required"),
    type: z.string().nonempty("Property Type is required"),
    bedrooms: z.coerce.number().int().min(0).optional(),
    bathrooms: z.coerce.number().int().min(0).optional(),
    coveredAreaSqm: z.coerce.number().int().min(0).optional(),
    plotAreaSqm: z.coerce.number().int().min(0).optional(),

    // Media
    mediaJson: z.string().optional(), // JSON string of uploaded images


});

export type PublicPropertyState = {
    success: boolean;
    error?: string;
    fieldErrors?: Record<string, string[]>;
    propertyId?: string;
}

export async function submitPublicProperty(prevState: any, formData: FormData): Promise<PublicPropertyState> {
    try {
        const { userId, sessionClaims } = await auth();
        if (!userId) {
            return { success: false, error: "You must be signed in to list a property." };
        }

        // Parse Data

        const rawData: Record<string, any> = {};
        Array.from(formData.entries()).forEach(([key, value]) => {
            rawData[key] = value;
        });

        const validated = publicPropertySchema.safeParse(rawData);

        if (!validated.success) {
            return {
                success: false,
                error: "Validation failed. Please check your inputs.",
                fieldErrors: validated.error.flatten().fieldErrors
            };
        }

        const data = validated.data;

        // Verify Contact Exists
        let contact = await db.contact.findUnique({
            where: { clerkUserId: userId }
        });

        if (!contact) {
            // Create contact if missing (should normally exist via layout sync, but fail-safe)
            const email = (sessionClaims as any)?.email as string; // Strictly session email

            if (email) {
                // Check by email first
                contact = await db.contact.findFirst({
                    where: { email, locationId: data.locationId }
                });

                if (contact) {
                    // Link it
                    await db.contact.update({
                        where: { id: contact.id },
                        data: { clerkUserId: userId }
                    });
                } else {
                    // Create
                    contact = await db.contact.create({
                        data: {
                            locationId: data.locationId,
                            clerkUserId: userId,
                            email: email,
                            name: (sessionClaims as any)?.fullName || "Public User",
                            phone: null, // We don't ask for phone anymore on this form
                            status: "NEW",
                            leadSource: "Public Property Submission"
                        }
                    });
                }
            } else {
                return { success: false, error: "Could not identify user profile." };
            }
        }

        // Generate a slug
        const slug = `${data.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString().slice(-6)}`;

        // Create Property
        const property = await db.property.create({
            data: {
                locationId: data.locationId,
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

                publicationStatus: 'PENDING', // CRITICAL: Must be reviewed
                status: 'ACTIVE',
                goal: 'SALE', // Defaulting to Sale for now, or add field
                source: 'Public Submission',

                originalCreatorName: contact.name,
                originalCreatorEmail: contact.email,

                // Link 'Owner' Role
                contactRoles: {
                    create: {
                        contactId: contact.id,
                        role: 'Owner'
                    }
                }
            }
        });

        // Handle Media
        if (data.mediaJson) {
            try {
                const mediaItems = JSON.parse(data.mediaJson);
                if (Array.isArray(mediaItems) && mediaItems.length > 0) {
                    await db.propertyMedia.createMany({
                        data: mediaItems.map((item: any, index: number) => ({
                            propertyId: property.id,
                            url: item.url,
                            cloudflareImageId: item.cloudflareImageId,
                            kind: MediaKind.IMAGE,
                            sortOrder: index
                        }))
                    });
                }
            } catch (e) {
                console.error("Failed to process media JSON", e);
            }
        }

        revalidatePath(`/properties`);

        return { success: true, propertyId: property.id };

    } catch (error) {
        console.error("Submit Property Error:", error);
        return { success: false, error: "An unexpected error occurred. Please try again." };
    }
}

/**
 * Get all properties submitted by the current user.
 */
export async function getUserSubmissions() {
    try {
        const { userId } = await auth();
        if (!userId) return [];

        const contact = await db.contact.findUnique({
            where: { clerkUserId: userId },
            select: { id: true }
        });

        if (!contact) return [];

        const properties = await db.property.findMany({
            where: {
                contactRoles: {
                    some: {
                        contactId: contact.id,
                        role: 'Owner'
                    }
                }
            },
            include: {
                media: {
                    orderBy: { sortOrder: 'asc' },
                    take: 1
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        // Map statuses for display
        return properties.map(p => {
            let displayStatus = p.status as string;

            // Override status based on publication status
            if (p.publicationStatus === 'PENDING') displayStatus = 'Pending Review';
            else if (p.publicationStatus === 'DRAFT') displayStatus = 'Draft';
            else if (p.publicationStatus === 'UNLISTED') displayStatus = 'Archived';
            // If PUBLISHED, we use the actual p.status (ACTIVE, SOLD, etc.)

            return {
                ...p,
                status: displayStatus
            };
        });

    } catch (error) {
        console.error("[getUserSubmissions] Error:", error);
        return [];
    }
}


export async function updatePublicProperty(prevState: any, formData: FormData): Promise<PublicPropertyState> {
    try {
        const { userId } = await auth();
        if (!userId) {
            return { success: false, error: "You must be signed in to edit a property." };
        }

        const propertyId = formData.get("propertyId") as string;
        if (!propertyId) {
            return { success: false, error: "Property ID is required." };
        }

        // Parse Data
        const rawData: Record<string, any> = {};
        Array.from(formData.entries()).forEach(([key, value]) => {
            rawData[key] = value;
        });

        const validated = publicPropertySchema.safeParse(rawData);

        if (!validated.success) {
            return {
                success: false,
                error: "Validation failed. Please check your inputs.",
                fieldErrors: validated.error.flatten().fieldErrors
            };
        }

        const data = validated.data;

        // Verify Contact & Ownership
        const contact = await db.contact.findUnique({
            where: { clerkUserId: userId },
            select: { id: true, email: true, name: true }
        });

        if (!contact) {
            return { success: false, error: "User profile not found." };
        }

        const existingProperty = await db.property.findFirst({
            where: {
                id: propertyId,
                contactRoles: {
                    some: {
                        contactId: contact.id,
                        role: 'Owner'
                    }
                }
            }
        });

        if (!existingProperty) {
            return { success: false, error: "Property not found or access denied." };
        }

        // Generate a slug only if title changed significantly? 
        // Better NOT to change slug on edit to preserve SEO/links if it was already indexed, 
        // unless explicitly requested. But here it's likely still pending or just a simple edit.
        // Let's keep the slug stable to avoid broken links unless we implement redirects.

        // Update Property
        await db.property.update({
            where: { id: propertyId },
            data: {
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

                // CRITICAL: Reset to PENDING if it was active/published?
                // If it was already PENDING, it stays PENDING.
                // If it was DRAFT, it might become PENDING.
                // If it was PUBLISHED, it should probably go back to PENDING for review.
                publicationStatus: 'PENDING',

                // Track the update
                updatedById: contact.id, // technically updater is User, but we don't have a User record for public potentially? 
                // schema says updatedById references User. 
                // Public users might not have a full User record in our DB if they are just Contacts.
                // So we'll skip updatedById for now or need to fix that link.
                // However, we DO have originalCreatorName/Email.
            }
        });

        // Handle Media
        // "Overwrite" approach or "Merge"?
        // The form sends the COMPLETE list of images desired.
        // So we should delete existing media and insert new ones (safest/easiest provided volume is low).
        if (data.mediaJson) {
            try {
                const mediaItems = JSON.parse(data.mediaJson);
                if (Array.isArray(mediaItems)) {
                    // Transaction-like replacement
                    await db.$transaction(async (tx) => {
                        await tx.propertyMedia.deleteMany({
                            where: { propertyId: propertyId }
                        });

                        if (mediaItems.length > 0) {
                            await tx.propertyMedia.createMany({
                                data: mediaItems.map((item: any, index: number) => ({
                                    propertyId: propertyId,
                                    url: item.url,
                                    cloudflareImageId: item.cloudflareImageId,
                                    kind: MediaKind.IMAGE,
                                    sortOrder: index
                                }))
                            });
                        }
                    });
                }
            } catch (e) {
                console.error("Failed to process media JSON on update", e);
            }
        }

        revalidatePath(`/submissions`);
        revalidatePath(`/submissions/${propertyId}`);

        return { success: true, propertyId: propertyId };

    } catch (error) {
        console.error("Update Property Error:", error);
        return { success: false, error: "An unexpected error occurred. Please try again." };
    }
}
