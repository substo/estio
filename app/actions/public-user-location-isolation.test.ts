import assert from "node:assert/strict";
import test from "node:test";
import {
    getFavoriteIdsAtLocation,
    getFavoritesAtLocation,
    getUserSubmissionsAtLocation,
    submitPublicPropertyAtLocation,
    toggleFavoriteAtLocation,
    updatePublicPropertyAtLocation,
    type PublicUserLocationDependencies,
} from "./public-user-location";

const tenantAContact = {
    id: "contact-a",
    locationId: "location-a",
    name: "Owner A",
    email: "a@example.com",
    propertiesInterested: ["property-b"],
};

function contextResolver(contact = tenantAContact) {
    return async (options: {
        expectedLocationId: string;
        assertedLocationId?: string | null;
        requireContact?: boolean;
    }) => {
        if (options.expectedLocationId !== "location-a" ||
            (options.assertedLocationId && options.assertedLocationId !== "location-a")) {
            return { ok: false as const, reason: "tenant_mismatch" as const };
        }
        return {
            ok: true as const,
            context: {
                userId: "clerk-a",
                hostname: "a.example.com",
                locationId: "location-a",
                contact: options.requireContact === false ? contact : contact,
            },
        };
    };
}

function dependencies(overrides: Partial<PublicUserLocationDependencies> = {}): PublicUserLocationDependencies {
    return {
        db: {
            property: {
                findFirst: async () => null,
                findMany: async () => [],
                create: async () => ({ id: "property-a" }),
                updateMany: async () => ({ count: 1 }),
            },
            contact: { updateMany: async () => ({ count: 1 }) },
            propertyMedia: { createMany: async () => ({ count: 0 }) },
            $transaction: async (callback: (tx: unknown) => unknown) => callback({
                propertyMedia: {
                    deleteMany: async () => ({ count: 0 }),
                    createMany: async () => ({ count: 0 }),
                },
            }),
        },
        resolveContext: contextResolver(),
        ensureContact: async () => tenantAContact,
        visibleMedia: (media) => media,
        recordPropertyAnalytics: async () => undefined,
        revalidate: () => undefined,
        ...overrides,
    };
}

function validPropertyForm(assertedLocationId = "location-a") {
    const formData = new FormData();
    formData.set("title", "Tenant property");
    formData.set("description", "A sufficiently detailed property description");
    formData.set("price", "250000");
    formData.set("currency", "EUR");
    formData.set("locationId", assertedLocationId);
    formData.set("propertyLocation", "limassol");
    formData.set("category", "residential");
    formData.set("type", "apartment");
    return formData;
}

test("submission list excludes a foreign property even with an owner relationship", async () => {
    const properties = [
        { id: "property-a", locationId: "location-a", status: "ACTIVE", publicationStatus: "PENDING", media: [] },
        { id: "property-b", locationId: "location-b", status: "ACTIVE", publicationStatus: "PENDING", media: [] },
    ];
    let receivedWhere: any;
    const deps = dependencies({
        db: {
            property: {
                findMany: async ({ where }: any) => {
                    receivedWhere = where;
                    return properties.filter((property) => property.locationId === where.locationId);
                },
            },
        },
    });
    const result = await getUserSubmissionsAtLocation("location-a", deps);
    assert.deepEqual(result.map((property: any) => property.id), ["property-a"]);
    assert.equal(receivedWhere.locationId, "location-a");
    assert.equal(receivedWhere.contactRoles.some.contact.locationId, "location-a");
});

test("foreign-tenant edit is rejected before property or media writes", async () => {
    let propertyWrites = 0;
    let mediaTransactions = 0;
    const deps = dependencies({
        db: {
            property: {
                findFirst: async ({ where }: any) => where.id === "property-b" && where.locationId === "location-b"
                    ? { id: "property-b" }
                    : null,
                updateMany: async () => { propertyWrites += 1; return { count: 1 }; },
            },
            $transaction: async () => { mediaTransactions += 1; },
        },
    });
    const formData = validPropertyForm();
    formData.set("propertyId", "property-b");
    formData.set("mediaJson", "[]");
    const result = await updatePublicPropertyAtLocation("location-a", null, formData, deps);
    assert.equal(result.success, false);
    assert.equal(propertyWrites, 0);
    assert.equal(mediaTransactions, 0);
});

test("forged create location is rejected before Contact, Property, or media creation", async () => {
    let contactCreates = 0;
    let propertyCreates = 0;
    let mediaCreates = 0;
    const deps = dependencies({
        resolveContext: contextResolver(null as any),
        ensureContact: async () => { contactCreates += 1; return tenantAContact; },
        db: {
            property: { create: async () => { propertyCreates += 1; return { id: "property-a" }; } },
            propertyMedia: { createMany: async () => { mediaCreates += 1; } },
        },
    });
    const result = await submitPublicPropertyAtLocation("location-a", null, validPropertyForm("location-b"), deps);
    assert.equal(result.success, false);
    assert.equal(contactCreates, 0);
    assert.equal(propertyCreates, 0);
    assert.equal(mediaCreates, 0);
});

test("foreign favorite is rejected before Contact update and analytics", async () => {
    let contactWrites = 0;
    let analyticsWrites = 0;
    const deps = dependencies({
        db: {
            property: { findFirst: async () => null },
            contact: { updateMany: async () => { contactWrites += 1; return { count: 1 }; } },
        },
        recordPropertyAnalytics: async () => { analyticsWrites += 1; },
    });
    const result = await toggleFavoriteAtLocation("location-a", "property-b", deps);
    assert.equal(result.success, false);
    assert.equal(contactWrites, 0);
    assert.equal(analyticsWrites, 0);
});

test("favorite reads and ID lists filter stale foreign-tenant entries", async () => {
    const properties = [
        { id: "property-a", locationId: "location-a", publicationStatus: "PUBLISHED", media: [] },
        { id: "property-b", locationId: "location-b", publicationStatus: "PUBLISHED", media: [] },
    ];
    const seenLocations: string[] = [];
    const deps = dependencies({
        db: {
            property: {
                findMany: async ({ where }: any) => {
                    seenLocations.push(where.locationId);
                    return properties.filter((property) => property.locationId === where.locationId);
                },
            },
        },
    });
    const [favorites, ids] = await Promise.all([
        getFavoritesAtLocation("location-a", deps),
        getFavoriteIdsAtLocation("location-a", deps),
    ]);
    assert.deepEqual(favorites.map((property: any) => property.id), ["property-a"]);
    assert.deepEqual(ids, ["property-a"]);
    assert.deepEqual(seenLocations, ["location-a", "location-a"]);
});

test("valid create persists the server-resolved tenant and same-tenant owner", async () => {
    let createdData: any;
    const deps = dependencies({
        db: {
            property: {
                create: async ({ data }: any) => {
                    createdData = data;
                    return { id: "property-a" };
                },
            },
            propertyMedia: { createMany: async () => ({ count: 0 }) },
        },
    });
    const result = await submitPublicPropertyAtLocation("location-a", null, validPropertyForm(), deps);
    assert.equal(result.success, true);
    assert.equal(createdData.locationId, "location-a");
    assert.equal(createdData.contactRoles.create.contactId, "contact-a");
});

test("same-tenant owner edit updates only the resolved tenant property", async () => {
    let updateWhere: any;
    const deps = dependencies({
        db: {
            property: {
                findFirst: async ({ where }: any) => where.id === "property-a" && where.locationId === "location-a"
                    ? { id: "property-a" }
                    : null,
                updateMany: async ({ where }: any) => {
                    updateWhere = where;
                    return { count: 1 };
                },
            },
        },
    });
    const formData = validPropertyForm();
    formData.set("propertyId", "property-a");
    const result = await updatePublicPropertyAtLocation("location-a", null, formData, deps);
    assert.equal(result.success, true);
    assert.equal(updateWhere.id, "property-a");
    assert.equal(updateWhere.locationId, "location-a");
    assert.equal(updateWhere.contactRoles.some.contactId, "contact-a");
    assert.equal(updateWhere.contactRoles.some.contact.locationId, "location-a");
});

test("edit authorization is rechecked atomically before media replacement", async () => {
    let mediaWrites = 0;
    const deps = dependencies({
        db: {
            property: { findFirst: async () => ({ id: "property-a" }) },
            $transaction: async (callback: (tx: any) => unknown) => callback({
                property: {
                    updateMany: async ({ where }: any) => {
                        assert.equal(where.locationId, "location-a");
                        assert.equal(where.contactRoles.some.contactId, "contact-a");
                        return { count: 1 };
                    },
                    findFirst: async () => null,
                },
                propertyMedia: {
                    deleteMany: async () => { mediaWrites += 1; },
                    createMany: async () => { mediaWrites += 1; },
                },
            }),
        },
    });
    const formData = validPropertyForm();
    formData.set("propertyId", "property-a");
    formData.set("mediaJson", "[]");
    const result = await updatePublicPropertyAtLocation("location-a", null, formData, deps);
    assert.equal(result.success, false);
    assert.match(result.error || "", /access denied/i);
    assert.equal(mediaWrites, 0);
});

test("same-tenant favorite writes and analytics stay in the resolved tenant", async () => {
    let updateWhere: any;
    let analyticsLocation: unknown;
    const deps = dependencies({
        db: {
            property: {
                findFirst: async ({ where }: any) => where.locationId === "location-a"
                    ? { id: "property-a", locationId: "location-a", slug: "home", title: "Home" }
                    : null,
            },
            contact: {
                updateMany: async ({ where }: any) => {
                    updateWhere = where;
                    return { count: 1 };
                },
            },
        },
        recordPropertyAnalytics: async (input) => { analyticsLocation = input.locationId; },
    });
    const result = await toggleFavoriteAtLocation("location-a", "property-a", deps);
    assert.equal(result.success, true);
    assert.deepEqual(updateWhere, { id: "contact-a", locationId: "location-a" });
    assert.equal(analyticsLocation, "location-a");
});
