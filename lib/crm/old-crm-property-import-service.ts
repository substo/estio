import db from "@/lib/db";
import { MediaKind } from "@prisma/client";
import { pullPropertyFromCrmWithContext } from "@/lib/crm/crm-puller";
import { resolveOldCrmImportContextForUser } from "@/lib/crm/old-crm-import";
import { savePropertyRecord, type PropertyMediaInput } from "@/lib/properties/save-property-record";

type ImportOldCrmPropertyArgs = {
    actorUserId: string;
    locationId: string;
    oldCrmPropertyId: string;
    publicReference: string;
};

export async function importOldCrmPropertyToLocalDb(args: ImportOldCrmPropertyArgs) {
    const context = await resolveOldCrmImportContextForUser({
        locationId: args.locationId,
        userId: args.actorUserId,
    });

    const pullResult = await pullPropertyFromCrmWithContext({
        oldPropertyId: args.oldCrmPropertyId,
        locationId: args.locationId,
        crmUrl: context.crmUrl,
        crmUsername: context.crmUsername,
        crmPassword: context.crmPassword,
        crmEditUrlPattern: context.crmEditUrlPattern,
        actorUserId: args.actorUserId,
    });

    if (!pullResult.success) {
        throw new Error(pullResult.error || "Old CRM pull failed");
    }

    const pulled = { ...(pullResult.data || {}) } as Record<string, any>;
    const existingByReference = await db.property.findFirst({
        where: {
            locationId: args.locationId,
            reference: args.publicReference,
        },
        select: { id: true },
    });

    const mediaItems: PropertyMediaInput[] = Array.isArray(pulled.media)
        ? pulled.media.map((item: any, index: number) => ({
            url: String(item?.url || ""),
            kind: (item?.kind || MediaKind.IMAGE) as MediaKind,
            sortOrder: Number.isFinite(item?.sortOrder) ? item.sortOrder : index,
            cloudflareImageId: item?.cloudflareImageId || undefined,
            metadata: item?.metadata,
        })).filter((item) => item.url)
        : [];

    delete pulled.media;
    delete pulled.ownerContactId;
    delete pulled.project;

    const propertyData = {
        ...pulled,
        title: pulled.title || `Imported Property ${args.publicReference}`,
        reference: args.publicReference,
        price: typeof pulled.price === "number" ? pulled.price : (pulled.price ? Number(pulled.price) : null),
        status: pulled.status || "ACTIVE",
        goal: pulled.goal || "SALE",
        publicationStatus: pulled.publicationStatus || "PUBLISHED",
    };

    const location = await db.location.findUnique({
        where: { id: args.locationId },
        select: {
            id: true,
            ghlRefreshToken: true,
            ghlLocationId: true,
        },
    });

    if (!location) {
        throw new Error("Location not found");
    }

    const property = await savePropertyRecord({
        id: existingByReference?.id || null,
        location,
        actorUserId: args.actorUserId,
        propertyData,
        mediaItems,
        stakeholders: {
            ownerId: pulled.ownerContactId || null,
            ownerName: pulled.ownerName || null,
            ownerEmail: pulled.ownerEmail || null,
            ownerPhone: pulled.ownerMobile || pulled.ownerPhone || null,
            developerName: pulled.developerName || null,
            developerEmail: pulled.developerEmail || null,
            developerPhone: pulled.developerPhone || null,
            developerWebsite: pulled.developerWebsite || null,
        },
    });

    return {
        propertyId: property.id,
        warnings: pullResult.warnings || [],
    };
}
