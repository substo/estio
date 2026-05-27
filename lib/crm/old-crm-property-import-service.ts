import db from "@/lib/db";
import {
    normalizeOldCrmPropertyPullError,
    normalizeOldCrmPulledMedia,
    pullOldCrmProperty,
    sanitizeOldCrmPropertyData,
} from "@/lib/crm/old-crm-property-pull-service";
import { savePropertyRecord } from "@/lib/properties/save-property-record";

type ImportOldCrmPropertyArgs = {
    actorUserId: string;
    locationId: string;
    oldCrmPropertyId: string;
    publicReference: string;
};

export async function importOldCrmPropertyToLocalDb(args: ImportOldCrmPropertyArgs) {
    const pullResult = await pullOldCrmProperty({
        oldCrmPropertyId: args.oldCrmPropertyId,
        locationId: args.locationId,
        actorUserId: args.actorUserId,
    });

    if (!pullResult.success) {
        const error = new Error(pullResult.error || "Old CRM pull failed");
        (error as any).oldCrmPropertyPullError = {
            code: pullResult.errorCode,
            message: pullResult.error,
            retryable: pullResult.retryable,
            verifyUrl: pullResult.verifyUrl,
            rawError: pullResult.rawError,
        };
        throw error;
    }

    const pulled = { ...(pullResult.data || {}) } as Record<string, any>;
    const existingByReference = await db.property.findFirst({
        where: {
            locationId: args.locationId,
            reference: {
                equals: args.publicReference,
                mode: "insensitive",
            },
        },
        select: { id: true },
    });

    const mediaItems = normalizeOldCrmPulledMedia(pulled);

    const ownerContactId = pulled.ownerContactId || null;
    const ownerCompanyId = pulled.ownerCompanyId || null;
    const ownerEntityType = pulled.ownerEntityType || null;

    delete pulled.media;
    delete pulled.images;
    delete pulled.ownerContactId;
    delete pulled.ownerCompanyId;
    delete pulled.project;

    const sanitized = sanitizeOldCrmPropertyData(pulled);
    const propertyData = {
        ...sanitized.propertyData,
        title: pulled.title || `Imported Property ${args.publicReference}`,
        reference: args.publicReference,
        status: sanitized.propertyData.status || "ACTIVE",
        goal: sanitized.propertyData.goal || "SALE",
        publicationStatus: sanitized.propertyData.publicationStatus || "PUBLISHED",
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

    let property;
    try {
        property = await savePropertyRecord({
            id: existingByReference?.id || null,
            location,
            actorUserId: args.actorUserId,
            propertyData,
            mediaItems,
            stakeholders: {
                ownerId: ownerContactId,
                ownerCompanyId: ownerCompanyId,
                ownerEntityType: ownerEntityType,
                ownerName: pulled.ownerName || null,
                ownerEmail: pulled.ownerEmail || null,
                ownerPhone: pulled.ownerMobile || pulled.ownerPhone || null,
                developerName: pulled.developerName || null,
                developerEmail: pulled.developerEmail || null,
                developerPhone: pulled.developerPhone || null,
                developerWebsite: pulled.developerWebsite || null,
            },
        });
    } catch (error) {
        const structuredError = normalizeOldCrmPropertyPullError(error);
        (error as any).oldCrmPropertyPullError = structuredError;
        throw error;
    }

    return {
        propertyId: property.id,
        warnings: [...(pullResult.warnings || []), ...sanitized.warnings],
    };
}
