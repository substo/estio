import assert from "node:assert/strict";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import {
    getUserSubmissionsAtLocation,
    submitPublicPropertyAtLocation,
    toggleFavoriteAtLocation,
    updatePublicPropertyAtLocation,
    type PublicUserLocationDependencies,
} from "./public-user-location";
import { handlePublicImageDirectUpload } from "@/app/api/public/images/direct-upload/service";
import { resolvePublicSiteContactContext } from "@/lib/auth/public-site-contact-context";

const databaseUrl = process.env.PUBLIC_TENANT_TEST_DATABASE_URL;
if (!databaseUrl) {
    throw new Error("PUBLIC_TENANT_TEST_DATABASE_URL is required; use npm run test:public-tenant:db");
}

const parsedDatabaseUrl = new URL(databaseUrl);
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(parsedDatabaseUrl.hostname)) {
    throw new Error("Public tenant database tests only run against a loopback PostgreSQL server");
}
if (parsedDatabaseUrl.pathname !== "/estio_public_tenant_test") {
    throw new Error("Public tenant database tests require the estio_public_tenant_test database");
}

const db = new PrismaClient({ datasourceUrl: databaseUrl });
const fixturePrefix = `tenant-db-${Date.now()}`;

function validPropertyForm(locationId: string) {
    const formData = new FormData();
    formData.set("title", "Tenant property");
    formData.set("description", "A sufficiently detailed property description");
    formData.set("price", "250000");
    formData.set("currency", "EUR");
    formData.set("locationId", locationId);
    formData.set("propertyLocation", "limassol");
    formData.set("category", "residential");
    formData.set("type", "apartment");
    return formData;
}

test("real PostgreSQL preserves public submission tenant isolation", async (t) => {
    await db.$connect();
    t.after(async () => db.$disconnect());

    const [locationA, locationB] = await Promise.all([
        db.location.create({ data: { id: `${fixturePrefix}-location-a`, name: "Tenant A" } }),
        db.location.create({ data: { id: `${fixturePrefix}-location-b`, name: "Tenant B" } }),
    ]);
    const [contactA, contactB] = await Promise.all([
        db.contact.create({
            data: {
                id: `${fixturePrefix}-contact-a`,
                locationId: locationA.id,
                clerkUserId: `${fixturePrefix}-clerk-a`,
                name: "Owner A",
                email: `${fixturePrefix}-a@example.com`,
                status: "Active",
            },
        }),
        db.contact.create({
            data: {
                id: `${fixturePrefix}-contact-b`,
                locationId: locationB.id,
                clerkUserId: `${fixturePrefix}-clerk-b`,
                name: "Owner B",
                email: `${fixturePrefix}-b@example.com`,
                status: "Active",
            },
        }),
    ]);
    const [propertyA, propertyB] = await Promise.all([
        db.property.create({
            data: {
                id: `${fixturePrefix}-property-a`,
                locationId: locationA.id,
                title: "Tenant A property",
                slug: `${fixturePrefix}-property-a`,
                publicationStatus: "PENDING",
            },
        }),
        db.property.create({
            data: {
                id: `${fixturePrefix}-property-b`,
                locationId: locationB.id,
                title: "Tenant B property",
                slug: `${fixturePrefix}-property-b`,
                publicationStatus: "PENDING",
            },
        }),
    ]);
    const [ownerRoleA] = await Promise.all([
        db.contactPropertyRole.create({
            data: { contactId: contactA.id, propertyId: propertyA.id, role: "Owner" },
        }),
        db.contactPropertyRole.create({
            data: { contactId: contactA.id, propertyId: propertyB.id, role: "Owner" },
        }),
        db.contactPropertyRole.create({
            data: { contactId: contactB.id, propertyId: propertyB.id, role: "Owner" },
        }),
    ]);
    await Promise.all([
        db.contact.update({
            where: { id: contactA.id },
            data: { propertiesInterested: [propertyA.id, propertyB.id] },
        }),
        db.propertyMedia.create({
            data: { propertyId: propertyA.id, url: "https://example.test/original.jpg" },
        }),
    ]);

    const contextContact = {
        id: contactA.id,
        locationId: locationA.id,
        name: contactA.name,
        email: contactA.email,
        propertiesInterested: [propertyA.id, propertyB.id],
    };
    const resolveContext: PublicUserLocationDependencies["resolveContext"] = async (options) => {
        if (options.expectedLocationId !== locationA.id ||
            (options.assertedLocationId && options.assertedLocationId !== locationA.id)) {
            return { ok: false, reason: "tenant_mismatch" };
        }
        return {
            ok: true,
            context: {
                userId: contactA.clerkUserId!,
                hostname: "a.example.test",
                locationId: locationA.id,
                contact: contextContact,
            },
        };
    };
    const dependencies: PublicUserLocationDependencies = {
        db,
        resolveContext,
        ensureContact: async () => contextContact,
        visibleMedia: (media) => media,
        recordPropertyAnalytics: async () => undefined,
        revalidate: () => undefined,
    };

    await t.test("list excludes a foreign property despite a cross-tenant Owner row", async () => {
        const submissions = await getUserSubmissionsAtLocation(locationA.id, dependencies);
        assert.deepEqual(submissions.map((property: { id: string }) => property.id), [propertyA.id]);
    });

    await t.test("foreign edit is rejected without changing property or media", async () => {
        const formData = validPropertyForm(locationA.id);
        formData.set("propertyId", propertyB.id);
        formData.set("mediaJson", JSON.stringify([{ url: "https://example.test/forged.jpg" }]));
        const result = await updatePublicPropertyAtLocation(locationA.id, null, formData, dependencies);
        assert.equal(result.success, false);
        const unchanged = await db.property.findUniqueOrThrow({ where: { id: propertyB.id }, include: { media: true } });
        assert.equal(unchanged.title, "Tenant B property");
        assert.equal(unchanged.media.length, 0);
    });

    await t.test("forged create location produces no Property or owner row", async () => {
        const propertyCount = await db.property.count();
        const roleCount = await db.contactPropertyRole.count();
        const result = await submitPublicPropertyAtLocation(
            locationA.id,
            null,
            validPropertyForm(locationB.id),
            dependencies,
        );
        assert.equal(result.success, false);
        assert.equal(await db.property.count(), propertyCount);
        assert.equal(await db.contactPropertyRole.count(), roleCount);
    });

    await t.test("foreign favorite produces no Contact or analytics mutation", async () => {
        let analyticsCalls = 0;
        const result = await toggleFavoriteAtLocation(locationA.id, propertyB.id, {
            ...dependencies,
            recordPropertyAnalytics: async () => { analyticsCalls += 1; },
        });
        assert.equal(result.success, false);
        assert.equal(analyticsCalls, 0);
        const unchanged = await db.contact.findUniqueOrThrow({ where: { id: contactA.id } });
        assert.deepEqual(unchanged.propertiesInterested, [propertyA.id, propertyB.id]);
    });

    await t.test("foreign upload assertions and Contacts cannot create Cloudflare URLs", async () => {
        let cloudflareCalls = 0;
        const uploadRequest = (locationId: string) => new Request(
            "https://a.example.test/api/public/images/direct-upload",
            {
                method: "POST",
                headers: { "content-type": "application/json", host: "a.example.test" },
                body: JSON.stringify({ locationId }),
            },
        );
        const resolveUploadContext = (userId: string) => async (options: {
            assertedLocationId?: string | null;
            requestHeaders: Headers;
            userId: string;
        }) => resolvePublicSiteContactContext(options, {
            getUserId: async () => userId,
            getRequestHeaders: async () => options.requestHeaders,
            resolveDomain: async () => ({ locationId: locationA.id }),
            findContact: async (clerkUserId) => db.contact.findUnique({
                where: { clerkUserId },
                select: {
                    id: true,
                    locationId: true,
                    name: true,
                    email: true,
                    propertiesInterested: true,
                },
            }),
        });
        const createUploadUrl = async () => { cloudflareCalls += 1; return {}; };

        const forgedLocationResponse = await handlePublicImageDirectUpload(uploadRequest(locationB.id), {
            getUserId: async () => contactA.clerkUserId!,
            resolveContext: resolveUploadContext(contactA.clerkUserId!),
            createUploadUrl,
        });
        const foreignContactResponse = await handlePublicImageDirectUpload(uploadRequest(locationA.id), {
            getUserId: async () => contactB.clerkUserId!,
            resolveContext: resolveUploadContext(contactB.clerkUserId!),
            createUploadUrl,
        });
        assert.equal(forgedLocationResponse.status, 403);
        assert.equal(foreignContactResponse.status, 403);
        assert.equal(cloudflareCalls, 0);
    });

    await t.test("authority loss rolls back the serializable property transaction", async () => {
        let isolationLevel: unknown;
        const transactionDb = {
            ...db,
            property: {
                findFirst: (args: Parameters<typeof db.property.findFirst>[0]) => db.property.findFirst(args),
            },
            $transaction: async (callback: (tx: any) => Promise<unknown>, options: { isolationLevel?: unknown }) => {
                isolationLevel = options?.isolationLevel;
                return db.$transaction(async (tx) => callback({
                    property: {
                        updateMany: async (args: Parameters<typeof tx.property.updateMany>[0]) => {
                            const update = await tx.property.updateMany(args);
                            await tx.contactPropertyRole.delete({ where: { id: ownerRoleA.id } });
                            return update;
                        },
                        findFirst: (args: Parameters<typeof tx.property.findFirst>[0]) => tx.property.findFirst(args),
                    },
                    propertyMedia: {
                        deleteMany: (args: Parameters<typeof tx.propertyMedia.deleteMany>[0]) => tx.propertyMedia.deleteMany(args),
                        createMany: (args: Parameters<typeof tx.propertyMedia.createMany>[0]) => tx.propertyMedia.createMany(args),
                    },
                }), options as any);
            },
        };
        const formData = validPropertyForm(locationA.id);
        formData.set("propertyId", propertyA.id);
        formData.set("title", "Must roll back");
        formData.set("mediaJson", JSON.stringify([{ url: "https://example.test/replacement.jpg" }]));
        const result = await updatePublicPropertyAtLocation(locationA.id, null, formData, {
            ...dependencies,
            db: transactionDb,
        });
        assert.equal(result.success, false);
        assert.match(result.error || "", /access denied/i);
        assert.equal(isolationLevel, "Serializable");

        const [rolledBackProperty, rolledBackRole] = await Promise.all([
            db.property.findUniqueOrThrow({ where: { id: propertyA.id }, include: { media: true } }),
            db.contactPropertyRole.findUnique({ where: { id: ownerRoleA.id } }),
        ]);
        assert.equal(rolledBackProperty.title, "Tenant A property");
        assert.deepEqual(rolledBackProperty.media.map((media) => media.url), ["https://example.test/original.jpg"]);
        assert.ok(rolledBackRole);
    });
});
