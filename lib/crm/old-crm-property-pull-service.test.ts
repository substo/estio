import test from "node:test";
import assert from "node:assert/strict";
import { MediaKind } from "@prisma/client";
import {
    normalizeOldCrmPulledMedia,
    parseOldCrmPropertyNotFoundError,
    sanitizeOldCrmPropertyData,
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
