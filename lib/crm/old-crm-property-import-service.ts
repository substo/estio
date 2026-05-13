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

const OPTIONAL_NUMERIC_FIELDS = new Set([
    "price",
    "communalFees",
    "bedrooms",
    "bathrooms",
    "areaSqm",
    "coveredAreaSqm",
    "coveredVerandaSqm",
    "uncoveredVerandaSqm",
    "plotAreaSqm",
    "basementSqm",
    "buildYear",
    "floor",
    "depositValue",
    "estimatedValue",
    "landSurveyValue",
    "lowestOffer",
    "purchasePrice",
]);

const DEFAULT_ZERO_NUMERIC_FIELDS = new Set(["sortOrder"]);

const ALLOWED_PROPERTY_FIELDS = new Set([
    "title",
    "slug",
    "description",
    "reference",
    "status",
    "type",
    "price",
    "currency",
    "bedrooms",
    "bathrooms",
    "areaSqm",
    "addressLine1",
    "addressLine2",
    "city",
    "country",
    "postalCode",
    "latitude",
    "longitude",
    "featured",
    "category",
    "features",
    "condition",
    "source",
    "buildYear",
    "plotAreaSqm",
    "goal",
    "publicationStatus",
    "propertyArea",
    "propertyLocation",
    "communalFees",
    "metaDescription",
    "metaKeywords",
    "metaTitle",
    "rentalPeriod",
    "metadata",
    "coveredAreaSqm",
    "coveredVerandaSqm",
    "uncoveredVerandaSqm",
    "basementSqm",
    "sortOrder",
    "floor",
    "agentRef",
    "agentUrl",
    "estimatedValue",
    "internalNotes",
    "keyHolder",
    "landSurveyValue",
    "lawyer",
    "loanDetails",
    "lowestOffer",
    "managementCompany",
    "occupancyStatus",
    "projectName",
    "purchasePrice",
    "unitNumber",
    "viewingContact",
    "viewingDirections",
    "viewingNotes",
    "agencyAgreement",
    "commission",
    "agreementDate",
    "agreementNotes",
    "deposit",
    "depositValue",
    "billsTransferable",
    "priceIncludesCommunalFees",
    "keyBoxCode",
    "officeKeyNumber",
    "originalCreatorEmail",
    "originalCreatorName",
    "originalCreatedAt",
    "originalUpdatedAt",
    "scrapedListingId",
    "feedId",
    "feedReferenceId",
    "feedHash",
    "createdById",
    "updatedById",
]);

function parseLooseNumber(value: unknown): number | null {
    if (typeof value === "number") {
        return Number.isFinite(value) ? Math.round(value) : null;
    }
    if (typeof value !== "string") return null;

    const normalized = value.trim();
    if (!normalized || /^n\/?a$/i.test(normalized)) return null;

    const cleaned = normalized.replace(/,/g, "").replace(/[^0-9.-]/g, "");
    if (!cleaned || cleaned === "-" || cleaned === "." || cleaned === "-.") return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

export function sanitizeOldCrmPropertyData(
    input: Record<string, any>
): { propertyData: Record<string, any>; warnings: string[] } {
    const propertyData: Record<string, any> = {};
    const warnings: string[] = [];

    for (const [key, value] of Object.entries(input || {})) {
        if (!ALLOWED_PROPERTY_FIELDS.has(key)) {
            if (value !== undefined && value !== null && key !== "") {
                warnings.push(`Dropped unsupported property field "${key}".`);
            }
            continue;
        }

        if (OPTIONAL_NUMERIC_FIELDS.has(key) || DEFAULT_ZERO_NUMERIC_FIELDS.has(key)) {
            const parsed = parseLooseNumber(value);
            if (parsed === null) {
                propertyData[key] = DEFAULT_ZERO_NUMERIC_FIELDS.has(key) ? 0 : null;
                if (value !== undefined && value !== null && String(value).trim() !== "") {
                    warnings.push(`Could not map numeric field "${key}" from "${String(value)}".`);
                }
            } else {
                propertyData[key] = parsed;
                if (typeof value !== "number") {
                    warnings.push(`Coerced numeric field "${key}" from "${String(value)}" to ${parsed}.`);
                }
            }
            continue;
        }

        if ((key === "latitude" || key === "longitude") && typeof value === "string") {
            const parsed = Number(value.trim());
            propertyData[key] = Number.isFinite(parsed) ? parsed : null;
            if (!Number.isFinite(parsed) && value.trim()) {
                warnings.push(`Could not map coordinate field "${key}" from "${value}".`);
            }
            continue;
        }

        propertyData[key] = value;
    }

    return { propertyData, warnings };
}

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
            reference: {
                equals: args.publicReference,
                mode: "insensitive",
            },
        },
        select: { id: true },
    });

    const pulledMedia = Array.isArray(pulled.media) ? pulled.media : (Array.isArray(pulled.images) ? pulled.images : []);
    const mediaItems: PropertyMediaInput[] = pulledMedia
        .map((item: any, index: number) => ({
            url: String(item?.url || ""),
            kind: (item?.kind || MediaKind.IMAGE) as MediaKind,
            sortOrder: Number.isFinite(item?.sortOrder) ? item.sortOrder : index,
            cloudflareImageId: item?.cloudflareImageId || undefined,
            metadata: item?.metadata,
        })).filter((item) => item.url)
        ;

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

    const property = await savePropertyRecord({
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

    return {
        propertyId: property.id,
        warnings: [...(pullResult.warnings || []), ...sanitized.warnings],
    };
}
