import test from "node:test";
import assert from "node:assert/strict";
import {
  buildContactVerificationAssessment,
  getContactVerificationPatchChanges,
  normalizeContactVerificationPatch,
} from "./service";

test("verification proposes agent correction for lead with agent context", () => {
  const result = buildContactVerificationAssessment({
    contact: {
      id: "contact_1",
      contactType: "Lead",
      leadGoal: "To Buy",
      name: "Maria Agent",
      qualificationStage: "unqualified",
    },
    recentMessages: [{ body: "Contact role: agent. Listed by Maria." }],
  });

  assert.equal(result.status, "likely_agent");
  assert.equal(result.proposedPatch.contactType, "Agent");
  assert.equal(result.proposedPatch.leadGoal, null);
  assert.equal(result.proposedPatch.qualificationStage, "not_a_lead");
  assert.match(result.reasoning, /Agent/);
});

test("verification proposes owner correction for lead with owner context", () => {
  const result = buildContactVerificationAssessment({
    contact: {
      id: "contact_2",
      contactType: "Lead",
      leadGoal: "To Rent",
      name: "Andreas Owner DT4930",
      qualificationStage: "unqualified",
    },
    recentMessages: [{ body: "Owner name: Andreas. Reference DT4930." }],
  });

  assert.equal(result.status, "likely_owner");
  assert.equal(result.proposedPatch.contactType, "Owner");
  assert.equal(result.proposedPatch.leadGoal, null);
});

test("verification leaves real buyer lead unchanged", () => {
  const result = buildContactVerificationAssessment({
    contact: {
      id: "contact_3",
      contactType: "Lead",
      leadGoal: "To Buy",
      name: "John Buyer",
      qualificationStage: "basic",
      requirementSummary: "Looking for a two-bedroom apartment in Paphos.",
    },
    recentMessages: [{ body: "I want to buy a flat near the sea." }],
  });

  assert.equal(result.status, "verified_lead");
  assert.equal(result.hasChanges, false);
  assert.deepEqual(result.proposedPatch, {});
});

test("verification patch normalizer accepts only allowed profile fields", () => {
  assert.deepEqual(normalizeContactVerificationPatch({
    contactType: "Agent",
    leadGoal: null,
    qualificationStage: "not_a_lead",
    status: "Archived",
  }), {
    contactType: "Agent",
    leadGoal: null,
    qualificationStage: "not_a_lead",
  });
});

test("verification patch changes ignore unchanged normalized values", () => {
  const changes = getContactVerificationPatchChanges({
    contactType: "Lead",
    name: "Maria",
  }, {
    contactType: "Agent",
    name: " Maria ",
  });

  assert.deepEqual(changes, [
    { field: "contactType", old: "Lead", new: "Agent" },
  ]);
});
