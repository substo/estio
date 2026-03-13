import test from "node:test";
import assert from "node:assert/strict";
import {
  AiSkillPolicySchema,
  SkillDecisionPolicySchema,
  buildDefaultSkillPolicy,
  parsePolicyJson,
} from "./config.ts";

test("AiSkillPolicySchema parses baseline policy payload", () => {
  const parsed = AiSkillPolicySchema.safeParse({
    locationId: "loc_1",
    skillId: "lead_qualification",
    objective: "nurture",
    enabled: true,
  });

  assert.equal(parsed.success, true);
  assert.equal(parsed.data.humanApprovalRequired, true);
  assert.equal(parsed.data.decisionPolicy.aggressiveness, "balanced");
  assert.equal(parsed.data.compliancePolicy.globalBaseline, "us_eu_safe");
});

test("AiSkillPolicySchema rejects out-of-range decision thresholds", () => {
  const parsed = AiSkillPolicySchema.safeParse({
    locationId: "loc_1",
    skillId: "lead_qualification",
    objective: "nurture",
    decisionPolicy: {
      minScoreThreshold: 1.5,
    },
  });

  assert.equal(parsed.success, false);
});

test("buildDefaultSkillPolicy seeds human-approval-safe defaults", () => {
  const policy = buildDefaultSkillPolicy("loc_1", "viewing_management", "book_viewing");
  assert.equal(policy.locationId, "loc_1");
  assert.equal(policy.skillId, "viewing_management");
  assert.equal(policy.humanApprovalRequired, true);
  assert.equal(policy.objective, "book_viewing");
  assert.equal(policy.compliancePolicy.requireConsent, true);
});

test("parsePolicyJson falls back to schema defaults on invalid input", () => {
  const fallback = SkillDecisionPolicySchema.parse({});
  const parsed = parsePolicyJson("invalid", SkillDecisionPolicySchema, fallback);
  assert.deepEqual(parsed, fallback);
});

