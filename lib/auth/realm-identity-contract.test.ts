import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { classifySubstoRoute } from "./host-routing-policy";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");
const schema = read("prisma/schema.prisma");
const userModel = schema.slice(schema.indexOf("model User {"), schema.indexOf("\n}\n", schema.indexOf("model User {")));
const expand = read("prisma/migrations/20261024160000_user_auth_realm_expand/migration.sql");
const contract = read("prisma/contract-migrations/user_auth_realm_contract.sql");

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(path.join(process.cwd(), dir), { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sourceFiles(relative);
    return /\.(ts|tsx|js|mjs)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [relative] : [];
  });
}

test("User has a realm that backfills legacy rows as estio, with realm-scoped uniqueness", () => {
  assert.match(schema, /enum AuthRealm \{\s*estio\s*substo\s*\}/);
  assert.match(userModel, /authRealm\s+AuthRealm @default\(estio\)/);
  assert.match(userModel, /@@unique\(\[authRealm, email\]\)/);
  assert.match(userModel, /@@unique\(\[authRealm, clerkId\]\)/);
  // The clerkId safety argument for raw Business lookups depends on this.
  assert.match(userModel, /clerkId\s+String\?\s+@unique/);
});

test("expand migration is additive and safe for the previous release", () => {
  assert.doesNotMatch(expand, /\bDROP\b|\bRENAME\b|\bUPDATE\b|\bDELETE\b/i);
  assert.match(expand, /ADD COLUMN "authRealm" "AuthRealm" NOT NULL DEFAULT 'estio'/);
  assert.match(expand, /CREATE UNIQUE INDEX "User_authRealm_email_key" ON "User"\("authRealm", "email"\)/);
  assert.match(expand, /CREATE UNIQUE INDEX "User_authRealm_clerkId_key" ON "User"\("authRealm", "clerkId"\)/);
});

test("contract step is staged outside prisma/migrations and only drops global email uniqueness", () => {
  assert.equal(fs.existsSync("prisma/migrations/user_auth_realm_contract.sql"), false);
  const statements = contract.split("\n").filter((line) => line.trim() && !line.trim().startsWith("--")).join("\n");
  assert.equal(statements, 'DROP INDEX IF EXISTS "User_email_key";');
  assert.equal(fs.readdirSync("prisma/migrations").some((name) => /contract/i.test(name)), false);
});

test("no application or script code resolves a User by email without a realm", () => {
  const offenders: string[] = [];
  for (const file of [...sourceFiles("app"), ...sourceFiles("lib"), ...sourceFiles("scripts")]) {
    const source = read(file);
    for (const match of source.matchAll(/\b(?:db|tx|prisma)\.user\.(?:findUnique|findUniqueOrThrow|upsert|update|delete)\(\{\s*where:\s*\{\s*email\b/g)) {
      offenders.push(`${file}:${source.slice(0, match.index).split("\n").length}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("user resolution, impersonation and Studio schedule authority are realm-scoped", () => {
  const syncUser = read("lib/auth/sync-user.ts");
  assert.match(syncUser, /ensureRealmUser\(store, realm \?\? await getRequestAuthRealm\(\)/);
  assert.doesNotMatch(syncUser, /where: \{ (?:email|clerkId)/);
  const impersonation = read("lib/auth/impersonation.ts");
  assert.match(impersonation, /where: realmClerkIdWhere\(realm, authState\.userId\)/);
  assert.match(impersonation, /target\.authRealm !== realm/);
  assert.match(impersonation, /audit\.actor\.authRealm !== audit\.target\.authRealm/);
  assert.match(read("lib/auth/permissions.ts"), /where: businessClerkIdWhere\(userId\)/);
  assert.match(read("lib/auth/current-user.ts"), /where: businessClerkIdWhere\(clerkUserId\)/);
  assert.match(read("lib/studio/schedule-authority.ts"), /authRealm_clerkId: \{ authRealm: "estio", clerkId: userId \}/);
  const team = read("app/(main)/admin/team/actions.ts");
  assert.match(team, /findUnique\(\{ where: realmEmailWhere\(realm, normalizedEmail\) \}\)/);
  assert.match(team, /where: \{ authRealm: realm, email: \{ equals: targetEmail/);
});

test("Business Clerk webhooks verify and act per realm", () => {
  const route = read("app/api/webhooks/clerk/route.ts");
  assert.match(route, /await verifyClerkBusinessWebhook\(req\)/);
  assert.doesNotMatch(route, /process\.env\.CLERK_WEBHOOK_SECRET|new Webhook\(/);
  assert.match(route, /claimInvitedRealmUser\(invitedUserStore, realm,/);
  assert.match(route, /if \(!realmAcceptsTeamInvites\(realm\)\)/);
  assert.match(route, /if \(!realmHandlesTenantContacts\(realm\)\)/);
  assert.match(route, /verifiedPhone && realmHandlesTenantContacts\(realm\)/);
  const mail = read("app/api/webhooks/clerk-mail/route.ts");
  assert.match(mail, /!== 'estio'\) \{\s*return new Response\('Not found', \{ status: 404 \}\)/);
  assert.match(mail, /where: realmEmailWhere\('estio', toEmail\)/);
});

test("Business routes and Business webhooks stay closed on the Substo host (slice 3 opens /admin)", () => {
  for (const pathname of ["/admin", "/admin/contacts", "/api/webhooks/clerk", "/api/webhooks/clerk-mail", "/sso/validate", "/api/oauth/callback", "/select-location"]) {
    assert.equal(classifySubstoRoute(pathname), "blocked", pathname);
  }
});
