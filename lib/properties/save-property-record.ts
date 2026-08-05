import db from "@/lib/db";
import { MediaKind } from "@prisma/client";
import { refreshGhlAccessToken } from "@/lib/location";
import { syncToGHL } from "@/lib/properties/repository";
import { syncContactToGHL, syncCompanyToGHL } from "@/lib/ghl/stakeholders";
import {
    ensureMediaAssets,
    softDeleteOrphanedAssets,
    computeRemovedCloudflareIds,
} from "@/lib/media/media-assets";
import { findIdsOutsideLocation } from "@/lib/properties/location-boundary";
import { validateSubmittedPropertyMedia } from "@/lib/properties/property-media-access";

export type PropertyMediaInput = {
    url: string;
    kind: MediaKind;
    sortOrder: number;
    cloudflareImageId?: string;
    metadata?: unknown;
};

export type PropertyPromptProfileUpsert = {
    roomTypeKey: string;
    roomTypeLabel?: string | null;
    promptContext?: string | null;
    analysisData?: unknown;
};

export type SavePropertyRecordInput = {
    id?: string | null;
    location: {
        id: string;
        ghlRefreshToken?: string | null;
        ghlLocationId?: string | null;
    };
    actorUserId?: string | null;
    propertyData: Record<string, any>;
    mediaItems: PropertyMediaInput[];
    stakeholders?: {
        ownerId?: string | null;
        ownerCompanyId?: string | null;
        ownerEntityType?: string | null;
        ownerName?: string | null;
        ownerEmail?: string | null;
        ownerPhone?: string | null;
        developerId?: string | null;
        developerName?: string | null;
        developerEmail?: string | null;
        developerPhone?: string | null;
        developerWebsite?: string | null;
        agentId?: string | null;
        agentName?: string | null;
        agentEmail?: string | null;
        agentPhone?: string | null;
        managementCompanyId?: string | null;
        maintenanceIds?: string[];
    };
    promptProfileUpserts?: PropertyPromptProfileUpsert[];
    shouldSyncToGhl?: boolean;
};

export class DuplicatePropertyReferenceError extends Error {
    readonly reference: string;
    readonly propertyId: string;

    constructor(reference: string, propertyId: string) {
        super(`Property with reference "${reference}" already exists.`);
        this.name = "DuplicatePropertyReferenceError";
        this.reference = reference;
        this.propertyId = propertyId;
    }
}

async function validateStakeholderLocationBoundary(
    locationId: string,
    stakeholders: NonNullable<SavePropertyRecordInput["stakeholders"]>,
) {
    const contactIds = [
        stakeholders.ownerId,
        stakeholders.agentId,
        ...(stakeholders.maintenanceIds || []),
    ].filter((id): id is string => Boolean(id));
    const companyIds = [
        stakeholders.ownerCompanyId,
        stakeholders.developerId,
        stakeholders.managementCompanyId,
    ].filter((id): id is string => Boolean(id));

    const [contacts, companies] = await Promise.all([
        contactIds.length
            ? db.contact.findMany({
                where: { id: { in: contactIds }, locationId },
                select: { id: true },
            })
            : [],
        companyIds.length
            ? db.company.findMany({
                where: { id: { in: companyIds }, locationId },
                select: { id: true },
            })
            : [],
    ]);

    if (
        findIdsOutsideLocation(contactIds, contacts.map(({ id }) => id)).length > 0 ||
        findIdsOutsideLocation(companyIds, companies.map(({ id }) => id)).length > 0
    ) {
        throw new Error("One or more selected property relationships are outside the active location");
    }
}

async function upsertContactRole(
    location: SavePropertyRecordInput["location"],
    propertyId: string,
    role: string,
    data: { name?: string | null; email?: string | null; phone?: string | null }
) {
    if (!data.name) return;

    let contact;
    if (data.email) {
        contact = await db.contact.findFirst({ where: { email: data.email, locationId: location.id } });
    }

    if (contact) {
        contact = await db.contact.update({
            where: { id: contact.id },
            data: {
                name: data.name,
                email: data.email || contact.email,
                phone: data.phone || contact.phone,
            },
        });
    } else {
        contact = await db.contact.create({
            data: {
                locationId: location.id,
                status: "NEW",
                name: data.name,
                email: data.email,
                phone: data.phone,
            },
        });
    }

    const existingRole = await db.contactPropertyRole.findUnique({
        where: {
            contactId_propertyId_role: {
                contactId: contact.id,
                propertyId,
                role,
            },
        },
    });

    if (!existingRole) {
        await db.contactPropertyRole.create({
            data: {
                contactId: contact.id,
                propertyId,
                role,
            },
        });
    }

    const contactId = contact.id;
    const existingGhlContactId = contact.ghlContactId || null;
    if (location.ghlRefreshToken && location.ghlLocationId) {
        void (async () => {
            try {
                const tokens = await refreshGhlAccessToken(location as any);
                if (tokens.ghlAccessToken) {
                    const ghlId = await syncContactToGHL(location.ghlLocationId!, {
                        name: data.name!,
                        email: data.email || undefined,
                        phone: data.phone || undefined,
                        tags: [role],
                    }, existingGhlContactId);
                    if (ghlId && !existingGhlContactId) {
                        await db.contact.update({ where: { id: contactId }, data: { ghlContactId: ghlId } });
                    }
                }
            } catch (err) {
                console.error(`[Background] Failed to sync ${role} to GHL:`, err);
            }
        })();
    }
}

async function upsertCompanyRole(
    location: SavePropertyRecordInput["location"],
    propertyId: string,
    role: string,
    data: { name?: string | null; email?: string | null; phone?: string | null; website?: string | null }
) {
    if (!data.name) return;

    let company = await db.company.findFirst({ where: { name: data.name, locationId: location.id } });

    if (company) {
        company = await db.company.update({
            where: { id: company.id },
            data: {
                email: data.email || company.email,
                phone: data.phone || company.phone,
                website: data.website || company.website,
            },
        });
    } else {
        company = await db.company.create({
            data: {
                locationId: location.id,
                name: data.name,
                email: data.email,
                phone: data.phone,
                website: data.website,
            },
        });
    }

    const existingRole = await db.companyPropertyRole.findUnique({
        where: {
            companyId_propertyId_role: {
                companyId: company.id,
                propertyId,
                role,
            },
        },
    });

    if (!existingRole) {
        await db.companyPropertyRole.create({
            data: {
                companyId: company.id,
                propertyId,
                role,
            },
        });
    }

    const companyId = company.id;
    const existingGhlCompanyId = company.ghlCompanyId || null;
    if (location.ghlRefreshToken && location.ghlLocationId) {
        void (async () => {
            try {
                const tokens = await refreshGhlAccessToken(location as any);
                if (tokens.ghlAccessToken) {
                    const ghlId = await syncCompanyToGHL(location.ghlLocationId!, {
                        name: data.name!,
                        email: data.email || undefined,
                        phone: data.phone || undefined,
                        website: data.website || undefined,
                        tags: [role],
                    });
                    if (ghlId && !existingGhlCompanyId) {
                        await db.company.update({ where: { id: companyId }, data: { ghlCompanyId: ghlId } });
                    }
                }
            } catch (err) {
                console.error(`[Background] Failed to sync ${role} company to GHL:`, err);
            }
        })();
    }
}

export async function savePropertyRecord(input: SavePropertyRecordInput) {
    const normalizedId = input.id && input.id !== "new" ? input.id : null;
    const propertyData: Record<string, any> = { ...input.propertyData, locationId: input.location.id };
    const actorUserId = input.actorUserId || null;
    const stakeholders = input.stakeholders || {};
    const promptProfileUpserts = input.promptProfileUpserts || [];
    const shouldSyncToGhl = input.shouldSyncToGhl !== false;

    // All client-submitted media ownership is proven before the property or its
    // existing media rows are mutated.
    const [validatedMediaItems] = await Promise.all([
        validateSubmittedPropertyMedia({
            locationId: input.location.id,
            propertyId: normalizedId,
            mediaItems: input.mediaItems,
        }),
        validateStakeholderLocationBoundary(input.location.id, stakeholders),
    ]);

    const normalizedReference = typeof propertyData.reference === "string"
        ? propertyData.reference.trim()
        : propertyData.reference;
    propertyData.reference = normalizedReference || null;

    if (propertyData.reference) {
        const existingByReference = await db.property.findFirst({
            where: {
                reference: {
                    equals: propertyData.reference,
                    mode: "insensitive",
                },
                locationId: input.location.id,
                ...(normalizedId ? { id: { not: normalizedId } } : {}),
            },
            select: { id: true },
        });

        if (existingByReference) {
            throw new DuplicatePropertyReferenceError(propertyData.reference, existingByReference.id);
        }
    }

    if (stakeholders.managementCompanyId) {
        const mgmtCo = await db.company.findFirst({
            where: { id: stakeholders.managementCompanyId, locationId: input.location.id },
            select: { name: true },
        });
        if (mgmtCo) {
            propertyData.managementCompany = mgmtCo.name;
        }
    }

    if (propertyData.projectId) {
        const project = await db.project.findFirst({
            where: { id: propertyData.projectId, locationId: input.location.id },
            select: { name: true },
        });
        if (!project) throw new Error("Selected project is outside the active location");
        propertyData.projectName = project.name;
    }

    const slug = propertyData.slug || propertyData.title?.toLowerCase().replace(/ /g, "-") + "-" + Date.now();
    propertyData.slug = slug;

    delete propertyData.ownerId;
    delete propertyData.ownerCompanyId;
    delete propertyData.ownerEntityType;
    delete propertyData.ownerEntityPath;
    delete propertyData.ownerBusinessSubtype;
    delete propertyData.ownerName;
    delete propertyData.ownerEmail;
    delete propertyData.ownerPhone;
    delete propertyData.ownerMobile;
    delete propertyData.ownerCompany;
    delete propertyData.ownerFax;
    delete propertyData.ownerBirthday;
    delete propertyData.ownerWebsite;
    delete propertyData.ownerAddress;
    delete propertyData.ownerViewingNotification;
    delete propertyData.ownerNotes;
    delete propertyData.ownerMatchSource;
    delete propertyData.legacyOwnerId;
    delete propertyData.legacyOwnerLabel;
    delete propertyData.legacyOwnerSelectionMode;
    delete propertyData.developerId;
    delete propertyData.developerName;
    delete propertyData.developerEmail;
    delete propertyData.developerPhone;
    delete propertyData.developerWebsite;
    delete propertyData.agentId;
    delete propertyData.agentName;
    delete propertyData.agentEmail;
    delete propertyData.agentPhone;
    delete propertyData.managementCompanyId;
    delete propertyData.maintenanceIds;
    delete propertyData.locationId;
    delete propertyData.projectId;

    let finalCreatedById = propertyData.createdById ?? actorUserId;
    if (!normalizedId) {
        if (propertyData.originalCreatorEmail) {
            const email = String(propertyData.originalCreatorEmail);
            let existingUser = await db.user.findUnique({ where: { email } });
            if (!existingUser) {
                existingUser = await db.user.create({
                    data: {
                        email,
                        name: propertyData.originalCreatorName || email.split("@")[0],
                    },
                });
            }
            finalCreatedById = existingUser.id;
        }
    }

    const propertyPayload: Record<string, any> = {
        ...propertyData,
        createdById: normalizedId ? undefined : finalCreatedById,
        updatedById: actorUserId,
    };

    let property;
    if (normalizedId) {
        property = await db.property.update({
            where: { id: normalizedId, locationId: input.location.id },
            data: propertyPayload,
        });

        const oldMedia = await db.propertyMedia.findMany({
            where: { propertyId: normalizedId, kind: "IMAGE" },
            select: { cloudflareImageId: true },
        });

        await db.propertyMedia.deleteMany({ where: { propertyId: normalizedId } });
        if (validatedMediaItems.length > 0) {
            await db.propertyMedia.createMany({
                data: validatedMediaItems.map((item) => ({
                    propertyId: normalizedId,
                    url: item.url,
                    kind: item.kind,
                    sortOrder: item.sortOrder,
                    cloudflareImageId: item.cloudflareImageId,
                    metadata: item.metadata as any,
                })),
            });
        }
        await ensureMediaAssets(input.location.id, validatedMediaItems);
        const removedCfIds = computeRemovedCloudflareIds(oldMedia, validatedMediaItems);
        if (removedCfIds.length > 0) {
            await softDeleteOrphanedAssets(input.location.id, removedCfIds);
        }
    } else {
        const existing = await db.property.findFirst({
            where: { slug: propertyPayload.slug, locationId: input.location.id },
        });

        if (existing) {
            const mergedData = {
                ...propertyPayload,
                originalCreatorEmail: propertyPayload.originalCreatorEmail || existing.originalCreatorEmail,
                originalCreatorName: propertyPayload.originalCreatorName || existing.originalCreatorName,
                createdById: existing.createdById || propertyPayload.createdById,
            };

            property = await db.property.update({
                where: { id: existing.id },
                data: mergedData,
            });

            const oldOverwriteMedia = await db.propertyMedia.findMany({
                where: { propertyId: existing.id, kind: "IMAGE" },
                select: { cloudflareImageId: true },
            });

            await db.propertyMedia.deleteMany({ where: { propertyId: existing.id } });
            if (validatedMediaItems.length > 0) {
                await db.propertyMedia.createMany({
                    data: validatedMediaItems.map((item) => ({
                        propertyId: existing.id,
                        url: item.url,
                        kind: item.kind,
                        sortOrder: item.sortOrder,
                        cloudflareImageId: item.cloudflareImageId,
                        metadata: item.metadata as any,
                    })),
                });
            }

            await ensureMediaAssets(input.location.id, validatedMediaItems);
            const removedOverwriteCfIds = computeRemovedCloudflareIds(oldOverwriteMedia, validatedMediaItems);
            if (removedOverwriteCfIds.length > 0) {
                await softDeleteOrphanedAssets(input.location.id, removedOverwriteCfIds);
            }
        } else {
            property = await db.property.create({
                data: {
                    ...propertyPayload,
                    locationId: input.location.id,
                    media: {
                        create: validatedMediaItems.map((item) => ({
                            url: item.url,
                            kind: item.kind,
                            sortOrder: item.sortOrder,
                            cloudflareImageId: item.cloudflareImageId,
                            metadata: item.metadata as any,
                        })),
                    },
                } as any,
            });

            await ensureMediaAssets(input.location.id, validatedMediaItems);
        }
    }

    const updatePropertyRole = async (propertyId: string, role: string, entityId: string | null | undefined, type: "contact" | "company") => {
        if (entityId === undefined) return;
        if (type === "contact") {
            await db.contactPropertyRole.deleteMany({ where: { propertyId, role } });
            if (entityId) {
                await db.contactPropertyRole.create({
                    data: { contactId: entityId, propertyId, role },
                });
            }
        } else {
            await db.companyPropertyRole.deleteMany({ where: { propertyId, role } });
            if (entityId) {
                await db.companyPropertyRole.create({
                    data: { companyId: entityId, propertyId, role },
                });
            }
        }
    };

    const syncPropertyContactRoles = async (propertyId: string, role: string, contactIds: string[] | null | undefined) => {
        if (contactIds === undefined) return;
        const uniqueIds = Array.from(new Set((contactIds || []).filter(Boolean)));
        await db.contactPropertyRole.deleteMany({ where: { propertyId, role } });
        if (uniqueIds.length === 0) return;
        await db.contactPropertyRole.createMany({
            data: uniqueIds.map((contactId) => ({ contactId, propertyId, role })),
            skipDuplicates: true,
        });
    };

    await updatePropertyRole(property.id, "owner", stakeholders.ownerId, "contact");
    await updatePropertyRole(property.id, "owner", stakeholders.ownerCompanyId, "company");
    await updatePropertyRole(property.id, "agent", stakeholders.agentId, "contact");
    await updatePropertyRole(property.id, "developer", stakeholders.developerId, "company");
    await updatePropertyRole(property.id, "management company", stakeholders.managementCompanyId, "company");
    await syncPropertyContactRoles(property.id, "maintenance", stakeholders.maintenanceIds);

    if (!stakeholders.ownerId && !stakeholders.ownerCompanyId && stakeholders.ownerName) {
        await upsertContactRole(input.location, property.id, "owner", {
            name: stakeholders.ownerName,
            email: stakeholders.ownerEmail,
            phone: stakeholders.ownerPhone,
        });
    }

    if (!stakeholders.agentId && stakeholders.agentName) {
        await upsertContactRole(input.location, property.id, "agent", {
            name: stakeholders.agentName,
            email: stakeholders.agentEmail,
            phone: stakeholders.agentPhone,
        });
    }

    if (!stakeholders.developerId && stakeholders.developerName) {
        await upsertCompanyRole(input.location, property.id, "developer", {
            name: stakeholders.developerName,
            email: stakeholders.developerEmail,
            phone: stakeholders.developerPhone,
            website: stakeholders.developerWebsite,
        });
    }

    if (promptProfileUpserts.length > 0) {
        for (const upsert of promptProfileUpserts) {
            await (db as any).propertyImagePromptProfile.upsert({
                where: {
                    propertyId_roomTypeKey: {
                        propertyId: property.id,
                        roomTypeKey: upsert.roomTypeKey,
                    },
                },
                create: {
                    propertyId: property.id,
                    roomTypeKey: upsert.roomTypeKey,
                    roomTypeLabel: upsert.roomTypeLabel,
                    promptContext: upsert.promptContext,
                    analysisData: (upsert.analysisData as any) || null,
                    updatedById: actorUserId,
                },
                update: {
                    roomTypeLabel: upsert.roomTypeLabel,
                    promptContext: upsert.promptContext,
                    analysisData: (upsert.analysisData as any) || null,
                    updatedById: actorUserId,
                },
            });
        }
    }

    if (shouldSyncToGhl && input.location.ghlRefreshToken) {
        try {
            const refreshed = await refreshGhlAccessToken(input.location as any);
            if (refreshed.ghlAccessToken) {
                await syncToGHL(
                    refreshed.ghlAccessToken,
                    {
                        ...propertyData,
                        features: propertyData.features as string[],
                    } as any
                );
            }
        } catch (error) {
            console.error("Failed to sync to GHL:", error);
        }
    }

    return property;
}
