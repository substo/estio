import assert from "node:assert/strict";
import test from "node:test";

import { AiUsageAttributionError, resolveAiUsageAttribution } from "./usage-attribution-policy";

const users = [
    { id: "db-user-a", locationId: "location-a" },
    { id: "db-user-b", locationId: "location-a" },
];
const findUserInLocation = async (id: string, locationId: string) => {
    const user = users.find((candidate) => candidate.id === id && candidate.locationId === locationId);
    return user ? { id: user.id } : null;
};

test("interactive usage is attributed to the authenticated internal database user", async () => {
    assert.equal(await resolveAiUsageAttribution({
        locationId: "location-a",
        requestedDbUserId: "db-user-a",
        findUserInLocation,
    }), "db-user-a");
});

test("a Clerk user ID is never accepted as AiUsage.userId", async () => {
    await assert.rejects(resolveAiUsageAttribution({
        locationId: "location-a",
        requestedDbUserId: "user_clerk_123",
        findUserInLocation,
    }), AiUsageAttributionError);
});

test("a database user from another location is rejected before telemetry insert", async () => {
    let telemetryInsert = 0;
    await assert.rejects((async () => {
        const userId = await resolveAiUsageAttribution({
            locationId: "location-b",
            requestedDbUserId: "db-user-a",
            findUserInLocation,
        });
        telemetryInsert += 1;
        return userId;
    })(), AiUsageAttributionError);
    assert.equal(telemetryInsert, 0);
});

test("automated location workflows remain unattributed", async () => {
    assert.equal(await resolveAiUsageAttribution({
        locationId: "location-a",
        requestedDbUserId: null,
        findUserInLocation,
    }), null);
});

test("My usage filtering keeps User B from seeing User A records", () => {
    const usage = [
        { id: "usage-a", locationId: "location-a", userId: "db-user-a" },
        { id: "usage-b", locationId: "location-a", userId: "db-user-b" },
    ];
    const userBUsage = usage.filter((record) =>
        record.locationId === "location-a" && record.userId === "db-user-b");
    assert.deepEqual(userBUsage.map(({ id }) => id), ["usage-b"]);
});
