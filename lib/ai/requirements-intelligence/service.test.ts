import test from "node:test";
import assert from "node:assert/strict";
import {
  getRequirementPatchChanges,
  shouldAssessRequirementsForActivity,
} from "./service";

test("getRequirementPatchChanges excludes unchanged requirement fields", () => {
  const changes = getRequirementPatchChanges({
    requirementDistrict: "Paphos",
    requirementBedrooms: "3",
    requirementMinPrice: "200000",
    requirementPropertyTypes: ["Apartment", "Villa"],
  }, {
    requirementDistrict: "Paphos",
    requirementBedrooms: "4",
    requirementMinPrice: " 200000 ",
    requirementPropertyTypes: ["Apartment", "Villa"],
  });

  assert.deepEqual(changes, [
    { field: "requirementBedrooms", old: "3", new: "4" },
  ]);
});

test("getRequirementPatchChanges compares normalized array values", () => {
  const changes = getRequirementPatchChanges({
    requirementPropertyLocations: ["Paphos", "Limassol"],
  }, {
    requirementPropertyLocations: ["Paphos", "Limassol", "Paphos", ""],
  });

  assert.deepEqual(changes, []);
});

test("shouldAssessRequirementsForActivity gates by freshness and debounce", () => {
  const now = new Date("2026-06-07T12:00:00.000Z");

  assert.equal(shouldAssessRequirementsForActivity({
    latestActivityAt: new Date("2026-06-07T10:00:00.000Z"),
    lastAssessedAt: null,
    now,
    debounceMinutes: 60,
  }), true);

  assert.equal(shouldAssessRequirementsForActivity({
    latestActivityAt: new Date("2026-06-07T11:30:00.000Z"),
    lastAssessedAt: null,
    now,
    debounceMinutes: 60,
  }), false);

  assert.equal(shouldAssessRequirementsForActivity({
    latestActivityAt: new Date("2026-06-07T10:00:00.000Z"),
    lastAssessedAt: new Date("2026-06-07T10:30:00.000Z"),
    now,
    debounceMinutes: 0,
  }), false);

  assert.equal(shouldAssessRequirementsForActivity({
    latestActivityAt: null,
    lastAssessedAt: new Date("2026-06-07T10:30:00.000Z"),
    dueAt: new Date("2026-06-07T11:00:00.000Z"),
    now,
    debounceMinutes: 60,
  }), true);
});
