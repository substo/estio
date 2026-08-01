import assert from "node:assert/strict";
import test from "node:test";
import {
  createOffboardingConfirmationToken,
  createOffboardingPreviewFingerprint,
  requiredOffboardingPhrase,
  verifyOffboardingConfirmationToken,
} from "./offboarding-confirmation";

const priorSecret = process.env.OFFBOARDING_CONFIRMATION_SECRET;
test.after(() => {
  if (priorSecret === undefined) delete process.env.OFFBOARDING_CONFIRMATION_SECRET;
  else process.env.OFFBOARDING_CONFIRMATION_SECRET = priorSecret;
});

const payload = {
  confirmationId: "confirmation_a",
  actorUserId: "actor_a",
  locationId: "location_a",
  sourceUserId: "source_a",
  successorUserId: "successor_a",
  sourceClerkId: "clerk_source",
  successorClerkId: "clerk_successor",
  sourceEmail: "source@example.com",
  successorEmail: "successor@example.com",
  mode: "TRANSFER" as const,
  suspendClerkGlobally: false,
  previewFingerprint: "fingerprint_a",
  responsibilityCutoff: new Date(1_000_000).toISOString(),
  issuedAt: 1_000_000,
};

test("confirmation tokens are signed, actor-bound, and short-lived", () => {
  process.env.OFFBOARDING_CONFIRMATION_SECRET = "0123456789abcdef0123456789abcdef";
  const token = createOffboardingConfirmationToken(payload);
  assert.ok(token);
  assert.deepEqual(verifyOffboardingConfirmationToken(token, payload.issuedAt + 1_000), payload);
  assert.throws(() => verifyOffboardingConfirmationToken(`${token}x`, payload.issuedAt + 1_000), /Invalid/);
  assert.throws(() => verifyOffboardingConfirmationToken(token, payload.issuedAt + 16 * 60 * 1_000), /expired/);
});

test("execution remains disabled without a dedicated secret and phrase is exact", () => {
  delete process.env.OFFBOARDING_CONFIRMATION_SECRET;
  assert.equal(createOffboardingConfirmationToken(payload), null);
  assert.equal(requiredOffboardingPhrase("TRANSFER", " Source@Example.com "), "TRANSFER AND REMOVE ACCESS source@example.com");
  assert.equal(requiredOffboardingPhrase("KEEP_ASSIGNED", " Source@Example.com "), "KEEP ASSIGNED AND REMOVE ACCESS source@example.com");
});

test("signed intent binds mode, global retirement choice, and deterministic preview fingerprint", () => {
  process.env.OFFBOARDING_CONFIRMATION_SECRET = "0123456789abcdef0123456789abcdef";
  const counts = {
    assignedContacts: 1, inheritedConversations: 2, activeAssignedDeals: 3, activeUnassignedDeals: 4,
    openTasks: 5, nonTerminalViewingSessions: 6, futureActionableViewings: 7,
  };
  const fingerprint = createOffboardingPreviewFingerprint({
    locationId: "location_a", sourceUserId: "source_a", successorUserId: null,
    mode: "KEEP_ASSIGNED", suspendClerkGlobally: true, counts,
  });
  const changed = createOffboardingPreviewFingerprint({
    locationId: "location_a", sourceUserId: "source_a", successorUserId: null,
    mode: "KEEP_ASSIGNED", suspendClerkGlobally: true, counts: { ...counts, openTasks: 6 },
  });
  assert.notEqual(fingerprint, changed);
  const keepPayload = {
    ...payload,
    successorUserId: null,
    successorClerkId: null,
    successorEmail: null,
    mode: "KEEP_ASSIGNED" as const,
    suspendClerkGlobally: true,
    previewFingerprint: fingerprint,
  };
  const token = createOffboardingConfirmationToken(keepPayload);
  assert.ok(token);
  assert.deepEqual(verifyOffboardingConfirmationToken(token!, keepPayload.issuedAt + 1), keepPayload);
});
