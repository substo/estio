import assert from "node:assert/strict";
import test from "node:test";
import {
    buildConversationVisibilityWhere,
    buildMessageVisibilityWhere,
    getConversationAssignmentUserId,
    resolveConversationScope,
} from "./contact-assignment-access";
import type { ActiveContactsAccess } from "../contacts/active-location-access";

const access = (role: "ADMIN" | "MEMBER", contactAccessScope: "ASSIGNED_ONLY" | "LOCATION_WIDE" = "ASSIGNED_ONLY"): ActiveContactsAccess => ({
    userId: "clerk_a",
    internalUserId: "user_a",
    locationId: "location_a",
    role,
    contactAccessScope,
});

test("MEMBER conversation visibility always derives from assigned Contact", () => {
    const member = access("MEMBER");
    assert.equal(resolveConversationScope(member, "location"), "my");
    assert.equal(getConversationAssignmentUserId(member, "location"), "user_a");
    assert.deepEqual(buildConversationVisibilityWhere(member, "location"), {
        locationId: "location_a",
        contact: { is: { locationId: "location_a", assignedUserId: "user_a" } },
    });
    assert.deepEqual(buildMessageVisibilityWhere(member, "location"), {
        conversation: {
            is: {
                locationId: "location_a",
                contact: { is: { locationId: "location_a", assignedUserId: "user_a" } },
            },
        },
    });
});

test("ADMIN may choose My assignments or All location", () => {
    const admin = access("ADMIN");
    assert.equal(resolveConversationScope(admin, "my"), "my");
    assert.equal(resolveConversationScope(admin, "location"), "location");
    assert.equal(getConversationAssignmentUserId(admin, "location"), undefined);
    assert.deepEqual(buildConversationVisibilityWhere(admin, "location"), { locationId: "location_a" });
});

test("missing Contact and unassigned Contact are not MEMBER-visible", () => {
    const where = buildConversationVisibilityWhere(access("MEMBER"), "my") as any;
    assert.equal(where.contact.is.assignedUserId, "user_a");
    assert.notEqual(where.contact.is.assignedUserId, null);
});

test("LOCATION_WIDE MEMBER inherits location Contact visibility for conversations", () => {
    const member = access("MEMBER", "LOCATION_WIDE");
    assert.equal(resolveConversationScope(member, "location"), "location");
    assert.equal(getConversationAssignmentUserId(member, "location"), undefined);
    assert.deepEqual(buildConversationVisibilityWhere(member, "location"), { locationId: "location_a" });
});
