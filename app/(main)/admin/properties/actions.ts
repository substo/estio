"use server";

import db from "@/lib/db";
import { MediaKind, PropertyStatus, PublicationStatus } from "@prisma/client";
import { updatePropertyEmbedding } from "@/lib/ai/search/property-embeddings";
import { getLocationById } from "@/lib/location";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { currentUser } from "@clerk/nextjs/server";
import { ensureUserExists } from "@/lib/auth/sync-user";
import { verifyUserHasAccessToLocation } from "@/lib/auth/permissions";
import { parsePropertyImagePromptProfileUpsertsJson } from "@/lib/ai/property-image-prompt-profiles";
import { softDeleteOrphanedAssets } from "@/lib/media/media-assets";
import { savePropertyRecord } from "@/lib/properties/save-property-record";

const propertySchema = z.object({
    title: z.string().min(1),
    slug: z.string().optional().nullable(),
    description: z.string().optional().nullable(),
    reference: z.string().optional().nullable(),
    status: z.enum(["ACTIVE", "RESERVED", "SOLD", "RENTED", "WITHDRAWN"]),
    goal: z.enum(["SALE", "RENT"]).default("SALE"),
    publicationStatus: z.enum(["PUBLISHED", "PENDING", "DRAFT", "UNLISTED"]).default("PUBLISHED"),
    category: z.string().optional().nullable(),
    type: z.string().optional().nullable(),
    price: z.coerce.number().min(0),
    currency: z.string().default("EUR"),
    rentalPeriod: z.string().optional().nullable(),
    communalFees: z.coerce.number().min(0).optional().nullable(),
    bedrooms: z.coerce.number().int().min(0).optional().nullable(),
    bathrooms: z.coerce.number().int().min(0).optional().nullable(),
    areaSqm: z.coerce.number().int().min(0).optional().nullable(),
    coveredAreaSqm: z.coerce.number().int().min(0).optional().nullable(),
    coveredVerandaSqm: z.coerce.number().int().min(0).optional().nullable(),
    uncoveredVerandaSqm: z.coerce.number().int().min(0).optional().nullable(),
    basementSqm: z.coerce.number().int().min(0).optional().nullable(),
    plotAreaSqm: z.coerce.number().int().min(0).optional().nullable(),
    buildYear: z.coerce.number().int().min(0).optional().nullable(),
    floor: z.coerce.number().int().optional().nullable(),

    // Owner Details
    ownerId: z.string().optional().nullable(),
    ownerName: z.string().optional().nullable(),
    ownerEmail: z.string().optional().nullable(),
    ownerPhone: z.string().optional().nullable(),

    // Developer Details
    developerId: z.string().optional().nullable(),
    developerName: z.string().optional().nullable(),
    developerEmail: z.string().optional().nullable(),
    developerPhone: z.string().optional().nullable(),
    developerWebsite: z.string().optional().nullable(),

    // External Agent Details
    agentId: z.string().optional().nullable(),
    agentName: z.string().optional().nullable(),
    agentEmail: z.string().optional().nullable(),
    agentPhone: z.string().optional().nullable(),
    maintenanceIds: z.preprocess(parseIdArray, z.array(z.string())).optional(),

    addressLine1: z.string().optional().nullable(),
    addressLine2: z.string().optional().nullable(),
    city: z.string().optional().nullable(),
    propertyLocation: z.string().optional().nullable(),
    propertyArea: z.string().optional().nullable(),
    country: z.string().optional().nullable(),
    postalCode: z.string().optional().nullable(),
    latitude: z.coerce.number().optional().nullable(),
    longitude: z.coerce.number().optional().nullable(),
    condition: z.string().optional().nullable(),
    features: z.array(z.string()).optional(),
    featured: z.boolean().optional(),
    sortOrder: z.coerce.number().int().default(0),
    metaTitle: z.string().optional().nullable(),
    metaKeywords: z.string().optional().nullable(),
    metaDescription: z.string().optional().nullable(),
    mediaUrls: z.string().optional().nullable(),
    mediaJson: z.string().optional().nullable(),
    imagePromptProfilesUpsertsJson: z.string().optional().nullable(),
    videoUrls: z.string().optional().nullable(),
    documentUrls: z.string().optional().nullable(),
    // Notes Tab Fields
    internalNotes: z.string().optional().nullable(),
    agentRef: z.string().optional().nullable(),
    agentUrl: z.string().optional().nullable(),
    projectName: z.string().optional().nullable(),
    projectId: z.string().optional().nullable(),
    unitNumber: z.string().optional().nullable(),
    managementCompany: z.string().optional().nullable(),
    managementCompanyId: z.string().optional().nullable(),
    keyHolder: z.string().optional().nullable(),
    occupancyStatus: z.string().optional().nullable(),
    viewingContact: z.string().optional().nullable(),
    viewingNotes: z.string().optional().nullable(),
    viewingDirections: z.string().optional().nullable(),
    lawyer: z.string().optional().nullable(),
    loanDetails: z.string().optional().nullable(),
    purchasePrice: z.coerce.number().int().optional().nullable(),
    lowestOffer: z.coerce.number().int().optional().nullable(),
    landSurveyValue: z.coerce.number().int().optional().nullable(),
    estimatedValue: z.coerce.number().int().optional().nullable(),

    // Agency Agreement
    agencyAgreement: z.string().optional().nullable(),
    commission: z.string().optional().nullable(),
    agreementDate: z.preprocess((val) => (val === "" ? null : val), z.coerce.date().optional().nullable()),
    agreementNotes: z.string().optional().nullable(),

    // New Fields
    billsTransferable: z.boolean().optional(),
    priceIncludesCommunalFees: z.boolean().optional(),
    keyBoxCode: z.string().optional().nullable(),
    officeKeyNumber: z.string().optional().nullable(),

    // Import Metadata
    originalCreatorName: z.string().optional().nullable(),
    originalCreatorEmail: z.string().optional().nullable(),
    originalCreatedAt: z.preprocess((val) => (val === "" ? null : val), z.coerce.date().optional().nullable()),
    originalUpdatedAt: z.preprocess((val) => (val === "" ? null : val), z.coerce.date().optional().nullable()),
});

function parseIdArray(val: unknown): string[] | undefined {
    if (val === undefined) return undefined;
    if (val === null) return [];
    if (Array.isArray(val)) return val.map(v => String(v)).filter(Boolean);
    if (typeof val === 'string') {
        const trimmed = val.trim();
        if (!trimmed) return [];
        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) return parsed.map(v => String(v)).filter(Boolean);
            return [String(parsed)];
        } catch {
            return trimmed.split(',').map(s => s.trim()).filter(Boolean);
        }
    }
    return [String(val)];
}

// Helper to convert empty strings to null
const emptyToNull = (val: FormDataEntryValue | null) => {
    if (!val || val === "") return null;
    return val as string;
};

export async function upsertProperty(formData: FormData) {
    try {
        const locationId = formData.get("locationId") as string;
        const id = formData.get("id") as string;

        console.log('Upserting property:', { id, locationId });

        if (!locationId) throw new Error("Location ID required");

        const location = await getLocationById(locationId);
        if (!location) throw new Error("Location not found");

        const user = await currentUser();
        if (!user) throw new Error("Unauthorized");

        // Security Check: Verify user has access to this location
        console.log('[UPSERT_DEBUG] Checking access for user', user.id, 'location', locationId);
        const hasAccess = await verifyUserHasAccessToLocation(user.id, locationId);
        if (!hasAccess) {
            throw new Error("Unauthorized: Access Denied");
        }

        let dbUser = null;
        if (user) {
            dbUser = await ensureUserExists(user);
        }

        const rawData = {
            title: formData.get("title"),
            slug: formData.get("slug"),
            description: formData.get("description"),
            reference: emptyToNull(formData.get("reference")),
            status: formData.get("status"),
            goal: formData.get("goal"),
            publicationStatus: formData.get("publicationStatus"),
            category: formData.get("category"),
            type: formData.get("type"),
            price: formData.get("price"),
            currency: formData.get("currency"),
            rentalPeriod: formData.get("rentalPeriod"),
            communalFees: formData.get("communalFees"),
            bedrooms: formData.get("bedrooms"),
            bathrooms: formData.get("bathrooms"),
            areaSqm: formData.get("areaSqm"),
            coveredAreaSqm: formData.get("coveredAreaSqm"),
            coveredVerandaSqm: formData.get("coveredVerandaSqm"),
            uncoveredVerandaSqm: formData.get("uncoveredVerandaSqm"),
            basementSqm: formData.get("basementSqm"),
            plotAreaSqm: formData.get("plotAreaSqm"),
            buildYear: formData.get("buildYear"),
            floor: formData.get("floor"),

            // Owner/Developer/Agent fields
            ownerId: emptyToNull(formData.get("ownerId")),
            ownerName: formData.get("ownerName"),
            ownerEmail: formData.get("ownerEmail"),
            ownerPhone: formData.get("ownerPhone"),

            developerId: emptyToNull(formData.get("developerId")),
            developerName: formData.get("developerName"),
            developerEmail: formData.get("developerEmail"),
            developerPhone: formData.get("developerPhone"),
            developerWebsite: formData.get("developerWebsite"),

            agentId: emptyToNull(formData.get("agentId")),
            agentName: formData.get("agentName"),
            agentEmail: formData.get("agentEmail"),
            agentPhone: formData.get("agentPhone"),
            maintenanceIds: formData.has("maintenanceIds") ? formData.get("maintenanceIds") : undefined,

            addressLine1: formData.get("addressLine1"),
            addressLine2: formData.get("addressLine2"),
            city: formData.get("city"),
            propertyLocation: formData.get("propertyLocation"),
            propertyArea: formData.get("propertyArea"),
            country: formData.get("country"),
            postalCode: formData.get("postalCode"),
            latitude: formData.get("latitude"),
            longitude: formData.get("longitude"),
            condition: formData.get("condition"),
            features: formData.getAll("features"), // Get all selected features
            source: formData.get("source"),
            featured: formData.get("featured") === "on",
            sortOrder: formData.get("sortOrder"),
            metaTitle: formData.get("metaTitle"),
            metaKeywords: formData.get("metaKeywords"),
            metaDescription: formData.get("metaDescription"),
            mediaUrls: formData.get("mediaUrls"),
            mediaJson: formData.get("mediaJson"),
            imagePromptProfilesUpsertsJson: formData.get("imagePromptProfilesUpsertsJson"),
            videoUrls: formData.get("videoUrls"),
            documentUrls: formData.get("documentUrls"),
            // Notes Tab Fields
            internalNotes: formData.get("internalNotes"),
            agentRef: formData.get("agentRef"),
            agentUrl: formData.get("agentUrl"),
            projectName: formData.get("projectName"),
            projectId: emptyToNull(formData.get("projectId")),
            unitNumber: formData.get("unitNumber"),
            managementCompany: formData.get("managementCompany"),
            managementCompanyId: emptyToNull(formData.get("managementCompanyId")),
            keyHolder: formData.get("keyHolder"),
            occupancyStatus: formData.get("occupancyStatus"),
            viewingContact: formData.get("viewingContact"),
            viewingNotes: formData.get("viewingNotes"),
            viewingDirections: formData.get("viewingDirections"),
            lawyer: formData.get("lawyer"),
            loanDetails: formData.get("loanDetails"),
            purchasePrice: formData.get("purchasePrice"),
            lowestOffer: formData.get("lowestOffer"),
            landSurveyValue: formData.get("landSurveyValue"),
            estimatedValue: formData.get("estimatedValue"),

            agencyAgreement: formData.get("agencyAgreement"),
            commission: formData.get("commission"),
            agreementDate: formData.get("agreementDate"),
            agreementNotes: formData.get("agreementNotes"),

            billsTransferable: formData.get("billsTransferable") === "on",
            priceIncludesCommunalFees: formData.get("priceIncludesCommunalFees") === "on",
            keyBoxCode: formData.get("keyBoxCode"),
            officeKeyNumber: formData.get("officeKeyNumber"),

            // Import Metadata
            originalCreatorName: formData.get("originalCreatorName"),
            originalCreatorEmail: formData.get("originalCreatorEmail"),
            originalCreatedAt: formData.get("originalCreatedAt"),
            originalUpdatedAt: formData.get("originalUpdatedAt"),
        };

        console.log('Raw data:', rawData);

        const validated = propertySchema.parse(rawData);

        console.log('Validated data:', validated);
        const promptProfileUpserts = parsePropertyImagePromptProfileUpsertsJson(validated.imagePromptProfilesUpsertsJson);

        const mediaItems: { url: string; kind: MediaKind; sortOrder: number; cloudflareImageId?: string; metadata?: unknown }[] = [];

        // Process Images (New JSON flow preferred)
        let mediaJsonData: any[] = [];
        try {
            const rawJson = formData.get("mediaJson") as string;
            if (rawJson) {
                mediaJsonData = JSON.parse(rawJson);
            }
        } catch (e) {
            console.error("Failed to parse mediaJson", e);
        }

        if (mediaJsonData.length > 0) {
            mediaJsonData.forEach((item, index) => {
                // item: { url: string, cloudflareImageId?: string, kind?: MediaKind }
                mediaItems.push({
                    url: item.url,
                    kind: item.kind || MediaKind.IMAGE,
                    sortOrder: index,
                    cloudflareImageId: item.cloudflareImageId,
                    metadata: item.metadata,
                });
            });
        } else if (validated.mediaUrls) {
            // Fallback to legacy string splitting if no JSON provided
            validated.mediaUrls.split(",").map(u => u.trim()).filter(Boolean).forEach((url, index) => {
                mediaItems.push({ url, kind: MediaKind.IMAGE, sortOrder: index });
            });
        }

        // Process Videos (Legacy flow kept for now, or can be folded into mediaJson)
        if (validated.videoUrls) {
            validated.videoUrls.split("\n").map(u => u.trim()).filter(Boolean).forEach((url, index) => {
                mediaItems.push({ url, kind: MediaKind.VIDEO, sortOrder: mediaItems.length + index });
            });
        }

        // Process Documents
        if (validated.documentUrls) {
            validated.documentUrls.split("\n").map(u => u.trim()).filter(Boolean).forEach((url, index) => {
                mediaItems.push({ url, kind: 'DOCUMENT' as any, sortOrder: mediaItems.length + index });
            });
        }

        const propertyData = { ...validated };
        delete (propertyData as any).mediaUrls;
        delete (propertyData as any).videoUrls;
        delete (propertyData as any).documentUrls;
        delete (propertyData as any).mediaJson;
        delete (propertyData as any).imagePromptProfilesUpsertsJson;

        const property = await savePropertyRecord({
            id,
            location,
            actorUserId: dbUser?.id || null,
            propertyData,
            mediaItems,
            stakeholders: {
                ownerId: validated.ownerId,
                ownerName: validated.ownerName,
                ownerEmail: validated.ownerEmail,
                ownerPhone: validated.ownerPhone,
                developerId: validated.developerId,
                developerName: validated.developerName,
                developerEmail: validated.developerEmail,
                developerPhone: validated.developerPhone,
                developerWebsite: validated.developerWebsite,
                agentId: validated.agentId,
                agentName: validated.agentName,
                agentEmail: validated.agentEmail,
                agentPhone: validated.agentPhone,
                managementCompanyId: validated.managementCompanyId,
                maintenanceIds: validated.maintenanceIds,
            },
            promptProfileUpserts,
        });

        // ── AI: Update Property Embedding (fire-and-forget) ──
        updatePropertyEmbedding(property.id).catch(err =>
            console.error(`Background embedding update failed for ${property.id}:`, err)
        );

        revalidatePath("/admin/properties");
        revalidatePath(`/admin/properties/${property.id}`);

        if (id === "new") {
            redirect(`/admin/properties/${property.id}/view`);
        }
    } catch (error: any) {
        console.error('Error in upsertProperty:', error);
        // If it's a Zod error, log the details
        if (error.issues) {
            console.error('Zod issues:', JSON.stringify(error.issues, null, 2));
        }
        throw error;
    }
}

export async function deletePropertyAction(propertyId: string, locationId: string) {
    try {
        console.log(`Attempting to delete property ${propertyId} for location ${locationId}`);

        const user = await currentUser();
        if (!user) throw new Error("Unauthorized");

        // params locationId is passed from client, verifying access
        const hasAccess = await verifyUserHasAccessToLocation(user.id, locationId);
        if (!hasAccess) {
            throw new Error("Unauthorized: Access Denied");
        }

        // ── Capture media before deletion for orphan detection ──
        const deletingMedia = await db.propertyMedia.findMany({
            where: { propertyId, kind: 'IMAGE' },
            select: { cloudflareImageId: true },
        });

        // Use transaction to ensure all related data is cleaned up or nothing is
        await db.$transaction(async (tx) => {
            // 1. Delete Contact Roles
            await tx.contactPropertyRole.deleteMany({
                where: { propertyId }
            });

            // 2. Delete Company Roles
            await tx.companyPropertyRole.deleteMany({
                where: { propertyId }
            });

            // 3. Delete Media
            await tx.propertyMedia.deleteMany({
                where: { propertyId }
            });

            // 4. Delete Swipes
            await tx.propertySwipe.deleteMany({
                where: { propertyId }
            });

            // 5. Delete Viewings
            await tx.viewing.deleteMany({
                where: { propertyId }
            });

            // 6. Delete the Property itself
            await tx.property.delete({
                where: { id: propertyId, locationId }
            });
        });

        // ── Soft-delete orphaned media assets (after transaction) ──
        const cfIdsToCheck = deletingMedia
            .map(m => m.cloudflareImageId)
            .filter((id): id is string => !!id);
        if (cfIdsToCheck.length > 0) {
            await softDeleteOrphanedAssets(cfIdsToCheck);
        }

        console.log(`Successfully deleted property ${propertyId}`);
        revalidatePath("/admin/properties");
        return { success: true };
    } catch (error) {
        console.error("Failed to delete property:", error);
        throw new Error("Failed to delete property");
    }
}

type FeedInboxBulkAction = 'publish' | 'draft' | 'pending' | 'withdraw';

export async function bulkUpdateFeedInboxPropertiesAction(
    params: {
        propertyIds: string[];
        locationId: string;
        action: FeedInboxBulkAction;
    }
) {
    const { propertyIds, locationId, action } = params;

    if (!locationId) {
        throw new Error("Location ID required");
    }

    const uniqueIds = Array.from(new Set((propertyIds || []).filter(Boolean)));
    if (uniqueIds.length === 0) {
        return { success: true, updatedCount: 0 };
    }

    const user = await currentUser();
    if (!user) throw new Error("Unauthorized");

    const hasAccess = await verifyUserHasAccessToLocation(user.id, locationId);
    if (!hasAccess) {
        throw new Error("Unauthorized: Access Denied");
    }

    const feedProps = await db.property.findMany({
        where: {
            id: { in: uniqueIds },
            locationId,
            source: 'FEED',
        },
        select: { id: true },
    });

    const allowedIds = feedProps.map((p) => p.id);
    if (allowedIds.length === 0) {
        return { success: true, updatedCount: 0 };
    }

    let data: { publicationStatus?: PublicationStatus; status?: PropertyStatus } = {};

    switch (action) {
        case 'publish':
            data = { publicationStatus: 'PUBLISHED' };
            break;
        case 'draft':
            data = { publicationStatus: 'DRAFT' };
            break;
        case 'pending':
            data = { publicationStatus: 'PENDING' };
            break;
        case 'withdraw':
            data = { status: 'WITHDRAWN', publicationStatus: 'UNLISTED' };
            break;
        default:
            throw new Error("Unsupported action");
    }

    const result = await db.property.updateMany({
        where: {
            id: { in: allowedIds },
            locationId,
            source: 'FEED',
        },
        data,
    });

    revalidatePath("/admin/properties");
    revalidatePath("/admin/properties/feed-inbox");

    return {
        success: true,
        updatedCount: result.count,
        ignoredCount: uniqueIds.length - allowedIds.length,
    };
}

import { pushPropertyToCrm } from "@/lib/crm/crm-pusher";
import { pullPropertyFromCrm } from "@/lib/crm/crm-puller";

export async function pushToOldCrm(propertyId: string) {
    const user = await currentUser();
    if (!user) throw new Error("Unauthorized");

    // We pass the user ID so the service can look up CRM credentials from the DB User record
    return await pushPropertyToCrm(propertyId, user.id);
}

export async function pullFromOldCrm(oldPropertyId: string) {
    const user = await currentUser();
    if (!user) throw new Error("Unauthorized");

    return await pullPropertyFromCrm(oldPropertyId, user.id);
}

export async function linkPropertyCreator(propertyId: string, email: string) {
    const user = await currentUser();
    if (!user) throw new Error("Unauthorized");

    if (!propertyId || !email) {
        throw new Error("Property ID and Email are required");
    }

    const dbUser = await db.user.findUnique({ where: { email } });

    let targetUserId = dbUser?.id;

    if (!targetUserId) {
        // User doesn't exist? Create a placeholder so we can link them.
        // The auth system (ensureUserExists) handles merging by email later.
        console.log(`[linkPropertyCreator] Creating placeholder user for ${email}`);

        // We need to fetch the name from the property if we don't have it, 
        // but it's not passed here. Ideally we should pass it or fetch property.
        // For efficiency, let's fetch property first or just use email as name fallback.
        const prop = await db.property.findUnique({
            where: { id: propertyId },
            select: { originalCreatorName: true }
        });

        const newUser = await db.user.create({
            data: {
                email,
                name: prop?.originalCreatorName || email.split('@')[0],
                // No clerkId yet. 
            }
        });
        targetUserId = newUser.id;
    }

    // Update property with both metadata and the actual relation
    await db.property.update({
        where: { id: propertyId },
        data: {
            originalCreatorEmail: email,
            createdById: targetUserId
        } as any
    });

    revalidatePath("/admin/properties");
    revalidatePath(`/admin/properties/${propertyId}`);

    return {
        success: true,
        linked: true,
        message: dbUser ? `Linked to existing user ${dbUser.name}` : `Created and linked new user for ${email}`
    };
}
