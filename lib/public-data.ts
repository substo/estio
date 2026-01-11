import db from "@/lib/db";
import { cache } from "react";

// Use React 'cache' to deduplicate requests in the same render cycle
export const getSiteConfig = cache(async (domain: string) => {
    // DEVELOPMENT ALIAS: Allow local testing of the live site
    // Since SiteConfig.locationId is unique, we can't have a separate 'test.localhost' config 
    // pointing to the same location as 'downtowncyprus.site'.
    // So we map the test domain to the real one here.
    const searchDomain = domain === 'test.localhost' ? 'downtowncyprus.site' : domain;

    const config = await db.siteConfig.findUnique({
        where: { domain: searchDomain },
        include: {
            location: true, // We might need location details (address, etc) later
        },
    });
    return config;
});

export interface SearchParams {
    minPrice?: number;
    maxPrice?: number;
    beds?: number; // Legacy single value (>=)
    bedrooms?: string[]; // New: Array of specific counts e.g. ["2", "3", "5+"]
    baths?: number;
    q?: string; // Generic query
    status?: string; // sale/rent
    type?: string; // Legacy single value
    types?: string[]; // New: Array of subtypes
    categories?: string[]; // New: Array of categories
    location?: string; // Legacy single value
    locations?: string[]; // New: Array of Districts
    areas?: string[]; // New: Array of Specific Areas
    budget?: string; // low, mid, high, luxury
    condition?: string; // New Build, Resale
    reference?: string; // Ref No.
    features?: string[]; // New: Array of features
    filterBy?: string; // New: Special attributes
    source?: string; // New: Created By
}

export const getPublicProperties = cache(async (
    locationId: string,
    params: SearchParams
) => {
    // Dynamic Filter Construction
    const where: any = {
        locationId, // STRICT TENANT ISOLATION
        publicationStatus: 'PUBLISHED',
    };

    if (params.minPrice) where.price = { ...where.price, gte: params.minPrice };
    if (params.maxPrice) where.price = { ...where.price, lte: params.maxPrice };

    // Legacy Beds (>=)
    if (params.beds) where.bedrooms = { gte: params.beds };
    if (params.baths) where.bathrooms = { gte: params.baths };

    // New Advanced Bedrooms Logic (e.g. "2", "3", "5+")
    // Logic: OR condition for exact matches and GTE match for "5+"
    if (params.bedrooms && params.bedrooms.length > 0) {
        const exactBeds = params.bedrooms.filter(b => !b.includes('+')).map(Number);
        const minBeds = params.bedrooms.find(b => b.includes('+'));

        const conditions: any[] = [];
        if (exactBeds.length > 0) {
            conditions.push({ bedrooms: { in: exactBeds } });
        }
        if (minBeds) {
            const minVal = parseInt(minBeds.replace('+', ''));
            conditions.push({ bedrooms: { gte: minVal } });
        }

        if (conditions.length > 0) {
            if (!where.AND) where.AND = [];
            where.AND.push({ OR: conditions });
        }
    }

    // Goal (For Sale / For Rent)
    // SKIP GOAL FILTER IF SEARCHING BY REFERENCE (Direct Lookup should ignore Status)
    if (params.status && !params.reference) {
        // Map "sale" -> "SALE", "rent" -> "RENT"
        const goal = params.status.toUpperCase();
        if (goal === 'SALE' || goal === 'RENT') {
            where.goal = goal;
        }
    }

    // Property Type (Legacy & Advanced)
    if (params.type && params.type !== 'any') {
        where.type = { equals: params.type, mode: 'insensitive' };
    }

    // Advanced Types (Subtypes)
    if (params.types && params.types.length > 0) {
        where.type = { in: params.types, mode: 'insensitive' };
    }

    // Advanced Categories
    if (params.categories && params.categories.length > 0) {
        where.category = { in: params.categories, mode: 'insensitive' };
    }

    // Condition (New Build / Resale)
    if (params.condition && params.condition !== 'any') {
        const condition = params.condition.toLowerCase();
        // Map common terms if necessary, or just use contains/mode insensitive
        // DB has "New", "Resale" usually
        if (condition.includes('new')) {
            where.condition = { contains: 'New', mode: 'insensitive' };
        } else if (condition.includes('resale')) {
            where.condition = { contains: 'Resale', mode: 'insensitive' };
        } else {
            where.condition = { equals: params.condition, mode: 'insensitive' };
        }
    }

    // Features (AND logic - must have all selected)
    if (params.features && params.features.length > 0) {
        where.features = { hasEvery: params.features };
    }

    // Location (Legacy & Advanced)
    const locationConditions: any[] = [];

    // Legacy City Search
    if (params.location && params.location !== 'any') {
        locationConditions.push({ city: { contains: params.location, mode: 'insensitive' } });
        // Also check propertyLocation if city fails?
    }

    // Advanced Locations (Districts)
    if (params.locations && params.locations.length > 0) {
        locationConditions.push({ propertyLocation: { in: params.locations, mode: 'insensitive' } });
        // Fallback or additional check for city matching the district name?
        locationConditions.push({ city: { in: params.locations, mode: 'insensitive' } });
    }

    // Advanced Areas (Villages)
    if (params.areas && params.areas.length > 0) {
        locationConditions.push({ propertyArea: { in: params.areas, mode: 'insensitive' } });
    }

    // Combine Location Conditions
    if (locationConditions.length > 0) {
        if (!where.AND) where.AND = [];
        where.AND.push({ OR: locationConditions });
    }

    // Reference Number
    if (params.reference) {
        if (!where.AND) where.AND = [];
        where.AND.push({
            OR: [
                { reference: { contains: params.reference, mode: 'insensitive' } },
                { slug: { contains: params.reference, mode: 'insensitive' } },
                { agentRef: { contains: params.reference, mode: 'insensitive' } },
            ]
        });
    }

    // Source
    if (params.source) {
        where.source = { equals: params.source, mode: 'insensitive' };
    }

    // Filter By
    if (params.filterBy) {
        switch (params.filterBy) {
            case 'promoted': where.featured = true; break;
            case 'videos': where.media = { some: { kind: 'VIDEO' } }; break;
            case 'matterport': where.media = { some: { kind: 'MATTERPORT' } }; break;
            case 'with_coords': where.latitude = { not: null }; break;
            case 'without_coords': where.latitude = null; break;
            case 'without_price': where.price = { equals: null }; break;
            case 'without_description': where.description = { equals: null }; break; // or empty string check
            case 'without_condition': where.condition = null; break;
            case 'without_bedrooms': where.bedrooms = null; break;
            case 'without_bathrooms': where.bathrooms = null; break;
            case 'without_plot_area': where.plotAreaSqm = null; break;
            case 'without_covered_area': where.coveredAreaSqm = null; break; // Check field name? (coveredAreaSqm is correct per schema)
            case 'without_build_year': where.buildYear = null; break;
        }
    }


    // Budget Logic (translates range to price)
    if (params.budget) {
        // Initialize price object if not exists
        if (!where.price) where.price = {};

        switch (params.budget) {
            case 'low': // Up to 200k
                where.price.lte = 200000;
                break;
            case 'mid': // 200k - 500k
                where.price.gte = 200000;
                where.price.lte = 500000;
                break;
            case 'high': // 500k - 1M
                where.price.gte = 500000;
                where.price.lte = 1000000;
                break;
            case 'luxury': // 1M+
                where.price.gte = 1000000;
                break;
        }
    }

    // Basic text search
    if (params.q) {
        if (!where.OR) where.OR = [];
        where.OR.push(
            { title: { contains: params.q, mode: "insensitive" } },
            { description: { contains: params.q, mode: "insensitive" } },
            { addressLine1: { contains: params.q, mode: "insensitive" } },
            { city: { contains: params.q, mode: "insensitive" } },
            { reference: { contains: params.q, mode: "insensitive" } }, // Also search reference in general search
        );
    }

    const properties = await db.property.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 50,
        include: {
            media: {
                orderBy: { sortOrder: 'asc' },
                take: 1, // Optimize fetch
            }
        }
    });

    // Map media to images array for UI compatibility
    return properties.map(p => ({
        ...p,
        media: p.media, // Pass full media object (contains cloudflareImageId)
        images: p.media.map(m => m.url)
    }));
});


export const getPublicPropertyBySlug = cache(async (locationId: string, slug: string) => {
    const property = await db.property.findFirst({
        where: {
            locationId, // STRICT TENANT ISOLATION
            slug,
            publicationStatus: 'PUBLISHED',
        },
        include: {
            media: {
                orderBy: { sortOrder: 'asc' }
            }
        }
    });

    if (!property) return null;

    return {
        ...property,
        media: property.media, // Pass full media object
        images: property.media.map(m => m.url)
    };
});

export const getFeaturedProperties = cache(async (locationId: string) => {
    const properties = await db.property.findMany({
        where: {
            locationId,
            featured: true,
            publicationStatus: 'PUBLISHED',
        },
        orderBy: { updatedAt: 'desc' },
        take: 4,
        include: {
            media: {
                orderBy: { sortOrder: 'asc' },
                take: 1,
            }
        }
    });

    return properties.map(p => ({
        ...p,
        media: p.media,
        images: p.media.map(m => m.url)
    }));
});

// Reusable interface for categories
export interface CategoryItemConfig {
    title: string;
    image?: string | null;
    filter?: {
        type?: string;
        condition?: string;
        status?: string; // sale/rent
    };
}

export interface CategoryBlockConfig {
    title?: string;
    items?: CategoryItemConfig[];
}

export const getCategoryCounts = cache(async (locationId: string, config?: CategoryBlockConfig) => {
    // Base Where Clause (Tenant Isolation)
    const baseWhere = {
        locationId,
        publicationStatus: 'PUBLISHED' as const
    };

    // Helper to get count and one image
    const getCategoryData = async (whereClause: any) => {
        // If image is provided in config, we don't strictly need to fetch it, but we still need the count.
        // If image is NOT provided, we definitely need to fetch one.
        // For simplicity, let's always fetch one sample property to get a fallback image if needed.
        const count = await db.property.count({ where: { ...baseWhere, ...whereClause } });

        const sample = await db.property.findFirst({
            where: { ...baseWhere, ...whereClause, media: { some: {} } },
            select: { media: { take: 1, orderBy: { sortOrder: 'asc' } } }
        });

        return { count, image: sample?.media[0]?.url || null };
    };

    // Case 1: Dynamic Configuration Provided
    if (config?.items && config.items.length > 0) {
        console.log("getCategoryCounts: Dynamic Config Found", JSON.stringify(config.items, null, 2));
        const results = await Promise.all(config.items.map(async (item) => {
            const where: any = {};
            // ... (existing filter construction) ...
            if (item.filter?.type && item.filter.type !== 'any') {
                const type = item.filter.type.toLowerCase();
                if (type === 'commercial') {
                    where.type = { in: ['Office', 'Shop', 'Commercial', 'Warehouse'], mode: 'insensitive' };
                } else if (type === 'land') {
                    where.type = { in: ['Land', 'Plot', 'Field'], mode: 'insensitive' };
                } else {
                    where.type = { equals: item.filter.type, mode: 'insensitive' };
                }
            }
            if (item.filter?.condition && item.filter.condition !== 'any') {
                const condition = item.filter.condition.toLowerCase();
                // DB has "New", "Resale" usually
                if (condition.includes('new')) {
                    where.condition = { contains: 'New', mode: 'insensitive' };
                } else if (condition.includes('resale')) {
                    where.condition = { contains: 'Resale', mode: 'insensitive' };
                } else {
                    where.condition = { equals: item.filter.condition, mode: 'insensitive' };
                }
            }
            if (item.filter?.status) { // Goal
                const goal = item.filter.status.toUpperCase();
                if (goal === 'SALE' || goal === 'RENT') {
                    where.goal = goal;
                }
            }

            const data = await getCategoryData(where);
            const finalImage = item.image || data.image;
            console.log(`Category: ${item.title} | Config Image: ${item.image ? 'Present' : 'Missing'} | DB Fallback: ${data.image ? 'Present' : 'Missing'} | Used: ${finalImage}`);

            return {
                title: item.title,
                count: data.count,
                image: finalImage, // Prefer config image, fallback to DB sample
                filter: item.filter
            };
        }));
        return { type: 'dynamic' as const, items: results };
    }

    // Case 2: Fallback to Hardcoded Defaults (Legacy Behavior)
    const [
        newVillas,
        resaleVillas,
        resaleApartments,
        newApartments,
        commercial,
        land,
        rentals
    ] = await Promise.all([
        // 1. New Build Villas
        getCategoryData({
            type: { contains: 'villa', mode: 'insensitive' },
            condition: { contains: 'New', mode: 'insensitive' },
            goal: 'SALE'
        }),
        // 2. Resale Villas
        getCategoryData({
            type: { contains: 'villa', mode: 'insensitive' },
            condition: { contains: 'Resale', mode: 'insensitive' },
            goal: 'SALE'
        }),
        // 3. Resale Apartments
        getCategoryData({
            type: { contains: 'apartment', mode: 'insensitive' },
            condition: { contains: 'Resale', mode: 'insensitive' },
            goal: 'SALE'
        }),
        // 4. New Apartments
        getCategoryData({
            type: { contains: 'apartment', mode: 'insensitive' },
            condition: { contains: 'New', mode: 'insensitive' },
            goal: 'SALE'
        }),
        // 5. Commercial
        getCategoryData({
            type: { contains: 'commercial', mode: 'insensitive' },
            goal: 'SALE'
        }),
        // 6. Land
        getCategoryData({
            type: { contains: 'land', mode: 'insensitive' }, // encompasses plot, field
            goal: 'SALE'
        }),
        // 7. Rentals (Any Type)
        getCategoryData({
            goal: 'RENT'
        })
    ]);

    return {
        type: 'static' as const,
        data: {
            newVillas,
            resaleVillas,
            resaleApartments,
            newApartments,
            commercial,
            land,
            rentals
        }
    };
});

export const getFilterCount = cache(async (locationId: string, params: SearchParams) => {
    // Reusing the same filter logic is slightly complex because getPublicProperties is coupled to fetching media and returning full objects.
    // However, we can copy the filter construction logic for optimal performance (using count() instead of findMany()).

    const where: any = {
        locationId,
        publicationStatus: 'PUBLISHED',
    };

    if (params.minPrice) where.price = { ...where.price, gte: params.minPrice };
    if (params.maxPrice) where.price = { ...where.price, lte: params.maxPrice };

    // Legacy Beds (>=)
    if (params.beds) where.bedrooms = { gte: params.beds };
    if (params.baths) where.bathrooms = { gte: params.baths };

    // New Advanced Bedrooms Logic (e.g. "2", "3", "5+")
    // Logic: OR condition for exact matches and GTE match for "5+"
    if (params.bedrooms && params.bedrooms.length > 0) {
        const exactBeds = params.bedrooms.filter(b => !b.includes('+')).map(Number);
        const minBeds = params.bedrooms.find(b => b.includes('+'));

        const conditions: any[] = [];
        if (exactBeds.length > 0) {
            conditions.push({ bedrooms: { in: exactBeds } });
        }
        if (minBeds) {
            const minVal = parseInt(minBeds.replace('+', ''));
            conditions.push({ bedrooms: { gte: minVal } });
        }

        if (conditions.length > 0) {
            if (!where.AND) where.AND = [];
            where.AND.push({ OR: conditions });
        }
    }

    if (params.status && !params.reference) {
        const goal = params.status.toUpperCase();
        if (goal === 'SALE' || goal === 'RENT') {
            where.goal = goal;
        }
    }

    // Property Type (Legacy & Advanced)
    if (params.type && params.type !== 'any') {
        where.type = { equals: params.type, mode: 'insensitive' };
    }

    // Advanced Types (Subtypes)
    if (params.types && params.types.length > 0) {
        where.type = { in: params.types, mode: 'insensitive' };
    }

    // Advanced Categories
    if (params.categories && params.categories.length > 0) {
        where.category = { in: params.categories, mode: 'insensitive' };
    }

    // Condition
    if (params.condition && params.condition !== 'any') {
        const condition = params.condition.toLowerCase();
        if (condition.includes('new')) {
            where.condition = { contains: 'New', mode: 'insensitive' };
        } else if (condition.includes('resale')) {
            where.condition = { contains: 'Resale', mode: 'insensitive' };
        } else {
            where.condition = { equals: params.condition, mode: 'insensitive' };
        }
    }

    // Features (AND logic - must have all selected)
    if (params.features && params.features.length > 0) {
        where.features = { hasEvery: params.features };
    }


    // Location (Legacy & Advanced)
    const locationConditions: any[] = [];

    // Legacy City Search
    if (params.location && params.location !== 'any') {
        locationConditions.push({ city: { contains: params.location, mode: 'insensitive' } });
    }

    // Advanced Locations (Districts)
    if (params.locations && params.locations.length > 0) {
        locationConditions.push({ propertyLocation: { in: params.locations, mode: 'insensitive' } });
        // Fallback or additional check for city matching the district name?
        locationConditions.push({ city: { in: params.locations, mode: 'insensitive' } });
    }

    // Advanced Areas (Villages)
    if (params.areas && params.areas.length > 0) {
        locationConditions.push({ propertyArea: { in: params.areas, mode: 'insensitive' } });
    }

    // Combine Location Conditions
    if (locationConditions.length > 0) {
        if (!where.AND) where.AND = [];
        where.AND.push({ OR: locationConditions });
    }

    if (params.reference) {
        if (!where.AND) where.AND = [];
        where.AND.push({
            OR: [
                { reference: { contains: params.reference, mode: 'insensitive' } },
                { slug: { contains: params.reference, mode: 'insensitive' } },
                { agentRef: { contains: params.reference, mode: 'insensitive' } },
            ]
        });
    }

    if (params.budget) {
        if (!where.price) where.price = {};
        switch (params.budget) {
            case 'low': where.price.lte = 200000; break;
            case 'mid': where.price.gte = 200000; where.price.lte = 500000; break;
            case 'high': where.price.gte = 500000; where.price.lte = 1000000; break;
            case 'luxury': where.price.gte = 1000000; break;
        }
    }

    // Source
    if (params.source) {
        where.source = { equals: params.source, mode: 'insensitive' };
    }

    // Filter By
    if (params.filterBy) {
        switch (params.filterBy) {
            case 'promoted': where.featured = true; break;
            case 'videos': where.media = { some: { kind: 'VIDEO' } }; break;
            case 'matterport': where.media = { some: { kind: 'MATTERPORT' } }; break;
            case 'with_coords': where.latitude = { not: null }; break;
            case 'without_coords': where.latitude = null; break;
            case 'without_price': where.price = { equals: null }; break;
            case 'without_description': where.description = { equals: null }; break;
            case 'without_condition': where.condition = null; break;
            case 'without_bedrooms': where.bedrooms = null; break;
            case 'without_bathrooms': where.bathrooms = null; break;
            case 'without_plot_area': where.plotAreaSqm = null; break;
            case 'without_covered_area': where.coveredAreaSqm = null; break;
            case 'without_build_year': where.buildYear = null; break;
        }
    }


    const count = await db.property.count({ where });
    return count;
});
