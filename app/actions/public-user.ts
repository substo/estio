"use server";

import { auth } from "@clerk/nextjs/server";
import db from "@/lib/db";
import { getVisiblePropertyMedia } from "@/lib/properties/property-media-ai";
import { revalidatePath } from "next/cache";
import { recordAnalyticsEvent, recordPropertyAnalyticsEvent } from "@/lib/analytics/server";
import { ensureContactExists } from "@/lib/auth/ensure-contact";
import { resolvePublicSiteContactContext } from "@/lib/auth/public-site-contact-context";
import {
    getFavoriteIdsAtLocation,
    getFavoritesAtLocation,
    getUserSubmissionsAtLocation,
    isFavoritedAtLocation,
    submitPublicPropertyAtLocation,
    toggleFavoriteAtLocation,
    updatePublicPropertyAtLocation,
    type PublicPropertyState,
} from "./public-user-location";

const publicUserLocationDependencies = {
    db,
    resolveContext: resolvePublicSiteContactContext,
    ensureContact: ensureContactExists,
    visibleMedia: getVisiblePropertyMedia,
    recordPropertyAnalytics: recordPropertyAnalyticsEvent,
    revalidate: revalidatePath,
};

export async function toggleFavorite(
    locationId: string,
    propertyId: string,
): Promise<{ success: boolean; isFavorited: boolean; error?: string }> {
    return toggleFavoriteAtLocation(locationId, propertyId, publicUserLocationDependencies);
}

export async function isFavorited(locationId: string, propertyId: string): Promise<boolean> {
    return isFavoritedAtLocation(locationId, propertyId, publicUserLocationDependencies);
}

export async function getFavorites(locationId: string) {
    return getFavoritesAtLocation(locationId, publicUserLocationDependencies);
}

export async function getFavoriteIds(locationId: string): Promise<string[]> {
    return getFavoriteIdsAtLocation(locationId, publicUserLocationDependencies);
}

// =====================================================
// SAVED SEARCHES
// =====================================================

export interface SavedSearchFilters {
    status?: string;
    locations?: string[];
    areas?: string[];
    categories?: string[];
    types?: string[];
    bedrooms?: string[];
    features?: string[];
    minPrice?: string;
    maxPrice?: string;
    condition?: string;
}

export async function saveSearch(filters: SavedSearchFilters): Promise<{ success: boolean; error?: string }> {
    try {
        const { userId } = await auth();
        if (!userId) return { success: false, error: "Must be signed in to save searches" };

        const contact = await db.contact.findUnique({
            where: { clerkUserId: userId },
            select: { id: true, locationId: true },
        });
        if (!contact) return { success: false, error: "User profile not found" };

        await db.contact.update({
            where: { id: contact.id },
            data: {
                requirementStatus: filters.status === "rent" ? "For Rent" : "For Sale",
                requirementPropertyLocations: [...(filters.locations || []), ...(filters.areas || [])],
                requirementPropertyTypes: [...(filters.categories || []), ...(filters.types || [])],
                requirementBedrooms: filters.bedrooms?.length ? filters.bedrooms.join(",") : "Any Bedrooms",
                requirementMinPrice: filters.minPrice || "Any",
                requirementMaxPrice: filters.maxPrice || "Any",
                requirementCondition: filters.condition || "Any Condition",
                requirementOtherDetails: filters.features?.length ? filters.features.join(",") : null,
            },
        });
        await recordAnalyticsEvent({
            eventName: "saved_search_create",
            locationId: contact.locationId,
            contactId: contact.id,
            entityType: "property_search",
            metadata: { filters },
        });
        return { success: true };
    } catch (error) {
        console.error("[saveSearch] Error:", error);
        return { success: false, error: "Failed to save search" };
    }
}

export async function getSavedSearch(): Promise<{ hasSearch: boolean; queryString: string }> {
    try {
        const { userId } = await auth();
        if (!userId) return { hasSearch: false, queryString: "" };

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
            },
        });
        if (!contact) return { hasSearch: false, queryString: "" };

        const hasFilters =
            contact.requirementStatus !== "For Sale" ||
            contact.requirementPropertyLocations.length > 0 ||
            contact.requirementPropertyTypes.length > 0 ||
            contact.requirementBedrooms !== "Any Bedrooms" ||
            contact.requirementMinPrice !== "Any" ||
            contact.requirementMaxPrice !== "Any" ||
            contact.requirementCondition !== "Any Condition" ||
            contact.requirementOtherDetails;
        if (!hasFilters) return { hasSearch: false, queryString: "" };

        const params = new URLSearchParams();
        if (contact.requirementStatus === "For Rent") params.set("status", "rent");
        else if (contact.requirementStatus === "For Sale") params.set("status", "sale");
        if (contact.requirementPropertyLocations.length) {
            params.set("locations", contact.requirementPropertyLocations.join(","));
        }
        if (contact.requirementPropertyTypes.length) {
            params.set("types", contact.requirementPropertyTypes.join(","));
        }
        if (contact.requirementBedrooms && contact.requirementBedrooms !== "Any Bedrooms") {
            params.set("bedrooms", contact.requirementBedrooms);
        }
        if (contact.requirementMinPrice && contact.requirementMinPrice !== "Any") {
            params.set("min_price", contact.requirementMinPrice);
        }
        if (contact.requirementMaxPrice && contact.requirementMaxPrice !== "Any") {
            params.set("max_price", contact.requirementMaxPrice);
        }
        if (contact.requirementCondition && contact.requirementCondition !== "Any Condition") {
            params.set("condition", contact.requirementCondition);
        }
        if (contact.requirementOtherDetails) params.set("features", contact.requirementOtherDetails);
        return { hasSearch: true, queryString: params.toString() };
    } catch (error) {
        console.error("[getSavedSearch] Error:", error);
        return { hasSearch: false, queryString: "" };
    }
}

// =====================================================
// PROPERTY SUBMISSION
// =====================================================

export async function submitPublicProperty(
    locationId: string,
    previousState: unknown,
    formData: FormData,
): Promise<PublicPropertyState> {
    return submitPublicPropertyAtLocation(locationId, previousState, formData, publicUserLocationDependencies);
}

export async function getUserSubmissions(locationId: string) {
    return getUserSubmissionsAtLocation(locationId, publicUserLocationDependencies);
}

export async function updatePublicProperty(
    locationId: string,
    previousState: unknown,
    formData: FormData,
): Promise<PublicPropertyState> {
    return updatePublicPropertyAtLocation(locationId, previousState, formData, publicUserLocationDependencies);
}
