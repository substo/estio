import assert from "node:assert/strict";
import test from "node:test";
import {
  assertLocationCanBeDeleted,
  LocationDeletionError,
  locationDeletionHttpStatus,
  locationDisplayName,
} from "./location-deletion-policy";

const removable = {
  name: "Example Office",
  isPlatformMaster: false,
  retainedAuditCount: 0,
  mediaAssetCount: 0,
  externalResourceCount: 0,
};

test("requires the exact normalized display name", () => {
  assert.doesNotThrow(() => assertLocationCanBeDeleted(removable, " Example Office "));
  assert.throws(() => assertLocationCanBeDeleted(removable, "example office"), /exact location name/i);
  assert.equal(locationDisplayName(null), "Unnamed location");
});

test("protects the master location", () => {
  assert.throws(
    () => assertLocationCanBeDeleted({ ...removable, isPlatformMaster: true }, "Example Office"),
    (error) => error instanceof LocationDeletionError && error.code === "PROTECTED",
  );
});

test("blocks deletion while retained audits, media assets, or external resources remain", () => {
  for (const target of [
    { ...removable, retainedAuditCount: 1 },
    { ...removable, mediaAssetCount: 1 },
    { ...removable, externalResourceCount: 1 },
  ]) {
    assert.throws(
      () => assertLocationCanBeDeleted(target, "Example Office"),
      (error) => error instanceof LocationDeletionError && error.code === "BLOCKED",
    );
  }
});

test("maps expected deletion errors to safe HTTP statuses", () => {
  assert.equal(locationDeletionHttpStatus(new LocationDeletionError("missing", "NOT_FOUND")), 404);
  assert.equal(locationDeletionHttpStatus(new LocationDeletionError("blocked", "BLOCKED")), 409);
  assert.equal(locationDeletionHttpStatus(new LocationDeletionError("confirm", "INVALID_CONFIRMATION")), 400);
  assert.equal(locationDeletionHttpStatus(new Error("unexpected")), 500);
});
