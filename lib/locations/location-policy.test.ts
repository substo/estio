import assert from "node:assert/strict";
import test from "node:test";
import {
  checkTeamChange,
  defaultLocationName,
  normalizeLocationName,
  normalizeInviteEmail,
  primaryVerifiedEmail,
  verifiedEmails,
} from "./location-policy";

test("default and edited brand names", () => {
  assert.equal(defaultLocationName({ firstName: " Ada ", email: "ada@example.com" }), "Ada's brand");
  assert.equal(defaultLocationName({ firstName: null, email: "studio.team@example.com" }), "studio.team's brand");
  assert.equal(defaultLocationName({}), "My brand");
  assert.equal(normalizeLocationName("  My   channel "), "My channel");
  assert.equal(normalizeLocationName(""), null);
  assert.equal(normalizeLocationName("x".repeat(101)), null);
  assert.equal(normalizeLocationName(42), null);
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

test("team changes need an admin and never remove the last admin", () => {
  assert.equal(checkTeamChange({ actorRole: "MEMBER", targetCurrentRole: "MEMBER", change: { kind: "remove" }, adminCount: 2 }).ok, false);
  assert.equal(checkTeamChange({ actorRole: "ADMIN", targetCurrentRole: "ADMIN", change: { kind: "remove" }, adminCount: 1 }).ok, false);
  assert.equal(checkTeamChange({ actorRole: "ADMIN", targetCurrentRole: "ADMIN", change: { kind: "role", role: "MEMBER" }, adminCount: 1 }).ok, false);
  assert.equal(checkTeamChange({ actorRole: "ADMIN", targetCurrentRole: "ADMIN", change: { kind: "role", role: "MEMBER" }, adminCount: 2 }).ok, true);
  assert.equal(checkTeamChange({ actorRole: "ADMIN", targetCurrentRole: "MEMBER", change: { kind: "remove" }, adminCount: 1 }).ok, true);
});
