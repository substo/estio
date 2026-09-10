import assert from "node:assert/strict";
import test from "node:test";
import { resolvePublicSiteContactContext } from "./public-site-contact-context";
import { ensureContactForClerkUser } from "./ensure-contact";

function headersFor(hostname: string) {
    return new Headers({ host: hostname });
}

test("public-site context rejects bound and caller tenant mismatches before contact lookup", async () => {
    let contactReads = 0;
    const dependencies = {
        getUserId: async () => "clerk-a",
        getRequestHeaders: async () => headersFor("a.example.com"),
        resolveDomain: async () => ({ locationId: "location-a" }),
        findContact: async () => {
            contactReads += 1;
            return { id: "contact-a", locationId: "location-a" };
        },
    };

    const boundMismatch = await resolvePublicSiteContactContext(
        { expectedLocationId: "location-b" },
        dependencies,
    );
    const assertedMismatch = await resolvePublicSiteContactContext(
        { assertedLocationId: "location-b" },
        dependencies,
    );

    assert.deepEqual(boundMismatch, { ok: false, reason: "tenant_mismatch" });
    assert.deepEqual(assertedMismatch, { ok: false, reason: "tenant_mismatch" });
    assert.equal(contactReads, 0);
});

test("public-site context rejects a Clerk Contact belonging to another tenant", async () => {
    const result = await resolvePublicSiteContactContext(
        { expectedLocationId: "location-a" },
        {
            getUserId: async () => "clerk-b",
            getRequestHeaders: async () => headersFor("a.example.com"),
            resolveDomain: async () => ({ locationId: "location-a" }),
            findContact: async () => ({ id: "contact-b", locationId: "location-b" }),
        },
    );
    assert.deepEqual(result, { ok: false, reason: "contact_tenant_mismatch" });
});

test("public-site context distinguishes unknown from unavailable registered domains", async () => {
    const base = {
        getUserId: async () => "clerk-a",
        getRequestHeaders: async () => headersFor("unknown.example.com"),
        findContact: async () => ({ id: "contact-a", locationId: "location-a" }),
    };
    const unknown = await resolvePublicSiteContactContext({}, {
        ...base,
        resolveDomain: async () => null,
    });
    const unavailable = await resolvePublicSiteContactContext({}, {
        ...base,
        resolveDomain: async () => { throw new Error("database unavailable"); },
    });
    assert.deepEqual(unknown, { ok: false, reason: "unknown_domain" });
    assert.deepEqual(unavailable, { ok: false, reason: "domain_unavailable" });
});

test("ensureContact never relinks an existing Clerk identity from another tenant", async () => {
    let writes = 0;
    const result = await ensureContactForClerkUser(
        "location-b",
        { id: "clerk-a", emailAddresses: [{ emailAddress: "owner@example.com" }] },
        {
            contact: {
                findUnique: async () => ({ id: "contact-a", locationId: "location-a" }),
                findFirst: async () => null,
                update: async () => { writes += 1; },
                create: async () => { writes += 1; },
            },
            isUniqueError: () => false,
        },
    );
    assert.equal(result, null);
    assert.equal(writes, 0);
});

test("ensureContact uniqueness races accept only the requested tenant", async () => {
    let reads = 0;
    const result = await ensureContactForClerkUser(
        "location-a",
        { id: "clerk-a", emailAddresses: [] },
        {
            contact: {
                findUnique: async () => {
                    reads += 1;
                    return reads === 1 ? null : { id: "contact-b", locationId: "location-b" };
                },
                findFirst: async () => null,
                update: async () => null,
                create: async () => { throw new Error("unique race"); },
            },
            isUniqueError: () => true,
        },
    );
    assert.equal(result, null);
    assert.equal(reads, 2);
});

test("ensureContact does not claim an existing Contact by email", async () => {
    let clerkReads = 0;
    let emailLookups = 0;
    let contactUpdates = 0;
    const result = await ensureContactForClerkUser(
        "location-a",
        { id: "clerk-new", emailAddresses: [{ emailAddress: "owner@example.com" }] },
        {
            contact: {
                findUnique: async () => {
                    clerkReads += 1;
                    return null;
                },
                findFirst: async () => { emailLookups += 1; return { id: "owner-a", locationId: "location-a" }; },
                update: async () => { contactUpdates += 1; return null; },
                create: async () => { throw new Error("unique email"); },
            },
            isUniqueError: () => true,
        },
    );
    assert.equal(result, null);
    assert.equal(clerkReads, 2);
    assert.equal(emailLookups, 0);
    assert.equal(contactUpdates, 0);
});
