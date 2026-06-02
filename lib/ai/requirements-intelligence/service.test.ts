import test from "node:test";
import assert from "node:assert/strict";
import { getRequirementPatchChanges } from "./service";

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
