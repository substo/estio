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

type PullOldCrmPropertyWithRetryArgs = {
    oldCrmPropertyId: string;
    locationId?: string;
    maxAttempts?: number;
    initialBackoffMs?: number;
    jitterMs?: number;
    pull: () => Promise<NormalizedOldCrmPropertyPullResult>;
};

export type NormalizedOldCrmPropertyPullResult =
    | {
        success: true;
        data: Record<string, any>;
        warnings: string[];
        notFound: false;
        verifyUrl: null;
        errorCode?: undefined;
        retryable?: undefined;
        rawError?: undefined;
        locationId: string;
    }
    | {
        success: false;
        error: string;
        errorCode: OldCrmPropertyPullErrorCode;
        retryable: boolean;
        rawError: string | null;
        warnings: string[];
        notFound: boolean;
        verifyUrl: string | null;
        locationId?: string;
        data?: undefined;
    };

const PROPERTY_NOT_FOUND_PREFIX = "PROPERTY_NOT_FOUND::";
const DEFAULT_PULL_RETRY_ATTEMPTS = 2;
const DEFAULT_PULL_RETRY_BACKOFF_MS = 250;
const DEFAULT_PULL_RETRY_JITTER_MS = 150;

export type OldCrmPropertyPullErrorCode =
    | "PROPERTY_NOT_FOUND"
    | "MISSING_CRM_CONFIG"
    | "LOGIN_FAILED"
    | "NAVIGATION_TIMEOUT"
    | "EXTRACTION_FAILED"
    | "TRANSIENT_NETWORK"
    | "DUPLICATE_PROPERTY"
    | "UNKNOWN";

export type OldCrmPropertyPullError = {
    code: OldCrmPropertyPullErrorCode;
    message: string;
    retryable: boolean;
    verifyUrl: string | null;
    rawError: string | null;
};

export function buildOldCrmManualPullFailure(error: unknown): NormalizedOldCrmPropertyPullResult {
    const normalized = normalizeOldCrmPropertyPullError(error);
    return {
        success: false,
        error: normalized.message,
        errorCode: normalized.code,
        retryable: normalized.retryable,
        rawError: normalized.rawError,
        warnings: [],
        notFound: normalized.code === "PROPERTY_NOT_FOUND",
        verifyUrl: normalized.verifyUrl,
    };
}

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
const BOOLEAN_FIELDS = new Set(["featured"]);

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

function parseLooseBoolean(value: unknown): boolean | null {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") {
        if (value === 1) return true;
        if (value === 0) return false;
    }

    const normalized = String(value ?? "").trim().toLowerCase();
    if (!normalized) return null;
    if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
    return null;
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

function getRawErrorMessage(error: unknown): string {
    return String((error as any)?.message || error || "Unknown error");
}

function getRawErrorName(error: unknown): string {
    return String((error as any)?.name || "");
}

function getRawErrorString(error: unknown): string | null {
    if (error === null || error === undefined) return null;
    if (error instanceof Error) {
        return [error.name, error.message].filter(Boolean).join(": ");
    }
    if (typeof error === "string") return error;
    try {
        return JSON.stringify(error);
    } catch {
        return String(error);
    }
}

function buildOldCrmPropertyPullError(args: {
    code: OldCrmPropertyPullErrorCode;
    message: string;
    retryable: boolean;
    verifyUrl?: string | null;
    rawError: unknown;
}): OldCrmPropertyPullError {
    return {
        code: args.code,
        message: args.message || "Old CRM pull failed",
        retryable: args.retryable,
        verifyUrl: args.verifyUrl || null,
        rawError: getRawErrorString(args.rawError),
    };
}

export function normalizeOldCrmPropertyPullError(error: unknown): OldCrmPropertyPullError {
    const existing = (error as any)?.oldCrmPropertyPullError;
    if (existing?.code && existing?.message) {
        return {
            code: existing.code,
            message: existing.message,
            retryable: Boolean(existing.retryable),
            verifyUrl: existing.verifyUrl || null,
            rawError: existing.rawError || getRawErrorString(error),
        };
    }

    const message = getRawErrorMessage(error).replace(/\s+/g, " ").trim() || "Old CRM pull failed";
    const name = getRawErrorName(error);
    const haystack = `${name} ${message}`;
    const lower = haystack.toLowerCase();
    const notFound = parseOldCrmPropertyNotFoundError(message);

    if (notFound.notFound) {
        return buildOldCrmPropertyPullError({
            code: "PROPERTY_NOT_FOUND",
            message: notFound.message,
            retryable: false,
            verifyUrl: notFound.verifyUrl,
            rawError: error,
        });
    }

    if (/could not find property with this id/i.test(message)) {
        return buildOldCrmPropertyPullError({
            code: "PROPERTY_NOT_FOUND",
            message,
            retryable: false,
            rawError: error,
        });
    }

    if (/missing crm configuration|missing crm capability|check location url and user credentials/i.test(message)) {
        return buildOldCrmPropertyPullError({
            code: "MISSING_CRM_CONFIG",
            message,
            retryable: false,
            rawError: error,
        });
    }

    if (/duplicatepropertyreferenceerror|duplicate_property_reference|already exists|duplicate property/i.test(haystack)) {
        return buildOldCrmPropertyPullError({
            code: "DUPLICATE_PROPERTY",
            message,
            retryable: false,
            rawError: error,
        });
    }

    if (/login failed|authentication failed|invalid credentials|unauthorized old crm|crm credentials|401|403/i.test(message)) {
        return buildOldCrmPropertyPullError({
            code: "LOGIN_FAILED",
            message,
            retryable: false,
            rawError: error,
        });
    }

    if (
        /timeout|timed out|navigation timeout|waiting failed/i.test(haystack)
        || name === "TimeoutError"
    ) {
        return buildOldCrmPropertyPullError({
            code: "NAVIGATION_TIMEOUT",
            message,
            retryable: true,
            rawError: error,
        });
    }

    if (/selector|extract|extraction|queryselector|evaluate failed|execution context was destroyed/i.test(lower)) {
        return buildOldCrmPropertyPullError({
            code: "EXTRACTION_FAILED",
            message,
            retryable: false,
            rawError: error,
        });
    }

    if (
        /net::|econnreset|econnrefused|enotfound|etimedout|socket hang up|browser has disconnected|target closed|protocol error|connection closed|navigation failed/i.test(lower)
    ) {
        return buildOldCrmPropertyPullError({
            code: "TRANSIENT_NETWORK",
            message,
            retryable: true,
            rawError: error,
        });
    }

    return buildOldCrmPropertyPullError({
        code: "UNKNOWN",
        message,
        retryable: false,
        rawError: error,
    });
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

        if (BOOLEAN_FIELDS.has(key)) {
            const parsed = parseLooseBoolean(value);
            propertyData[key] = parsed ?? false;
            if (parsed === null && value !== undefined && value !== null && String(value).trim() !== "") {
                warnings.push(`Could not map boolean field "${key}" from "${String(value)}".`);
            } else if (typeof value !== "boolean") {
                warnings.push(`Coerced boolean field "${key}" from "${String(value)}" to ${String(propertyData[key])}.`);
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

export function normalizeOldCrmPropertyPullResult(args: {
    pullResult: any;
    locationId?: string;
}): NormalizedOldCrmPropertyPullResult {
    if (!args.pullResult?.success) {
        const error = args.pullResult?.error || "Old CRM pull failed";
        const structuredError = normalizeOldCrmPropertyPullError(error);
        return {
            success: false,
            error,
            errorCode: structuredError.code,
            retryable: structuredError.retryable,
            rawError: structuredError.rawError,
            warnings: args.pullResult?.warnings || [],
            notFound: structuredError.code === "PROPERTY_NOT_FOUND",
            verifyUrl: structuredError.verifyUrl,
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

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRetryDelayMs(args: {
    attempt: number;
    initialBackoffMs: number;
    jitterMs: number;
}): number {
    const baseDelay = args.initialBackoffMs * Math.max(1, args.attempt);
    const jitter = args.jitterMs > 0 ? Math.floor(Math.random() * args.jitterMs) : 0;
    return baseDelay + jitter;
}

export async function pullOldCrmPropertyWithRetry(
    args: PullOldCrmPropertyWithRetryArgs
): Promise<NormalizedOldCrmPropertyPullResult> {
    const maxAttempts = Math.max(1, Math.floor(args.maxAttempts ?? DEFAULT_PULL_RETRY_ATTEMPTS));
    const initialBackoffMs = Math.max(0, Math.floor(args.initialBackoffMs ?? DEFAULT_PULL_RETRY_BACKOFF_MS));
    const jitterMs = Math.max(0, Math.floor(args.jitterMs ?? DEFAULT_PULL_RETRY_JITTER_MS));
    let lastResult: NormalizedOldCrmPropertyPullResult | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const startedAt = Date.now();
        let result: NormalizedOldCrmPropertyPullResult;
        try {
            result = await args.pull();
        } catch (error) {
            const structuredError = normalizeOldCrmPropertyPullError(error);
            result = {
                success: false,
                error: structuredError.message,
                errorCode: structuredError.code,
                retryable: structuredError.retryable,
                rawError: structuredError.rawError,
                warnings: [],
                notFound: structuredError.code === "PROPERTY_NOT_FOUND",
                verifyUrl: structuredError.verifyUrl,
                locationId: args.locationId,
            };
        }
        const latencyMs = Date.now() - startedAt;
        lastResult = result;

        console.log("[CRM PULL] Old CRM pull attempt completed", {
            attempt,
            maxAttempts,
            oldCrmPropertyId: args.oldCrmPropertyId,
            latencyMs,
            errorCode: result.success ? null : result.errorCode,
            retryable: result.success ? null : result.retryable,
        });

        if (result.success) {
            if (attempt === 1) return result;
            return {
                ...result,
                warnings: [
                    ...(result.warnings || []),
                    `Old CRM pull succeeded after ${attempt} attempts.`,
                ],
            };
        }

        if (!result.retryable || attempt >= maxAttempts) {
            if (result.retryable && attempt >= maxAttempts && attempt > 1) {
                return {
                    ...result,
                    warnings: [
                        ...(result.warnings || []),
                        `Old CRM pull failed after ${attempt} attempts.`,
                    ],
                };
            }
            return result;
        }

        const delayMs = getRetryDelayMs({ attempt, initialBackoffMs, jitterMs });
        console.warn("[CRM PULL] Retrying transient Old CRM pull failure", {
            attempt,
            nextAttempt: attempt + 1,
            maxAttempts,
            oldCrmPropertyId: args.oldCrmPropertyId,
            errorCode: result.errorCode,
            retryable: result.retryable,
            latencyMs,
            delayMs,
        });
        if (delayMs > 0) {
            await wait(delayMs);
        }
    }

    return lastResult || {
        success: false,
        error: "Old CRM pull failed",
        errorCode: "UNKNOWN",
        retryable: false,
        rawError: null,
        warnings: [],
        notFound: false,
        verifyUrl: null,
    };
}

export async function pullOldCrmProperty(args: OldCrmPullArgs): Promise<NormalizedOldCrmPropertyPullResult> {
    try {
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

        return normalizeOldCrmPropertyPullResult({ pullResult, locationId: args.locationId });
    } catch (error) {
        const structuredError = normalizeOldCrmPropertyPullError(error);
        return {
            success: false,
            error: structuredError.message,
            errorCode: structuredError.code,
            retryable: structuredError.retryable,
            rawError: structuredError.rawError,
            warnings: [],
            notFound: structuredError.code === "PROPERTY_NOT_FOUND",
            verifyUrl: structuredError.verifyUrl,
            locationId: args.locationId,
        };
    }
}

export async function pullOldCrmPropertyForManualAction(
    args: OldCrmManualPullArgs
): Promise<NormalizedOldCrmPropertyPullResult> {
    console.log(`[CRM PULL] Starting for old property ID ${args.oldCrmPropertyId} by user ${args.clerkUserId}`);

    try {
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

        return await pullOldCrmPropertyWithRetry({
            oldCrmPropertyId: args.oldCrmPropertyId,
            locationId: location.id,
            maxAttempts: 2,
            pull: async () => {
                const pullResult = await pullPropertyFromCrmWithContext({
                    oldPropertyId: args.oldCrmPropertyId,
                    locationId: location.id,
                    crmUrl,
                    crmUsername: user.crmUsername,
                    crmPassword: user.crmPassword,
                    crmEditUrlPattern,
                    actorUserId: user.id,
                });

                return normalizeOldCrmPropertyPullResult({ pullResult, locationId: location.id });
            },
        });
    } catch (error) {
        const structuredError = normalizeOldCrmPropertyPullError(error);
        return {
            success: false,
            error: structuredError.message,
            errorCode: structuredError.code,
            retryable: structuredError.retryable,
            rawError: structuredError.rawError,
            warnings: [],
            notFound: structuredError.code === "PROPERTY_NOT_FOUND",
            verifyUrl: structuredError.verifyUrl,
        };
    }
}
