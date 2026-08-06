import assert from "node:assert/strict";
import test from "node:test";
import { resolvePlatformAdminBootstrap } from "./platform-bootstrap-policy";

const local = { id: "internal-1", clerkId: "clerk-1", email: "martin@substo.com", platformRole: "STANDARD" as const };
const clerk = { id: "clerk-1", emails: ["Martin@Substo.com"] };

test("bootstrap normalizes email, requires exact identity agreement, and is idempotent", () => {
  const result = resolvePlatformAdminBootstrap({ email: " MARTIN@SUBSTO.COM ", localMatches: [local], clerkMatches: [clerk] });
  assert.equal(result.email, "martin@substo.com");
  assert.equal(result.alreadyGranted, false);
  assert.equal(resolvePlatformAdminBootstrap({ ...{ email: local.email }, localMatches: [{ ...local, platformRole: "PLATFORM_ADMIN" }], clerkMatches: [clerk] }).alreadyGranted, true);
});

test("bootstrap rejects missing, duplicate, and mismatched identities", () => {
  assert.throws(() => resolvePlatformAdminBootstrap({ email: local.email, localMatches: [], clerkMatches: [clerk] }), /exactly one local/);
  assert.throws(() => resolvePlatformAdminBootstrap({ email: local.email, localMatches: [local], clerkMatches: [clerk, { ...clerk, id: "clerk-2" }] }), /exactly one Clerk/);
  assert.throws(() => resolvePlatformAdminBootstrap({ email: local.email, localMatches: [local], clerkMatches: [{ ...clerk, id: "wrong" }] }), /does not match/);
});
