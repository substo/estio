"use server";

import db from "@/lib/db";
import { MediaKind } from "@prisma/client";
import { getLocationById, refreshGhlAccessToken } from "@/lib/location";
import { syncToGHL } from "@/lib/properties/repository";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { syncContactToGHL, syncCompanyToGHL } from "@/lib/ghl/stakeholders";
import { currentUser } from "@clerk/nextjs/server";
import { ensureUserExists } from "@/lib/auth/sync-user";
import { verifyUserHasAccessToLocation } from "@/lib/auth/permissions";

// Helper to handle Contact Role Upsert (Local + GHL)
async function upsertContactRole(
    location: any,
    propertyId: string,
    role: string,
    data: { name?: string | null, email?: string | null, phone?: string | null }
) {
    if (!data.name) return; // Name is required

    console.log(`Processing ${role} contact role: ${data.name}`);

    // 1. Sync to GHL first (to get ID)
    let ghlId: string | null = null;
    if (location.ghlRefreshToken && location.ghlLocationId) {
        try {
            const tokens = await refreshGhlAccessToken(location);
            if (tokens.ghlAccessToken) {
                ghlId = await syncContactToGHL(location.ghlLocationId, {
                    name: data.name,
                    email: data.email || undefined,
                    phone: data.phone || undefined,
                    tags: [role] // Tag with role (e.g. 'Owner', 'Agent')
                });
                console.log(`Synced ${role} to GHL. ID: ${ghlId}`);
            }
        } catch (err) {
            console.error(`Failed to sync ${role} to GHL:`, err);
        }
    }

    // 2. Upsert Local Contact
    let contact;
    if (ghlId) {
        contact = await db.contact.findFirst({ where: { ghlContactId: ghlId } });
    }

    // Fallback: Find by email if contact
    if (!contact && data.email) {
        contact = await db.contact.findFirst({ where: { email: data.email, locationId: location.id } });
    }

    if (contact) {
        // Update existing contact
        contact = await db.contact.update({
            where: { id: contact.id },
            data: {
                name: data.name,
                // Only update email/phone if they are missing or if we want to overwrite?
                // Let's overwrite for now as this is an edit form
                email: data.email || contact.email,
                phone: data.phone || contact.phone,
                ghlContactId: ghlId || contact.ghlContactId,
            }
        });
    } else {
        // Create new contact
        contact = await db.contact.create({
            data: {
                locationId: location.id,
                status: 'NEW', // Default status
                name: data.name,
                email: data.email,
                phone: data.phone,
                ghlContactId: ghlId,
            }
        });
    }

    // 3. Upsert ContactPropertyRole
    // Check if role exists
    const existingRole = await db.contactPropertyRole.findUnique({
        where: {
            contactId_propertyId_role: {
                contactId: contact.id,
                propertyId: propertyId,
                role: role
            }
        }
    });

    if (!existingRole) {
        await db.contactPropertyRole.create({
            data: {
                contactId: contact.id,
                propertyId: propertyId,
                role: role
            }
        });
    }
}

// Helper to handle Company Role Upsert (Local + GHL)
async function upsertCompanyRole(
    location: any,
    propertyId: string,
    role: string,
    data: { name?: string | null, email?: string | null, phone?: string | null, website?: string | null }
) {
    if (!data.name) return; // Name is required

    console.log(`Processing ${role} company role: ${data.name}`);

    // 1. Sync to GHL first (to get ID)
    let ghlId: string | null = null;
    if (location.ghlRefreshToken && location.ghlLocationId) {
        try {
            const tokens = await refreshGhlAccessToken(location);
            if (tokens.ghlAccessToken) {
                ghlId = await syncCompanyToGHL(location.ghlLocationId, {
                    name: data.name,
                    email: data.email || undefined,
                    phone: data.phone || undefined,
                    website: data.website || undefined,
                    tags: [role] // Tag with role (e.g. 'Developer')
                });
                console.log(`Synced ${role} to GHL. ID: ${ghlId}`);
            }
        } catch (err) {
            console.error(`Failed to sync ${role} to GHL:`, err);
        }
    }

    // 2. Upsert Local Company
    let company;
    if (ghlId) {
        company = await db.company.findUnique({ where: { ghlCompanyId: ghlId } });
    }

    // Fallback: Find by name (Companies are usually unique by name in a location)
    if (!company) {
        company = await db.company.findFirst({ where: { name: data.name, locationId: location.id } });
    }

    if (company) {
        // Update existing company
        company = await db.company.update({
            where: { id: company.id },
            data: {
                email: data.email || company.email,
                phone: data.phone || company.phone,
                website: data.website || company.website,
                ghlCompanyId: ghlId || company.ghlCompanyId,
            }
        });
    } else {
        // Create new company
        company = await db.company.create({
            data: {
                locationId: location.id,
                name: data.name,
                email: data.email,
                phone: data.phone,
                website: data.website,
                ghlCompanyId: ghlId,
            }
        });
    }

    // 3. Upsert CompanyPropertyRole
    const existingRole = await db.companyPropertyRole.findUnique({
        where: {
            companyId_propertyId_role: {
                companyId: company.id,
                propertyId: propertyId,
                role: role
            }
        }
    });

    if (!existingRole) {
        await db.companyPropertyRole.create({
            data: {
                companyId: company.id,
                propertyId: propertyId,
                role: role
            }
        });
    }
}

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

        // Handle Management Company Name lookup
        if (validated.managementCompanyId) {
            const mgmtCo = await db.company.findUnique({
                where: { id: validated.managementCompanyId },
                select: { name: true }
            });
            if (mgmtCo) {
                (validated as any).managementCompany = mgmtCo.name;
            }
        }

        // Handle Project Name lookup
        if (validated.projectId) {
            const project = await db.project.findUnique({
                where: { id: validated.projectId },
                select: { name: true }
            });
            if (project) {
                (validated as any).projectName = project.name;
            }
        }

        const slug = validated.slug || validated.title.toLowerCase().replace(/ /g, "-") + "-" + Date.now();

        const mediaItems: { url: string; kind: MediaKind; sortOrder: number; cloudflareImageId?: string }[] = [];

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
                    cloudflareImageId: item.cloudflareImageId
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

        const data = {
            ...validated,
            slug,
            locationId,
        };

        // Remove non-model fields
        delete (data as any).mediaUrls;
        delete (data as any).videoUrls;
        delete (data as any).documentUrls;
        delete (data as any).mediaJson; // Remove if added to Zod, though not yet added

        // ... (rest of deletion logic matches original)

        // Remove role fields from property data
        delete (data as any).ownerId;
        delete (data as any).ownerName;
        delete (data as any).ownerEmail;
        delete (data as any).ownerPhone;
        delete (data as any).developerId;
        delete (data as any).developerName;
        delete (data as any).developerEmail;
        delete (data as any).developerPhone;
        delete (data as any).developerWebsite;
        delete (data as any).agentId;
        delete (data as any).agentName;
        delete (data as any).agentEmail;
        delete (data as any).agentPhone;
        delete (data as any).agentPhone;
        delete (data as any).managementCompanyId;

        // Remove ID fields that cause issues if passed during update (Prisma strictness)
        delete (data as any).locationId;
        delete (data as any).projectId;

        // Check if we can link to an existing user based on the original email
        let finalCreatedById = (data as any)['createdById']; // Default to current user for new properties (set below) or ignored for updates

        if (id === "new" || !id) {
            finalCreatedById = dbUser?.id;

            // Auto-link logic (Find OR Create)
            if (rawData.originalCreatorEmail) {
                const email = rawData.originalCreatorEmail as string;
                let existingUser = await db.user.findUnique({
                    where: { email }
                });

                if (!existingUser) {
                    // Create placeholder if missing so we can link immediately
                    console.log(`[Upsert] Creating placeholder user for ${email}`);
                    existingUser = await db.user.create({
                        data: {
                            email,
                            name: (rawData.originalCreatorName as string) || email.split('@')[0],
                        }
                    });
                }

                if (existingUser) {
                    finalCreatedById = existingUser.id;
                    console.log(`[Upsert] Linked property to user ${existingUser.id} (${existingUser.email})`);
                }
            }
        }

        const propertyData = {
            ...data,
            // Use the calculated ID
            createdById: (id === "new" || !id) ? finalCreatedById : undefined, // Only set on create
            updatedById: dbUser?.id, // Always update updater to current user

            // Import Metadata (Ensure raw values are passed even if validation stripped them?)
            // Validation schema has them, so 'validated' has them.
            // But we explicitly set them just in case logic above mutated 'data'
        };

        let property;
        if (id && id !== "new") {
            // Update
            console.log('Updating property:', id);
            property = await db.property.update({
                where: { id, locationId },
                data: propertyData,
            });

            // Update media: Delete all and recreate
            // NOTE: This strategy allows reordering and removing images easily via the form.
            await db.propertyMedia.deleteMany({ where: { propertyId: id } });
            if (mediaItems.length > 0) {
                await db.propertyMedia.createMany({
                    data: mediaItems.map(item => ({
                        propertyId: id,
                        url: item.url,
                        kind: item.kind,
                        sortOrder: item.sortOrder,
                        cloudflareImageId: item.cloudflareImageId // ADDED
                    })),
                });
            }

        } else {
            // Create New Property
            // Check for duplicate slug (Import overwrite scenario)
            const existing = await db.property.findUnique({
                where: { slug: propertyData.slug }
            });

            if (existing) {
                console.log(`[Upsert] Duplicate slug found (${propertyData.slug}). Overwriting property ${existing.id}...`);

                // DATA PRESERVATION LOGIC:
                // If we are overwriting, we don't want to lose manually entered creator info
                // just because the CRM doesn't provide it.

                const mergedData = {
                    ...propertyData,
                    // Preserve original creator email if not provided in new payload
                    originalCreatorEmail: propertyData.originalCreatorEmail || existing.originalCreatorEmail,

                    // Preserve original creator name if not provided
                    originalCreatorName: propertyData.originalCreatorName || existing.originalCreatorName,

                    // Preserve the linked user (createdById) if it exists on the old record.
                    // The 'propertyData.createdById' might be the current admin (updater) because 
                    // auto-link failed due to missing email in payload.
                    // We prioritize the EXISTING link if the new one is just the current user (fallback).
                    createdById: existing.createdById || propertyData.createdById
                };

                // Switch to Update Logic using existing ID
                property = await db.property.update({
                    where: { id: existing.id },
                    data: mergedData,
                });

                // Re-create media for the overwritten property
                await db.propertyMedia.deleteMany({ where: { propertyId: existing.id } });

                // Use createMany for efficiency
                if (mediaItems.length > 0) {
                    await db.propertyMedia.createMany({
                        data: mediaItems.map(item => ({
                            propertyId: existing.id,
                            url: item.url,
                            kind: item.kind,
                            sortOrder: item.sortOrder,
                            cloudflareImageId: item.cloudflareImageId
                        })),
                    });
                }

            } else {
                // Truly New Property
                console.log('Creating new property');
                property = await db.property.create({
                    data: {
                        ...propertyData,
                        locationId,
                        media: {
                            create: mediaItems.map(item => ({
                                url: item.url,
                                kind: item.kind,
                                sortOrder: item.sortOrder,
                                cloudflareImageId: item.cloudflareImageId
                            })),
                        },
                    },
                });
            }
        }

        // Process Stakeholders (Contact/Company Roles)

        // Helper to update role by ID
        const updatePropertyRole = async (propertyId: string, role: string, entityId: string | null | undefined, type: 'contact' | 'company') => {
            if (entityId === undefined) return; // Not present in form, skip

            // 1. Remove existing roles of this type for this property
            // We assume one Owner/Developer/Agent per property for this form context
            if (type === 'contact') {
                await db.contactPropertyRole.deleteMany({
                    where: { propertyId, role }
                });
                if (entityId) {
                    await db.contactPropertyRole.create({
                        data: { contactId: entityId, propertyId, role }
                    });
                }
            } else {
                await db.companyPropertyRole.deleteMany({
                    where: { propertyId, role }
                });
                if (entityId) {
                    await db.companyPropertyRole.create({
                        data: { companyId: entityId, propertyId, role }
                    });
                }
            }
        };

        // Handle ID-based updates first (Selection from UI)
        await updatePropertyRole(property.id, 'owner', validated.ownerId, 'contact');
        await updatePropertyRole(property.id, 'agent', validated.agentId, 'contact');
        await updatePropertyRole(property.id, 'developer', validated.developerId, 'company');
        await updatePropertyRole(property.id, 'management company', validated.managementCompanyId, 'company');

        // Handle Legacy/Create New inputs (if IDs are not provided but names are)
        // Only if ID is NOT provided, otherwise ID takes precedence
        if (!validated.ownerId && validated.ownerName) {
            await upsertContactRole(location, property.id, 'owner', {
                name: validated.ownerName,
                email: validated.ownerEmail,
                phone: validated.ownerPhone
            });
        }

        if (!validated.agentId && validated.agentName) {
            await upsertContactRole(location, property.id, 'agent', {
                name: validated.agentName,
                email: validated.agentEmail,
                phone: validated.agentPhone
            });
        }

        if (!validated.developerId && validated.developerName) {
            await upsertCompanyRole(location, property.id, 'developer', {
                name: validated.developerName,
                email: validated.developerEmail,
                phone: validated.developerPhone,
                website: validated.developerWebsite
            });
        }

        console.log('Property saved:', property.id);

        // Sync to GHL
        try {
            if (location.ghlRefreshToken) {
                console.log('Syncing to GHL...');
                const refreshed = await refreshGhlAccessToken(location);
                if (refreshed.ghlAccessToken) {
                    await syncToGHL(
                        refreshed.ghlAccessToken,
                        {
                            ...data,
                            features: data.features as string[],
                        } as any,
                        // If we have a GHL ID stored (not currently in schema but maybe in future), pass it.
                        // For now, syncToGHL handles lookup by slug/reference.
                        // Ideally we should store the GHL ID in the property record if we want robust updates by ID.
                        // But repository.ts syncToGHL handles lookup by slug.
                    );
                    console.log('Synced to GHL successfully');
                }
            } else {
                console.log('No GHL Refresh Token, skipping sync');
            }
        } catch (error) {
            console.error('Failed to sync to GHL:', error);
            // We don't throw here to avoid failing the local save
        }

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

        console.log(`Successfully deleted property ${propertyId}`);
        revalidatePath("/admin/properties");
        return { success: true };
    } catch (error) {
        console.error("Failed to delete property:", error);
        throw new Error("Failed to delete property");
    }
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
