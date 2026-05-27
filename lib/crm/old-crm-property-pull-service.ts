import db from "@/lib/db";
import { MediaKind } from "@prisma/client";
import { pullPropertyFromCrmWithContext } from "@/lib/crm/crm-puller";
import { resolveOldCrmImportContextForUser } from "@/lib/crm/old-crm-import";
import type { PropertyMediaInput } from "@/lib/properties/save-property-record";

type OldCrmPullArgs = {
    locationId: string;
    actorUserId: string;
    oldCrmPropertyId: string;
};

type OldCrmManualPullArgs = {
    clerkUserId: string;
    oldCrmPropertyId: string;
};

export type NormalizedOldCrmPropertyPullResult =
    | {
        success: true;
        data: Record<string, any>;
        warnings: string[];
        notFound: false;
        verifyUrl: null;
        locationId: string;
    }
    | {
        success: false;
        error: string;
        warnings: string[];
        notFound: boolean;
        verifyUrl: string | null;
        locationId?: string;
        data?: undefined;
    };

const PROPERTY_NOT_FOUND_PREFIX = "PROPERTY_NOT_FOUND::";

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

export function parseOldCrmPropertyNotFoundError(error: unknown): {
    notFound: boolean;
    message: string;
    verifyUrl: string | null;
} {
    const rawMessage = String((error as any)?.message || error || "");
    if (!rawMessage.includes(PROPERTY_NOT_FOUND_PREFIX)) {
        return {
            notFound: false,
            message: rawMessage,
            verifyUrl: null,
        };
    }

    const message = rawMessage.replace(PROPERTY_NOT_FOUND_PREFIX, "");
    const urlMatch = message.match(/Verify manually: (https?:\/\/[^\s]+)/);
    return {
        notFound: true,
        message,
        verifyUrl: urlMatch ? urlMatch[1] : null,
    };
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

export function normalizeOldCrmPulledMedia(pulled: Record<string, any>): PropertyMediaInput[] {
    const pulledMedia = Array.isArray(pulled.media)
        ? pulled.media
        : (Array.isArray(pulled.images) ? pulled.images : []);

    return pulledMedia
        .map((item: any, index: number) => ({
            url: String(item?.url || ""),
            kind: (item?.kind || MediaKind.IMAGE) as MediaKind,
            sortOrder: Number.isFinite(item?.sortOrder) ? item.sortOrder : index,
            cloudflareImageId: item?.cloudflareImageId || undefined,
            metadata: item?.metadata,
        }))
        .filter((item) => item.url);
}

function normalizePullResult(args: {
    pullResult: any;
    locationId?: string;
}): NormalizedOldCrmPropertyPullResult {
    if (!args.pullResult?.success) {
        const error = args.pullResult?.error || "Old CRM pull failed";
        const parsed = parseOldCrmPropertyNotFoundError(error);
        return {
            success: false,
            error,
            warnings: args.pullResult?.warnings || [],
            notFound: parsed.notFound,
            verifyUrl: parsed.verifyUrl,
            locationId: args.locationId,
        };
    }

    return {
        success: true,
        data: { ...(args.pullResult.data || {}) },
        warnings: args.pullResult.warnings || [],
        notFound: false,
        verifyUrl: null,
        locationId: String(args.locationId || args.pullResult.locationId || ""),
    };
}

export async function pullOldCrmProperty(args: OldCrmPullArgs): Promise<NormalizedOldCrmPropertyPullResult> {
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

    return normalizePullResult({ pullResult, locationId: args.locationId });
}

export async function pullOldCrmPropertyForManualAction(
    args: OldCrmManualPullArgs
): Promise<NormalizedOldCrmPropertyPullResult> {
    console.log(`[CRM PULL] Starting for old property ID ${args.oldCrmPropertyId} by user ${args.clerkUserId}`);

    const user = await db.user.findUnique({
        where: { clerkId: args.clerkUserId },
        include: { locations: true },
    });

    if (!user) throw new Error("User not found");

    const location = user.locations[0];
    const crmUrl = location?.crmUrl;
    const crmEditUrlPattern = location?.crmEditUrlPattern;

    if (!location?.id || !crmUrl || !user.crmUsername || !user.crmPassword) {
        throw new Error("Missing CRM configuration. Check location URL and user credentials.");
    }

    const pullResult = await pullPropertyFromCrmWithContext({
        oldPropertyId: args.oldCrmPropertyId,
        locationId: location.id,
        crmUrl,
        crmUsername: user.crmUsername,
        crmPassword: user.crmPassword,
        crmEditUrlPattern,
        actorUserId: user.id,
    });

    return normalizePullResult({ pullResult, locationId: location.id });
}
