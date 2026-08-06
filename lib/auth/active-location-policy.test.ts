import assert from "node:assert/strict";
import test from "node:test";
import { chooseActiveLocation, intersectAuthorizedLocations } from "./active-location-policy";

const adminRole = { role: "ADMIN" as const, contactAccessScope: "LOCATION_WIDE" as const };

test("one authorized location is always selected and ignores a stale cookie", () => {
  const locations = intersectAuthorizedLocations({
    connectedLocations: [{ id: "loc-a", name: "Alpha" }],
    roles: [{ locationId: "loc-a", ...adminRole }],
  });
  assert.deepEqual(chooseActiveLocation(locations, "removed-location"), { status: "authorized", location: locations[0] });
});

test("multi-location access requires a valid cookie before tenant data is selected", () => {
  const locations = intersectAuthorizedLocations({
    connectedLocations: [{ id: "loc-a", name: "Alpha" }, { id: "loc-b", name: "Beta" }],
    roles: [{ locationId: "loc-a", ...adminRole }, { locationId: "loc-b", role: "MEMBER", contactAccessScope: "ASSIGNED_ONLY" }],
  });
  assert.equal(chooseActiveLocation(locations, null).status, "selection_required");
  assert.equal(chooseActiveLocation(locations, "forged").status, "selection_required");
  assert.equal(chooseActiveLocation(locations, "loc-b").location?.id, "loc-b");
});

test("connections and roles are both required and removed membership invalidates selection", () => {
  const inconsistent = intersectAuthorizedLocations({
    connectedLocations: [{ id: "connected-only", name: "Connected" }, { id: "valid", name: "Valid" }],
    roles: [{ locationId: "role-only", ...adminRole }, { locationId: "valid", ...adminRole }],
  });
  assert.deepEqual(inconsistent.map((location) => location.id), ["valid"]);

  const afterRemoval = intersectAuthorizedLocations({
    connectedLocations: [{ id: "other", name: "Other" }, { id: "valid", name: "Valid" }],
    roles: [{ locationId: "other", ...adminRole }],
  });
  assert.equal(chooseActiveLocation(afterRemoval, "valid").location?.id, "other");
});
