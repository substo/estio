import assert from "node:assert/strict";
import test from "node:test";
import { extractImpersonationClaim, identitiesAgree, isRestrictedImpersonationRequest, normalizeSupportReason } from "./impersonation-policy";

test("support reasons are mandatory and bounded", () => {
  assert.equal(normalizeSupportReason(" too short "), null);
  assert.equal(normalizeSupportReason("  Investigate   listing sync failure  "), "Investigate listing sync failure");
  assert.equal(normalizeSupportReason("x".repeat(501)), null);
});

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

test("impersonated sessions are read-only and cannot open sensitive settings", () => {
  assert.equal(isRestrictedImpersonationRequest("/admin/contacts", "GET"), false);
  assert.equal(isRestrictedImpersonationRequest("/admin/contacts", "POST"), true);
  assert.equal(isRestrictedImpersonationRequest("/api/contacts/123", "DELETE"), true);
  assert.equal(isRestrictedImpersonationRequest("/admin/team", "GET"), true);
  assert.equal(isRestrictedImpersonationRequest("/api/google/auth", "GET"), true);
  assert.equal(isRestrictedImpersonationRequest("/api/platform/impersonation/end", "POST"), false);
});
