import test from "node:test";
import assert from "node:assert/strict";
import { MediaKind } from "@prisma/client";
import {
    normalizeOldCrmPropertyPullError,
    normalizeOldCrmPropertyPullResult,
    normalizeOldCrmPulledMedia,
    parseOldCrmPropertyNotFoundError,
    pullOldCrmPropertyWithRetry,
    sanitizeOldCrmPropertyData,
    type NormalizedOldCrmPropertyPullResult,
} from "./old-crm-property-pull-service";

test("parseOldCrmPropertyNotFoundError preserves old CRM not-found details", () => {
    const parsed = parseOldCrmPropertyNotFoundError(
        'PROPERTY_NOT_FOUND::Property "2327" was not found in the old CRM. Verify manually: https://crm.test/admin/properties/2327/edit'
    );

    assert.equal(parsed.notFound, true);
    assert.equal(
        parsed.message,
        'Property "2327" was not found in the old CRM. Verify manually: https://crm.test/admin/properties/2327/edit'
    );
    assert.equal(parsed.verifyUrl, "https://crm.test/admin/properties/2327/edit");
});

test("parseOldCrmPropertyNotFoundError leaves unrelated errors unstructured", () => {
    const parsed = parseOldCrmPropertyNotFoundError("Missing CRM configuration.");

    assert.deepEqual(parsed, {
        notFound: false,
        message: "Missing CRM configuration.",
        verifyUrl: null,
    });
});

test("normalizeOldCrmPropertyPullError classifies prefixed not-found errors with verify URL", () => {
    const normalized = normalizeOldCrmPropertyPullError(
        'PROPERTY_NOT_FOUND::Property "2327" was not found in the old CRM. Verify manually: https://crm.test/admin/properties/2327/edit'
    );

    assert.equal(normalized.code, "PROPERTY_NOT_FOUND");
    assert.equal(normalized.retryable, false);
    assert.equal(normalized.verifyUrl, "https://crm.test/admin/properties/2327/edit");
    assert.equal(
        normalized.message,
        'Property "2327" was not found in the old CRM. Verify manually: https://crm.test/admin/properties/2327/edit'
    );
});

test("normalizeOldCrmPropertyPullError classifies timeout errors as retryable navigation timeouts", () => {
    const error = new Error("Navigation timeout of 60000 ms exceeded");
    error.name = "TimeoutError";

    const normalized = normalizeOldCrmPropertyPullError(error);

    assert.equal(normalized.code, "NAVIGATION_TIMEOUT");
    assert.equal(normalized.retryable, true);
});

test("normalizeOldCrmPropertyPullError classifies network and browser disconnect errors as retryable", () => {
    const network = normalizeOldCrmPropertyPullError(new Error("net::ERR_CONNECTION_RESET at https://crm.test"));
    const disconnect = normalizeOldCrmPropertyPullError(new Error("Protocol error: Target closed. Browser has disconnected"));

    assert.equal(network.code, "TRANSIENT_NETWORK");
    assert.equal(network.retryable, true);
    assert.equal(disconnect.code, "TRANSIENT_NETWORK");
    assert.equal(disconnect.retryable, true);
});

test("normalizeOldCrmPropertyPullError classifies missing CRM configuration", () => {
    const normalized = normalizeOldCrmPropertyPullError(
        new Error("Missing CRM configuration. Check location URL and user credentials.")
    );

    assert.equal(normalized.code, "MISSING_CRM_CONFIG");
    assert.equal(normalized.retryable, false);
});

test("normalizeOldCrmPropertyPullError falls back to unknown for unclassified errors", () => {
    const normalized = normalizeOldCrmPropertyPullError(new Error("Something unexpected happened"));

    assert.equal(normalized.code, "UNKNOWN");
    assert.equal(normalized.retryable, false);
    assert.equal(normalized.message, "Something unexpected happened");
});

test("normalizeOldCrmPropertyPullResult passes successful pull data through unchanged", () => {
    const data = { reference: "DT3327", title: "Imported flat" };
    const normalized = normalizeOldCrmPropertyPullResult({
        locationId: "loc_123",
        pullResult: {
            success: true,
            data,
            warnings: ["Mapped with warning"],
        },
    });

    assert.deepEqual(normalized, {
        success: true,
        data,
        warnings: ["Mapped with warning"],
        notFound: false,
        verifyUrl: null,
        locationId: "loc_123",
    });
});

test("sanitizeOldCrmPropertyData keeps allowed fields and coerces numeric values", () => {
    const sanitized = sanitizeOldCrmPropertyData({
        title: "Imported flat",
        reference: "DT3327",
        price: "€250,000",
        bedrooms: "3",
        latitude: "34.772",
        longitude: "not a number",
        sortOrder: "",
        ownerContactId: "contact_123",
    });

    assert.deepEqual(sanitized.propertyData, {
        title: "Imported flat",
        reference: "DT3327",
        price: 250000,
        bedrooms: 3,
        latitude: 34.772,
        longitude: null,
        sortOrder: 0,
    });
    assert.deepEqual(sanitized.warnings, [
        'Coerced numeric field "price" from "€250,000" to 250000.',
        'Coerced numeric field "bedrooms" from "3" to 3.',
        'Could not map coordinate field "longitude" from "not a number".',
        'Dropped unsupported property field "ownerContactId".',
    ]);
});

test("sanitizeOldCrmPropertyData coerces Old CRM boolean flags", () => {
    const sanitized = sanitizeOldCrmPropertyData({
        title: "Imported flat",
        featured: "0",
    });

    assert.deepEqual(sanitized.propertyData, {
        title: "Imported flat",
        featured: false,
    });
    assert.deepEqual(sanitized.warnings, [
        'Coerced boolean field "featured" from "0" to false.',
    ]);
});

test("normalizeOldCrmPulledMedia maps images fallback to property media inputs", () => {
    const media = normalizeOldCrmPulledMedia({
        images: [
            { url: "https://img.test/1.jpg", cloudflareImageId: "cf_1", sortOrder: 3 },
            { url: "", sortOrder: 4 },
            { url: "https://img.test/doc.pdf", kind: MediaKind.DOCUMENT, metadata: { source: "old-crm" } },
        ],
    });

    assert.deepEqual(media, [
        {
            url: "https://img.test/1.jpg",
            kind: MediaKind.IMAGE,
            sortOrder: 3,
            cloudflareImageId: "cf_1",
            metadata: undefined,
        },
        {
            url: "https://img.test/doc.pdf",
            kind: MediaKind.DOCUMENT,
            sortOrder: 2,
            cloudflareImageId: undefined,
            metadata: { source: "old-crm" },
        },
    ]);
});

test("pullOldCrmPropertyWithRetry retries transient failure and succeeds on second attempt", async () => {
    let attempts = 0;
    const result = await pullOldCrmPropertyWithRetry({
        oldCrmPropertyId: "2327",
        maxAttempts: 2,
        initialBackoffMs: 0,
        jitterMs: 0,
        pull: async (): Promise<NormalizedOldCrmPropertyPullResult> => {
            attempts += 1;
            if (attempts === 1) {
                const error = new Error("Navigation timeout of 60000 ms exceeded");
                error.name = "TimeoutError";
                throw error;
            }
            return {
                success: true,
                data: { reference: "DT3327" },
                warnings: [],
                notFound: false,
                verifyUrl: null,
                locationId: "loc_123",
            };
        },
    });

    assert.equal(attempts, 2);
    assert.equal(result.success, true);
    assert.deepEqual(result.warnings, ["Old CRM pull succeeded after 2 attempts."]);
});

test("pullOldCrmPropertyWithRetry does not retry non-retryable not-found failures", async () => {
    let attempts = 0;
    const result = await pullOldCrmPropertyWithRetry({
        oldCrmPropertyId: "2327",
        maxAttempts: 3,
        initialBackoffMs: 0,
        jitterMs: 0,
        pull: async (): Promise<NormalizedOldCrmPropertyPullResult> => {
            attempts += 1;
            return {
                success: false,
                error: 'Property "2327" was not found in the old CRM.',
                errorCode: "PROPERTY_NOT_FOUND",
                retryable: false,
                rawError: 'Property "2327" was not found in the old CRM.',
                warnings: [],
                notFound: true,
                verifyUrl: "https://crm.test/admin/properties/2327/edit",
                locationId: "loc_123",
            };
        },
    });

    assert.equal(attempts, 1);
    assert.equal(result.success, false);
    assert.equal(result.notFound, true);
    assert.equal(result.verifyUrl, "https://crm.test/admin/properties/2327/edit");
});

test("pullOldCrmPropertyWithRetry stops after max attempts", async () => {
    let attempts = 0;
    const result = await pullOldCrmPropertyWithRetry({
        oldCrmPropertyId: "2327",
        maxAttempts: 3,
        initialBackoffMs: 0,
        jitterMs: 0,
        pull: async (): Promise<NormalizedOldCrmPropertyPullResult> => {
            attempts += 1;
            return {
                success: false,
                error: "net::ERR_CONNECTION_RESET at https://crm.test",
                errorCode: "TRANSIENT_NETWORK",
                retryable: true,
                rawError: "Error: net::ERR_CONNECTION_RESET at https://crm.test",
                warnings: [],
                notFound: false,
                verifyUrl: null,
                locationId: "loc_123",
            };
        },
    });

    assert.equal(attempts, 3);
    assert.equal(result.success, false);
    assert.equal(result.retryable, true);
    assert.deepEqual(result.warnings, ["Old CRM pull failed after 3 attempts."]);
});
