import { ghlFetch } from '@/lib/ghl/client';
import { GHLListResponse, GHLProperty } from '@/lib/ghl/types';
import db from '@/lib/db';
import { Property, PropertyStatus, ListingGoal, PublicationStatus } from '@prisma/client';

const OBJECT_KEY = 'custom_object.property';

export interface ListPropertiesParams {
    limit?: number;
    skip?: number;
    q?: string; // Search query
    status?: string;
    publicationStatus?: string; // New: Publication Status
    goal?: string;
    location?: string;
    locations?: string[]; // New: List of districts
    areas?: string[]; // New: List of specific areas
    min_price?: number;
    max_price?: number;
    min_bedrooms?: number;
    max_bedrooms?: number;
    bedrooms?: string[]; // New: List of bedroom counts (e.g. ['2', '3', '5+'])
    sort?: string[]; // e.g. ['price:asc', 'dateAdded:desc']
    category?: string; // Legacy
    subtype?: string; // Legacy
    categories?: string[]; // New: List of categories
    types?: string[]; // New: List of subtypes
    features?: string[]; // New: List of features
    condition?: string; // New: Condition
    source?: string; // New: Source (Estio or GHL)
    filterBy?: string; // New: Special filters
    // owner?: string; // REMOVED
}

import { getCategoryForSubtype } from '@/lib/properties/constants';

// ... imports

// Helper to map Prisma Property to GHLProperty format
function mapPrismaToGHL(p: Property): GHLProperty {
    return {
        id: p.id,
        locationId: p.locationId,
        properties: {
            property_reference: p.slug, // Mapping slug to reference
            title: p.title,
            status: mapPrismaStatusToGHL(p.status),
            goal: p.goal === 'SALE' ? 'For Sale' : 'For Rent',
            publication_status: mapPrismaPubStatusToGHL(p.publicationStatus),
            location: (p.propertyLocation as any) || 'Paphos',
            location_area: p.propertyArea || undefined,
            area: p.areaSqm?.toString() || '',
            address_line: p.addressLine1 || '',
            type_category: (p.category as any) || 'house',
            type_subtype: (p.type as any) || undefined,
            price: p.price || 0,
            currency: (p.currency as any) || 'EUR',
            bedrooms: p.bedrooms || 0,
            bathrooms: p.bathrooms || 0,
            internal_size_sqm: p.areaSqm || 0,
            plot_size_sqm: p.plotAreaSqm || 0,
            build_year: p.buildYear || 0,
            floor: p.floor || 0,
            // owner_name: p.ownerName || '', // REMOVED
            features: p.features,
            condition: (p.condition as any) || undefined,
            source: (p.source as any) || 'Estio', // Add source to GHLProperty if needed, or just use it internally
        },
        dateAdded: p.createdAt.toISOString(),
        dateUpdated: p.updatedAt.toISOString(),
    };
}

function mapPrismaStatusToGHL(status: PropertyStatus): any {
    const map: Record<PropertyStatus, string> = {
        ACTIVE: 'Active',
        RESERVED: 'Reserved',
        SOLD: 'Sold',
        RENTED: 'Rented',
        WITHDRAWN: 'Withdrawn'
    };
    return map[status] || 'Active';
}

function mapPrismaPubStatusToGHL(status: PublicationStatus): any {
    const map: Record<PublicationStatus, string> = {
        PUBLISHED: 'Published',
        PENDING: 'Pending',
        DRAFT: 'Draft',
        UNLISTED: 'Unlisted'
    };
    return map[status] || 'Published';
}

export async function listProperties(
    accessToken: string | null | undefined,
    params: ListPropertiesParams = {},
    locationId?: string // Required for local DB fallback
): Promise<GHLListResponse<GHLProperty>> {
    // 1. GHL Mode - DISABLED for now to prevent 404s on refresh
    // We want to use the local DB as the source of truth for listing properties.
    // Syncing should happen via Webhooks (GHL -> App) or explicit actions (App -> GHL).

    // 2. Standalone Mode (Local DB)
    if (!locationId) {
        throw new Error('Location ID required for standalone mode');
    }

    // Re-implementing the 'where' construction properly:
    const finalWhere: any = { AND: [] };
    finalWhere.AND.push({ locationId });

    if (params.q) {
        finalWhere.AND.push({
            OR: [
                { title: { contains: params.q, mode: 'insensitive' } },
                { slug: { contains: params.q, mode: 'insensitive' } },
                { reference: { contains: params.q, mode: 'insensitive' } },
            ]
        });
    }

    if (params.status && params.status !== 'all') {
        const statusMap: Record<string, PropertyStatus> = {
            'Active': 'ACTIVE',
            'Reserved': 'RESERVED',
            'Sold': 'SOLD',
            'Rented': 'RENTED',
            'Withdrawn': 'WITHDRAWN'
        };
        if (statusMap[params.status]) {
            finalWhere.AND.push({ status: statusMap[params.status] });
        }
    }

    if (params.goal && params.goal !== 'all') {
        const goalMap: Record<string, ListingGoal> = {
            'For Sale': 'SALE',
            'For Rent': 'RENT'
        };
        if (goalMap[params.goal]) {
            finalWhere.AND.push({ goal: goalMap[params.goal] });
        }
    }

    if (params.locations && params.locations.length > 0) {
        finalWhere.AND.push({ propertyLocation: { in: params.locations } });
    } else if (params.location && params.location !== 'all') {
        finalWhere.AND.push({ propertyLocation: params.location });
    }

    if (params.areas && params.areas.length > 0) {
        finalWhere.AND.push({ propertyArea: { in: params.areas } });
    }

    if (params.publicationStatus && params.publicationStatus !== 'all') {
        const pubMap: Record<string, PublicationStatus> = {
            'Published': 'PUBLISHED',
            'Draft': 'DRAFT',
            'Unlisted': 'UNLISTED',
            'Pending': 'PENDING',
            'Enabled': 'PUBLISHED', // Alias
            'Disabled': 'UNLISTED' // Alias
        };
        if (pubMap[params.publicationStatus]) {
            finalWhere.AND.push({ publicationStatus: pubMap[params.publicationStatus] });
        }
    }

    const categoryFilters = params.categories || (params.category ? [params.category] : []);
    const typeFilters = params.types || (params.subtype ? [params.subtype] : []);

    if (categoryFilters.length > 0 || typeFilters.length > 0) {
        const typeOr: any[] = [];
        if (categoryFilters.length > 0) typeOr.push({ category: { in: categoryFilters } });
        if (typeFilters.length > 0) typeOr.push({ type: { in: typeFilters } });
        finalWhere.AND.push({ OR: typeOr });
    }

    if (params.min_price) finalWhere.AND.push({ price: { gte: params.min_price } });
    if (params.max_price) finalWhere.AND.push({ price: { lte: params.max_price } });

    // Handle Bedrooms Filter
    if (params.bedrooms && params.bedrooms.length > 0) {
        const exactBedrooms: number[] = [];
        let hasFivePlus = false;

        params.bedrooms.forEach(b => {
            if (b === '5+') {
                hasFivePlus = true;
            } else {
                const num = parseInt(b);
                if (!isNaN(num)) exactBedrooms.push(num);
            }
        });

        const bedroomConditions: any[] = [];
        if (exactBedrooms.length > 0) {
            bedroomConditions.push({ bedrooms: { in: exactBedrooms } });
        }
        if (hasFivePlus) {
            bedroomConditions.push({ bedrooms: { gte: 5 } });
        }

        if (bedroomConditions.length > 0) {
            finalWhere.AND.push({ OR: bedroomConditions });
        }
    } else if (params.min_bedrooms) {
        // Fallback for legacy min_bedrooms
        finalWhere.AND.push({ bedrooms: { gte: params.min_bedrooms } });
    }

    if (params.features && params.features.length > 0) {
        // Use hasEvery to ensure property has ALL selected features
        finalWhere.AND.push({ features: { hasEvery: params.features } });
    }

    if (params.condition && params.condition !== 'all') {
        finalWhere.AND.push({ condition: params.condition });
    }

    if (params.source && params.source !== 'all') {
        finalWhere.AND.push({ source: params.source });
    }

    // if (params.owner && params.owner !== 'all') {
    //     finalWhere.AND.push({ ownerName: params.owner });
    // }

    if (params.filterBy) {
        switch (params.filterBy) {
            case 'special_offers':
                finalWhere.AND.push({ features: { has: 'reduced' } });
                break;
            case 'promoted':
                finalWhere.AND.push({ featured: true });
                break;
            case 'has_lat_long':
                finalWhere.AND.push({
                    latitude: { not: null },
                    longitude: { not: null }
                });
                break;
            case 'has_videos':
                finalWhere.AND.push({
                    media: { some: { kind: 'VIDEO' } }
                });
                break;
            case 'no_lat_long':
                finalWhere.AND.push({
                    OR: [
                        { latitude: null },
                        { longitude: null }
                    ]
                });
                break;
            case 'no_price':
                finalWhere.AND.push({
                    OR: [
                        { price: null },
                        { price: 0 }
                    ]
                });
                break;
            case 'no_description':
                finalWhere.AND.push({
                    OR: [
                        { description: null },
                        { description: '' }
                    ]
                });
                break;
            case 'no_condition':
                finalWhere.AND.push({ condition: null });
                break;
            case 'no_bedrooms':
                finalWhere.AND.push({
                    OR: [
                        { bedrooms: null },
                        { bedrooms: 0 }
                    ]
                });
                break;
            case 'no_bathrooms':
                finalWhere.AND.push({
                    OR: [
                        { bathrooms: null },
                        { bathrooms: 0 }
                    ]
                });
                break;
            case 'no_plot_area':
                finalWhere.AND.push({
                    OR: [
                        { plotAreaSqm: null },
                        { plotAreaSqm: 0 }
                    ]
                });
                break;
            case 'no_covered_area':
                finalWhere.AND.push({
                    OR: [
                        { areaSqm: null },
                        { areaSqm: 0 }
                    ]
                });
                break;
            case 'no_build_year':
                finalWhere.AND.push({
                    OR: [
                        { buildYear: null },
                        { buildYear: 0 }
                    ]
                });
                break;
            case 'no_owner':
                // finalWhere.AND.push({
                //     OR: [
                //         { ownerName: null },
                //         { ownerName: '' }
                //     ]
                // });
                break;
            case 'has_matterport':
                finalWhere.AND.push({
                    media: { some: { kind: 'MATTERPORT' } }
                });
                break;
        }
    }

    const [properties, total] = await Promise.all([
        db.property.findMany({
            where: finalWhere,
            take: params.limit || 10,
            skip: params.skip || 0,
            orderBy: { createdAt: 'desc' }, // Default sort
        }),
        db.property.count({ where: finalWhere }),
    ]);

    return {
        customObjects: properties.map(mapPrismaToGHL),
        total,
    };
}

export async function getPropertyById(
    accessToken: string | null | undefined,
    id: string,
    locationId?: string
): Promise<GHLProperty | null> {
    if (accessToken) {
        return ghlFetch<GHLProperty>(
            `/objects/${OBJECT_KEY}/records/${id}`,
            accessToken
        );
    }

    if (!locationId) throw new Error('Location ID required');

    const property = await db.property.findFirst({
        where: { id, locationId },
    });

    return property ? mapPrismaToGHL(property) : null;
}

export async function getUniqueOwners(locationId: string): Promise<string[]> {
    // Deprecated: Owners are now Contacts
    return [];
}

export async function getPropertyByReference(
    accessToken: string | null | undefined,
    reference: string,
    locationId?: string
): Promise<GHLProperty | null> {
    if (accessToken) {
        // Try to search for it
        // Note: GHL Search API might be fuzzy, so we verify the exact match
        const response = await ghlFetch<GHLListResponse<GHLProperty>>(
            `/objects/${OBJECT_KEY}/records?q=${encodeURIComponent(reference)}&limit=10`,
            accessToken
        );

        if (!response.customObjects || response.customObjects.length === 0) {
            return null;
        }

        const match = response.customObjects.find(
            p => p.properties.property_reference === reference
        );

        return match || null;
    }

    if (!locationId) throw new Error('Location ID required');

    const property = await db.property.findUnique({
        where: { slug: reference }, // Assuming slug is unique globally, or we need composite unique
    });

    // Verify location ownership
    if (property && property.locationId !== locationId) return null;

    return property ? mapPrismaToGHL(property) : null;
}

// Helper to upsert property to local DB
async function upsertLocalProperty(
    locationId: string,
    ghlProp: GHLProperty
): Promise<Property> {
    const data = ghlProp.properties;

    // Try to find by slug first
    const existing = await db.property.findFirst({
        where: {
            locationId,
            slug: data.property_reference
        }
    });

    const statusMap: Record<string, PropertyStatus> = {
        'Active': 'ACTIVE',
        'Reserved': 'RESERVED',
        'Sold': 'SOLD',
        'Rented': 'RENTED',
        'Withdrawn': 'WITHDRAWN'
    };

    const goalMap: Record<string, ListingGoal> = {
        'For Sale': 'SALE',
        'For Rent': 'RENT'
    };

    const pubMap: Record<string, PublicationStatus> = {
        'Published': 'PUBLISHED',
        'Pending': 'PENDING',
        'Draft': 'DRAFT',
        'Unlisted': 'UNLISTED'
    };

    const payload = {
        title: data.title || 'Untitled',
        slug: data.property_reference,
        status: statusMap[data.status] || 'ACTIVE',
        goal: goalMap[data.goal] || 'SALE',
        publicationStatus: pubMap[data.publication_status] || 'PUBLISHED',
        price: data.price,
        currency: data.currency,
        bedrooms: data.bedrooms,
        bathrooms: data.bathrooms,
        areaSqm: data.internal_size_sqm,
        floor: data.floor,
        type: data.type_subtype as string, // Store subtype key in 'type' field
        propertyArea: data.location_area, // Store area key
        addressLine1: data.address_line,
        features: data.features || [],
        condition: data.condition,
        source: 'GHL', // Mark as GHL since this comes from upsertLocalProperty (sync)
        // Add other fields mapping
    };

    if (existing) {
        return db.property.update({
            where: { id: existing.id },
            data: payload,
        });
    } else {
        return db.property.create({
            data: {
                ...payload,
                locationId,
            },
        });
    }
}

export async function createProperty(
    accessToken: string | null | undefined,
    data: Partial<GHLProperty['properties']>,
    locationId?: string
): Promise<GHLProperty> {
    if (accessToken) {
        const ghlProp = await ghlFetch<GHLProperty>(
            `/objects/${OBJECT_KEY}/records`,
            accessToken,
            {
                method: 'POST',
                body: JSON.stringify({ properties: data }),
            }
        );

        // Write-through to local DB if locationId is available
        if (locationId) {
            try {
                await upsertLocalProperty(locationId, ghlProp);
            } catch (err) {
                console.error('Failed to sync created property to local DB:', err);
                // Don't fail the request if sync fails, but log it
            }
        }

        return ghlProp;
    }

    if (!locationId) throw new Error('Location ID required');

    const statusMap: Record<string, PropertyStatus> = {
        'Active': 'ACTIVE',
        'Reserved': 'RESERVED',
        'Sold': 'SOLD',
        'Rented': 'RENTED',
        'Withdrawn': 'WITHDRAWN'
    };

    const goalMap: Record<string, ListingGoal> = {
        'For Sale': 'SALE',
        'For Rent': 'RENT'
    };

    const pubMap: Record<string, PublicationStatus> = {
        'Published': 'PUBLISHED',
        'Pending': 'PENDING',
        'Draft': 'DRAFT',
        'Unlisted': 'UNLISTED'
    };

    // Create in Local DB
    const property = await db.property.create({
        data: {
            locationId,
            title: data.title || 'Untitled Property',
            slug: data.property_reference || `REF-${Date.now()}`,
            status: statusMap[data.status as string] || 'ACTIVE',
            goal: goalMap[data.goal as string] || 'SALE',
            publicationStatus: pubMap[data.publication_status as string] || 'PUBLISHED',
            price: data.price,
            currency: data.currency,
            bedrooms: data.bedrooms,
            bathrooms: data.bathrooms,
            areaSqm: data.internal_size_sqm,
            plotAreaSqm: data.plot_size_sqm,
            buildYear: data.build_year,
            floor: data.floor,
            // ownerName: data.owner_name, // REMOVED
            type: data.type_subtype as string,
            propertyArea: data.location_area,
            addressLine1: data.address_line,
            features: data.features || [],
            condition: data.condition,
            source: 'Estio', // Explicitly mark as Estio created
            // Map other fields as needed
        },
    });

    return mapPrismaToGHL(property);
}

export async function updateProperty(
    accessToken: string | null | undefined,
    id: string,
    data: Partial<GHLProperty['properties']>,
    locationId?: string
): Promise<GHLProperty> {
    if (accessToken) {
        const ghlProp = await ghlFetch<GHLProperty>(
            `/objects/${OBJECT_KEY}/records/${id}`,
            accessToken,
            {
                method: 'PUT',
                body: JSON.stringify({ properties: data }),
            }
        );

        // Write-through to local DB if locationId is available
        if (locationId) {
            try {
                await upsertLocalProperty(locationId, ghlProp);
            } catch (err) {
                console.error('Failed to sync updated property to local DB:', err);
            }
        }

        return ghlProp;
    }

    if (!locationId) throw new Error('Location ID required');

    // For local update, we need to find the property by ID first
    // But wait, 'id' here might be GHL ID if we came from GHL list?
    // Or it might be Local ID if we came from Local list?
    // If we are in Standalone mode, 'id' is definitely Local ID.
    // If we are in GHL mode, 'id' is GHL ID.

    // If we are in GHL mode, we used GHL ID to update GHL.
    // upsertLocalProperty uses SLUG to find local record.
    // So it should work fine regardless of ID mismatch, as long as SLUG matches.

    const updateData: any = {
        title: data.title,
        price: data.price,
        bedrooms: data.bedrooms,
        features: data.features,
        condition: data.condition,
        plotAreaSqm: data.plot_size_sqm,
        buildYear: data.build_year,
        floor: data.floor,
        // ownerName: data.owner_name, // REMOVED
        // Add other fields
    };

    if (data.status) {
        const statusMap: Record<string, PropertyStatus> = {
            'Active': 'ACTIVE',
            'Reserved': 'RESERVED',
            'Sold': 'SOLD',
            'Rented': 'RENTED',
            'Withdrawn': 'WITHDRAWN'
        };
        if (statusMap[data.status]) updateData.status = statusMap[data.status];
    }

    if (data.goal) {
        const goalMap: Record<string, ListingGoal> = {
            'For Sale': 'SALE',
            'For Rent': 'RENT'
        };
        if (goalMap[data.goal]) updateData.goal = goalMap[data.goal];
    }

    if (data.publication_status) {
        const pubMap: Record<string, PublicationStatus> = {
            'Published': 'PUBLISHED',
            'Pending': 'PENDING',
            'Draft': 'DRAFT',
            'Unlisted': 'UNLISTED'
        };
        if (pubMap[data.publication_status]) updateData.publicationStatus = pubMap[data.publication_status];
    }

    const property = await db.property.update({
        where: { id },
        data: updateData,
    });

    return mapPrismaToGHL(property);
}

// Optional: Archive/Delete if supported
export async function deleteProperty(
    accessToken: string | null | undefined,
    id: string,
    locationId?: string
): Promise<void> {
    if (accessToken) {
        return ghlFetch<void>(
            `/objects/${OBJECT_KEY}/records/${id}`,
            accessToken,
            {
                method: 'DELETE',
            }
        );
    }

    if (!locationId) throw new Error('Location ID required');

    await db.property.delete({
        where: { id },
    });
}

export async function syncToGHL(
    accessToken: string,
    data: Partial<Property> & { features?: string[] },
    existingGhlId?: string
): Promise<string | null> {
    try {
        const ghlData: any = {
            property_reference: data.slug,
            title: data.title,
            status: mapPrismaStatusToGHL(data.status || 'ACTIVE'),
            goal: data.goal === 'SALE' ? 'For Sale' : 'For Rent',
            publication_status: mapPrismaPubStatusToGHL(data.publicationStatus || 'PUBLISHED'),
            price: data.price,
            currency: data.currency || 'EUR',
            bedrooms: data.bedrooms,
            bathrooms: data.bathrooms,
            internal_size_sqm: data.areaSqm,
            plot_size_sqm: data.plotAreaSqm,
            build_year: data.buildYear,
            floor: data.floor,
            // owner_name: data.ownerName, // REMOVED
            address_line: data.addressLine1,
            location_area: data.propertyArea,
            type_category: data.category || 'house',
            type_subtype: data.type,
            features: data.features,
            condition: data.condition,
            source: 'Estio',
        };

        // Remove undefined values
        Object.keys(ghlData).forEach(key => ghlData[key] === undefined && delete ghlData[key]);

        if (existingGhlId) {
            // Update
            await ghlFetch(
                `/objects/${OBJECT_KEY}/records/${existingGhlId}`,
                accessToken,
                {
                    method: 'PUT',
                    body: JSON.stringify({ properties: ghlData }),
                }
            );
            return existingGhlId;
        } else {
            // Create
            // First check if it exists by reference to avoid duplicates
            if (data.slug) {
                const existing = await getPropertyByReference(accessToken, data.slug);
                if (existing) {
                    // Update existing
                    await ghlFetch(
                        `/objects/${OBJECT_KEY}/records/${existing.id}`,
                        accessToken,
                        {
                            method: 'PUT',
                            body: JSON.stringify({ properties: ghlData }),
                        }
                    );
                    return existing.id;
                }
            }

            const res = await ghlFetch<GHLProperty>(
                `/objects/${OBJECT_KEY}/records`,
                accessToken,
                {
                    method: 'POST',
                    body: JSON.stringify({ properties: ghlData }),
                }
            );
            return res.id;
        }
    } catch (error) {
        console.error('Failed to sync to GHL:', error);
        return null;
    }
}
