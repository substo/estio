import assert from "node:assert/strict";
import test from "node:test";

import {
    createPropertyAccessPolicy,
    PropertyAccessDeniedError,
} from "./property-access-policy";

function createHarness(options: {
    authenticated?: boolean;
    activeLocationId?: string | null;
    propertyLocationId?: string | null;
    dbUserId?: string | null;
    admin?: boolean;
} = {}) {
    const calls = { propertyLookup: 0, adminCheck: 0, sideEffect: 0 };
    const activeLocationId = options.activeLocationId === undefined ? "location-a" : options.activeLocationId;
    const propertyLocationId = options.propertyLocationId === undefined ? "location-a" : options.propertyLocationId;

    const policy = createPropertyAccessPolicy({
        getAuthenticatedUserId: async () => options.authenticated === false ? null : "clerk-user",
        findAuthenticatedDbUserId: async () => options.dbUserId === null ? null : (options.dbUserId || "db-user"),
        getActiveLocation: async () => activeLocationId ? { id: activeLocationId } : null,
        findPropertyInLocation: async (propertyId, locationId) => {
            calls.propertyLookup += 1;
            return propertyId === "property-1" && propertyLocationId === locationId
                ? { id: propertyId, locationId }
                : null;
        },
        isLocationAdmin: async () => {
            calls.adminCheck += 1;
            return options.admin === true;
        },
    });

    async function runPropertyOperation(input: {
        propertyId?: string;
        requestedLocationId?: string;
        adminOnly?: boolean;
    } = {}) {
        const result = await policy.requirePropertyInActiveLocation(
            input.propertyId || "property-1",
            {
                requestedLocationId: input.requestedLocationId,
                adminOnly: input.adminOnly,
            },
        );
        calls.sideEffect += 1;
        return result;
    }

    return { calls, policy, runPropertyOperation };
}

test("a query-string location cannot override the active location", async () => {
    const harness = createHarness();
    await assert.rejects(
        harness.runPropertyOperation({ requestedLocationId: "foreign-location" }),
        PropertyAccessDeniedError,
    );
    assert.deepEqual(harness.calls, { propertyLookup: 0, adminCheck: 0, sideEffect: 0 });
});

for (const operation of [
    "view or edit a property",
    "read property AI usage",
    "push a property to CRM",
    "change property creator attribution",
    "read property translations",
    "import a property to CRM",
]) {
    test(`a foreign property cannot ${operation}`, async () => {
        const harness = createHarness({ propertyLocationId: "location-b" });
        await assert.rejects(harness.runPropertyOperation(), PropertyAccessDeniedError);
        assert.equal(harness.calls.sideEffect, 0);
    });
}

test("same-location members can use shared property operations", async () => {
    const harness = createHarness();
    const result = await harness.runPropertyOperation();
    assert.equal(result.property.id, "property-1");
    assert.equal(result.locationId, "location-a");
    assert.equal(result.dbUserId, "db-user");
    assert.equal(harness.calls.sideEffect, 1);
});

test("a missing internal database user fails before property lookup or side effects", async () => {
    const harness = createHarness({ dbUserId: null });
    await assert.rejects(harness.runPropertyOperation(), PropertyAccessDeniedError);
    assert.deepEqual(harness.calls, { propertyLookup: 0, adminCheck: 0, sideEffect: 0 });
});

test("unauthenticated property operations fail before database lookup or side effects", async () => {
    const harness = createHarness({ authenticated: false });
    await assert.rejects(harness.runPropertyOperation(), PropertyAccessDeniedError);
    assert.deepEqual(harness.calls, { propertyLookup: 0, adminCheck: 0, sideEffect: 0 });
});

test("admin-only property operations reject members before property lookup", async () => {
    const harness = createHarness({ admin: false });
    await assert.rejects(harness.runPropertyOperation({ adminOnly: true }), PropertyAccessDeniedError);
    assert.deepEqual(harness.calls, { propertyLookup: 0, adminCheck: 1, sideEffect: 0 });
});

test("location admins retain access to admin-only property operations", async () => {
    const harness = createHarness({ admin: true });
    await harness.runPropertyOperation({ adminOnly: true });
    assert.deepEqual(harness.calls, { propertyLookup: 1, adminCheck: 1, sideEffect: 1 });
});
