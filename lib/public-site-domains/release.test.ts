import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { releasePublicSiteDomainInTransaction } from "./service";

test("releasing the active canonical domain clears legacy fields and creates a cleanup job", async () => {
    const calls: Record<string, any> = {};
    const binding = {
        id: "domain_1",
        locationId: "location_1",
        hostname: "properties.example.com",
        role: "CANONICAL",
        status: "ACTIVE",
    };
    const tx = {
        publicSiteDomain: {
            findFirst: async () => binding,
            update: async (args: any) => {
                calls.domainUpdate = args;
                return { ...binding, status: "RELEASED" };
            },
        },
        location: {
            update: async (args: any) => { calls.location = args; },
        },
        settingsDocument: {
            findUnique: async () => ({ id: "settings_1", payload: { domain: binding.hostname, name: "Site" } }),
            update: async (args: any) => { calls.settings = args; },
        },
        publicSiteDomainProvisioningJob: {
            upsert: async (args: any) => {
                calls.job = args;
                return { id: "job_1" };
            },
        },
    } as unknown as Prisma.TransactionClient;

    const result = await releasePublicSiteDomainInTransaction(tx, {
        locationId: binding.locationId,
        domainId: binding.id,
        actorUserId: "user_1",
    });

    // The canonical domain lives on Location only; the website document no longer copies it.
    assert.equal(calls.location.data.domain, null);
    assert.equal(calls.settings, undefined);
    assert.equal(calls.domainUpdate.data.status, "RELEASED");
    assert.equal(calls.job.create.operation, "RELEASE");
    assert.equal(result.job.id, "job_1");
});
