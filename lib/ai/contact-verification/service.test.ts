import test from "node:test";
import assert from "node:assert/strict";
import {
  buildContactVerificationAssessment,
  getContactVerificationPatchChanges,
  normalizeContactVerificationPatch,
  preserveStructuredLeadDisplayNamePatch,
  shouldAutoApplyContactVerificationAssessment,
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
  assert.equal(result.proposedPatch.firstName, "Maria");
  assert.equal("lastName" in result.proposedPatch, false);
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
  assert.equal(result.proposedPatch.firstName, "Andreas");
  assert.equal("lastName" in result.proposedPatch, false);
});

test("verification leaves real buyer lead unchanged", () => {
  const result = buildContactVerificationAssessment({
    contact: {
      id: "contact_3",
      contactType: "Lead",
      leadGoal: "To Buy",
      name: "John Buyer",
      firstName: "John",
      qualificationStage: "basic",
      requirementSummary: "Looking for a two-bedroom apartment in Paphos.",
    },
    recentMessages: [{ body: "I want to buy a flat near the sea." }],
  });

  assert.equal(result.status, "verified_lead");
  assert.equal(result.hasChanges, false);
  assert.deepEqual(result.proposedPatch, {});
  assert.equal(result.reasoning, "Contact fields are consistent with a buyer lead.");
  assert.equal(
    result.evidence.find((item) => item.sourceId === "lead_verification")?.quote,
    "Contact type and lead goal are consistent with buyer outreach.",
  );
});

test("verification proposes buy lead goal from strong buying text", () => {
  const result = buildContactVerificationAssessment({
    contact: {
      id: "contact_buy",
      contactType: "Lead",
      leadGoal: null,
      name: "Michael",
      qualificationStage: "unqualified",
      requirementSummary: "Looking to purchase an apartment in Paphos.",
    },
    recentMessages: [{ body: "I want to buy a flat near the sea." }],
  });

  assert.equal(result.status, "verified_lead");
  assert.equal(result.proposedPatch.leadGoal, "To Buy");
  assert.equal(result.hasChanges, true);
  assert.equal(shouldAutoApplyContactVerificationAssessment(result), true);
});

test("verification proposes rent lead goal from strong rental text", () => {
  const result = buildContactVerificationAssessment({
    contact: {
      id: "contact_rent",
      contactType: "Lead",
      leadGoal: null,
      name: "Maria",
      qualificationStage: "unqualified",
      requirementSummary: "Needs a rental apartment in Paphos.",
    },
    recentMessages: [{ body: "I am renting and need something from next month." }],
  });

  assert.equal(result.status, "verified_lead");
  assert.equal(result.proposedPatch.leadGoal, "To Rent");
  assert.equal(result.hasChanges, true);
});

test("verification keeps mixed buy and rent intent in review without a resolver", () => {
  const result = buildContactVerificationAssessment({
    contact: {
      id: "contact_mixed",
      contactType: "Lead",
      leadGoal: null,
      name: "Alex",
      firstName: "Alex",
      qualificationStage: "unqualified",
      requirementSummary: "Asked about buying or renting in Paphos.",
    },
    recentMessages: [{ body: "I might buy, but I am also open to rent." }],
  });

  assert.equal(result.status, "needs_review");
  assert.equal(result.proposedPatch.leadGoal, undefined);
  assert.equal(result.hasChanges, false);
  assert.equal(shouldAutoApplyContactVerificationAssessment(result), false);
});

test("verification resolves mixed buy and rent intent from requirement status", () => {
  const result = buildContactVerificationAssessment({
    contact: {
      id: "contact_mixed_resolved",
      contactType: "Lead",
      leadGoal: null,
      requirementStatus: "For Rent",
      name: "Alex",
      qualificationStage: "unqualified",
      requirementSummary: "Asked about buying or renting in Paphos.",
    },
    recentMessages: [{ body: "I might buy, but I am also open to rent." }],
  });

  assert.equal(result.status, "verified_lead");
  assert.equal(result.proposedPatch.leadGoal, "To Rent");
});

test("verification proposes clean first and last names from canonical display name", () => {
  const result = buildContactVerificationAssessment({
    contact: {
      id: "contact_4",
      contactType: "Lead",
      leadGoal: "To Rent",
      name: "John Smith Lead Rent DT4930",
      qualificationStage: "basic",
    },
    recentMessages: [{ body: "Looking for a rental option near Paphos." }],
  });

  assert.equal(result.status, "verified_lead");
  assert.equal(result.proposedPatch.firstName, "John");
  assert.equal(result.proposedPatch.lastName, "Smith");
  assert.equal(result.hasChanges, true);
  assert.equal(result.reasoning, "Contact fields are consistent with a renter lead.");
  assert.equal(
    result.evidence.find((item) => item.sourceId === "lead_verification")?.quote,
    "Contact type and lead goal are consistent with renter outreach.",
  );
});

test("verification preserves paste lead structured display name while filling person names", () => {
  const result = buildContactVerificationAssessment({
    contact: {
      id: "contact_structured_name",
      contactType: "Lead",
      leadGoal: "To Buy",
      name: "Kristina Grüße Lead Sale DT2937 2Bdr Town House Peyia",
      qualificationStage: "unqualified",
    },
    recentMessages: [{ body: "Interested in buying a 1-bedroom apartment in Kato Paphos or Chloraka." }],
  });

  assert.equal(result.status, "verified_lead");
  assert.equal("name" in result.proposedPatch, false);
  assert.equal(result.proposedPatch.firstName, "Kristina");
  assert.equal(result.proposedPatch.lastName, "Grüße");
});

test("verification sanitizer ignores AI attempt to strip paste lead structured display name", () => {
  const patch = preserveStructuredLeadDisplayNamePatch({
    contact: {
      contactType: "Lead",
      name: "Kristina Grüße Lead Sale DT2937 2Bdr Town House Peyia",
    },
    inferredRole: "Lead",
    patch: {
      name: "Kristina Grüße",
      firstName: "Kristina",
      lastName: "Grüße",
      requirementSummary: "Interested in a 1-bedroom apartment in Kato Paphos.",
    },
  });

  assert.equal("name" in patch, false);
  assert.equal(patch.firstName, "Kristina");
  assert.equal(patch.lastName, "Grüße");
  assert.equal(patch.requirementSummary, "Interested in a 1-bedroom apartment in Kato Paphos.");
});

test("verification does not overwrite clean stored human names", () => {
  const result = buildContactVerificationAssessment({
    contact: {
      id: "contact_5",
      contactType: "Lead",
      leadGoal: "To Buy",
      name: "John Smith Lead Sale DT4930",
      firstName: "Jonathan",
      lastName: "Smith",
      qualificationStage: "basic",
    },
    recentMessages: [{ body: "The buyer asked whether the owner would accept a lower offer." }],
  });

  assert.equal(result.status, "verified_lead");
  assert.deepEqual(result.proposedPatch, {});
});

test("verification does not propose property descriptors as last name", () => {
  const result = buildContactVerificationAssessment({
    contact: {
      id: "contact_6",
      contactType: "Lead",
      leadGoal: "To Buy",
      name: "Silvia Lead Sale DT1367 3Bdr Villa Peyia",
      firstName: "Silvia",
      lastName: null,
      qualificationStage: "unqualified",
    },
    recentMessages: [{ body: "I will check all later. Thanks" }],
  });

  assert.equal(result.status, "verified_lead");
  assert.equal(result.hasChanges, false);
  assert.deepEqual(result.proposedPatch, {});
});

test("verification cleans noisy stored last name", () => {
  const result = buildContactVerificationAssessment({
    contact: {
      id: "contact_7",
      contactType: "Lead",
      leadGoal: "To Buy",
      name: "Maria Papadopoulou Agent",
      firstName: "Maria",
      lastName: "Papadopoulou Agent DT4930",
      qualificationStage: "basic",
    },
    recentMessages: [{ body: "Contact role: agent. Agency name: Example Estates." }],
  });

  assert.equal(result.status, "likely_agent");
  assert.equal(result.proposedPatch.contactType, "Agent");
  assert.equal(result.proposedPatch.lastName, "Papadopoulou");
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

test("verification auto-apply policy keeps low confidence decisions for review", () => {
  assert.equal(shouldAutoApplyContactVerificationAssessment({
    status: "verified_lead",
    confidence: 0.7,
  }), false);
  assert.equal(shouldAutoApplyContactVerificationAssessment({
    status: "likely_agent",
    confidence: 0.9,
  }), true);
});

test("verification auto-apply policy keeps generic lead to contact changes for review", () => {
  assert.equal(shouldAutoApplyContactVerificationAssessment({
    status: "not_a_lead",
    confidence: 1,
    snapshot: { contactType: "Lead" },
    proposedPatch: { contactType: "Contact" },
  }), false);

  assert.equal(shouldAutoApplyContactVerificationAssessment({
    status: "likely_agent",
    confidence: 0.9,
    snapshot: { contactType: "Lead" },
    proposedPatch: { contactType: "Agent" },
  }), true);
});
