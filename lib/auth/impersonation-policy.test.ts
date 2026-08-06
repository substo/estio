import assert from "node:assert/strict";
import test from "node:test";
import { extractImpersonationClaim, identitiesAgree } from "./impersonation-policy";

test("actor claim requires actor, audit, and location identifiers", () => {
  assert.deepEqual(extractImpersonationClaim({ sub: "actor", auditId: "audit", locationId: "location" }), {
    actorClerkId: "actor", auditId: "audit", locationId: "location",
  });
  assert.deepEqual(extractImpersonationClaim({ sub: "actor", additionalProperties: { auditId: "audit", locationId: "location" } }), {
    actorClerkId: "actor", auditId: "audit", locationId: "location",
  });
  assert.equal(extractImpersonationClaim({ sub: "actor", auditId: "audit" }), null);
});

test("identity agreement needs immutable Clerk ID and normalized email equality", () => {
  assert.equal(identitiesAgree({ authenticatedClerkId: "user_1", localClerkId: "user_1", localEmail: " A@Example.com ", clerkEmail: "a@example.com" }), true);
  assert.equal(identitiesAgree({ authenticatedClerkId: "user_1", localClerkId: "user_2", localEmail: "a@example.com", clerkEmail: "a@example.com" }), false);
  assert.equal(identitiesAgree({ authenticatedClerkId: "user_1", localClerkId: "user_1", localEmail: "a@example.com", clerkEmail: "b@example.com" }), false);
});
