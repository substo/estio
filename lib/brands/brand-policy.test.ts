import assert from "node:assert/strict";
import test from "node:test";
import {
  brandRoleForLegacyStudioRole,
  checkTeamChange,
  defaultBrandName,
  normalizeBrandName,
  normalizeInviteEmail,
  primaryVerifiedEmail,
  studioRoleForBrandRole,
  verifiedEmails,
} from "./brand-policy";

test("default and edited brand names", () => {
  assert.equal(defaultBrandName({ firstName: " Ada ", email: "ada@example.com" }), "Ada's brand");
  assert.equal(defaultBrandName({ firstName: null, email: "studio.team@example.com" }), "studio.team's brand");
  assert.equal(defaultBrandName({}), "My brand");
  assert.equal(normalizeBrandName("  My   channel "), "My channel");
  assert.equal(normalizeBrandName(""), null);
  assert.equal(normalizeBrandName("x".repeat(101)), null);
  assert.equal(normalizeBrandName(42), null);
});

test("invitation emails are normalized and validated", () => {
  assert.equal(normalizeInviteEmail("  Ada@Example.COM "), "ada@example.com");
  assert.equal(normalizeInviteEmail("not-an-email"), null);
  assert.equal(normalizeInviteEmail(null), null);
});

test("only verified emails count, primary first", () => {
  const user = {
    primaryEmailAddressId: "b",
    emailAddresses: [
      { id: "a", emailAddress: "Old@Example.com", verification: { status: "verified" } },
      { id: "b", emailAddress: "new@example.com", verification: { status: "unverified" } },
    ],
  };
  assert.deepEqual(verifiedEmails(user), ["old@example.com"]);
  assert.equal(primaryVerifiedEmail(user), "old@example.com");
  assert.equal(primaryVerifiedEmail({ primaryEmailAddressId: "a", emailAddresses: [{ id: "a", emailAddress: "x@example.com", verification: null }] }), null);
});

test("Studio roles mirror brand roles", () => {
  assert.equal(studioRoleForBrandRole("ADMIN", null), "admin");
  assert.equal(studioRoleForBrandRole("ADMIN", "owner"), "owner");
  assert.equal(studioRoleForBrandRole("MEMBER", "owner"), "member");
  assert.equal(brandRoleForLegacyStudioRole("owner"), "ADMIN");
  assert.equal(brandRoleForLegacyStudioRole("admin"), "ADMIN");
  assert.equal(brandRoleForLegacyStudioRole("member"), "MEMBER");
});

test("team changes need an admin and never remove the last admin", () => {
  assert.equal(checkTeamChange({ actorRole: "MEMBER", targetCurrentRole: "MEMBER", change: { kind: "remove" }, adminCount: 2 }).ok, false);
  assert.equal(checkTeamChange({ actorRole: "ADMIN", targetCurrentRole: "ADMIN", change: { kind: "remove" }, adminCount: 1 }).ok, false);
  assert.equal(checkTeamChange({ actorRole: "ADMIN", targetCurrentRole: "ADMIN", change: { kind: "role", role: "MEMBER" }, adminCount: 1 }).ok, false);
  assert.equal(checkTeamChange({ actorRole: "ADMIN", targetCurrentRole: "ADMIN", change: { kind: "role", role: "MEMBER" }, adminCount: 2 }).ok, true);
  assert.equal(checkTeamChange({ actorRole: "ADMIN", targetCurrentRole: "MEMBER", change: { kind: "remove" }, adminCount: 1 }).ok, true);
});
