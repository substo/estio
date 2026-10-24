import assert from "node:assert/strict";
import test from "node:test";
import { isStudioLocationAllowedForSession } from "./access-policy";

test("ordinary sessions can select another authorized location", () => {
  assert.equal(isStudioLocationAllowedForSession({ locationId: "location-b", isImpersonating: false, impersonationLocationId: null }), true);
});

test("impersonation stays inside its audited location even when the target has other memberships", () => {
  assert.equal(isStudioLocationAllowedForSession({ locationId: "location-a", isImpersonating: true, impersonationLocationId: "location-a" }), true);
  assert.equal(isStudioLocationAllowedForSession({ locationId: "location-b", isImpersonating: true, impersonationLocationId: "location-a" }), false);
});

test("an actor without a valid impersonation location fails closed", () => {
  assert.equal(isStudioLocationAllowedForSession({ locationId: "location-a", isImpersonating: true, impersonationLocationId: null }), false);
});
