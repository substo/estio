import assert from "node:assert/strict";
import test from "node:test";
import type { ActiveContactsAccess } from "../contacts/active-location-access";
import { buildDealManageWhere, buildDealVisibilityWhere, resolveDealScope } from "./assignment-access";
import { reassignActiveDealsWithinLocation } from "./reassignment";

const access = (role: "ADMIN" | "MEMBER", contactAccessScope: "ASSIGNED_ONLY" | "LOCATION_WIDE" = "ASSIGNED_ONLY"): ActiveContactsAccess => ({
    userId: "clerk_a",
    internalUserId: "user_a",
    locationId: "location_a",
    role,
    contactAccessScope,
});

test("LOCATION_WIDE Contact visibility never grants another user's Deals", () => {
    const member = access("MEMBER", "LOCATION_WIDE");
    assert.equal(resolveDealScope(member, "location"), "my");
    assert.deepEqual(buildDealVisibilityWhere(member, "location"), {
        locationId: "location_a", assignedUserId: "user_a",
    });
});

test("Deal scope is ADMIN-selectable and MEMBER assignment-only", () => {
    const admin = access("ADMIN");
    const member = access("MEMBER");
    assert.equal(resolveDealScope(admin, "location"), "location");
    assert.deepEqual(buildDealVisibilityWhere(admin, "location"), { locationId: "location_a" });
    assert.equal(resolveDealScope(member, "location"), "my");
    assert.deepEqual(buildDealVisibilityWhere(member, "location"), {
        locationId: "location_a", assignedUserId: "user_a",
    });
    assert.deepEqual(buildDealManageWhere(member), {
        locationId: "location_a", assignedUserId: "user_a",
    });
});

test("Deal transfer updates active responsibilities once without cloning", async () => {
    const calls: any[] = [];
    const result = await reassignActiveDealsWithinLocation({
        dealContext: { updateMany: async (args) => { calls.push(args); return { count: 3 }; } },
    }, { locationId: "location_a", sourceUserId: "user_a", successorUserId: "user_b" });
    assert.deepEqual(result, { count: 3 });
    assert.deepEqual(calls, [{
        where: { locationId: "location_a", assignedUserId: "user_a", stage: { not: "CLOSED" } },
        data: { assignedUserId: "user_b" },
    }]);
});
