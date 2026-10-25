import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { classifySubstoRoute } from "./host-routing-policy";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");
const schema = read("prisma/schema.prisma");
const userModel = schema.slice(schema.indexOf("model User {"), schema.indexOf("\n}\n", schema.indexOf("model User {")));
const expand = read("prisma/migrations/20261024160000_user_auth_realm_expand/migration.sql");
const contract = read("prisma/migrations/20261024180000_user_auth_realm_contract/migration.sql");
const brands = read("prisma/migrations/20261024170000_substo_brands/migration.sql");

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
  // Email is unique per realm only; the same email in the other app is another person.
  assert.match(userModel, /\n\s+email\s+String\n/);
});

test("expand migration is additive and safe for the previous release", () => {
  assert.doesNotMatch(expand, /\bDROP\b|\bRENAME\b|\bUPDATE\b|\bDELETE\b/i);
  assert.match(expand, /ADD COLUMN "authRealm" "AuthRealm" NOT NULL DEFAULT 'estio'/);
  assert.match(expand, /CREATE UNIQUE INDEX "User_authRealm_email_key" ON "User"\("authRealm", "email"\)/);
  assert.match(expand, /CREATE UNIQUE INDEX "User_authRealm_clerkId_key" ON "User"\("authRealm", "clerkId"\)/);
});

test("contract step only drops global email uniqueness, and never in the deploy that applied expand", () => {
  const migrations = fs.readdirSync("prisma/migrations").filter((name) => /user_auth_realm|substo_brands/.test(name)).sort();
  assert.deepEqual(migrations, ["20261024160000_user_auth_realm_expand", "20261024170000_substo_brands", "20261024180000_user_auth_realm_contract"]);
  assert.match(contract, /migration_name = '20261024160000_user_auth_realm_expand'/);
  assert.match(contract, /v_expand_finished > now\(\) - interval '10 minutes'/);
  assert.match(contract, /DROP INDEX IF EXISTS "User_email_key";/);
  assert.doesNotMatch(contract.replace(/--.*$/gm, ""), /User_clerkId_key|DROP TABLE|DROP COLUMN|ALTER TABLE/);
});

test("brands migration is additive and enforces one app per membership", () => {
  assert.doesNotMatch(brands, /DROP (TABLE|COLUMN|INDEX)|RENAME|\bDELETE FROM\b/i);
  assert.match(brands, /ADD COLUMN\s+"authRealm" "AuthRealm" NOT NULL DEFAULT 'estio'/);
  for (const trigger of ["UserLocationRole_same_auth_realm", "_LocationToUser_same_auth_realm", "BrandInvitation_same_auth_realm", "User_auth_realm_immutable", "Location_auth_realm_immutable"]) {
    assert.match(brands, new RegExp(`CREATE TRIGGER "${trigger}"`));
  }
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

test("Property routes and Business webhooks stay closed on the Substo host", () => {
  for (const pathname of ["/admin/properties", "/admin/prospecting", "/api/webhooks/clerk", "/api/webhooks/clerk-mail", "/sso/validate", "/api/oauth/callback"]) {
    assert.equal(classifySubstoRoute(pathname), "blocked", pathname);
  }
});

test("Substo brand pages are allowed and protected; lookalike paths stay blocked", () => {
  assert.equal(classifySubstoRoute("/brand/team"), "brand");
  assert.equal(classifySubstoRoute("/brand/settings"), "brand");
  assert.equal(classifySubstoRoute("/brand-x"), "blocked");
  assert.match(read("middleware.ts"), /routeKind === "studio" \|\| routeKind === "brand" \|\| routeKind === "profile" \|\| routeKind === "crm"\) await auth\.protect\(\)/);
  assert.match(read("app/(main)/brand/layout.tsx"), /!== "substo"\) notFound\(\)/);
  assert.match(read("app/(main)/admin/layout.tsx"), /prepareCurrentSubstoUser\(\)/);
});

test("Substo Studio access comes from the brand team, never from Studio membership alone", () => {
  const access = read("lib/studio/access.ts");
  assert.match(access, /resolveBrandWorkspaceAccess\(substoBrandDeps\(\), workspaceId, state\.userId\)/);
  const service = read("lib/studio/supabase-service.ts");
  assert.doesNotMatch(service, /getSubstoStudioWorkspaceForUser|createSubstoStudioInvitation|acceptSubstoStudioInvitation/);
  const actions = read("app/(main)/studio/actions.ts");
  assert.doesNotMatch(actions, /Invite|invitation/i);
  assert.match(actions, /substoStudioDestination\(brandId\)/);
  assert.match(read("lib/auth/product-navigation.ts"), /validateActiveLocationSelection\(brandId\)/);
  assert.doesNotMatch(read("app/(main)/studio/invite/[token]/page.tsx"), /accept|getSubstoStudioInvitation/i);
  assert.equal(fs.existsSync("app/(main)/studio/_components/studio-invite-form.tsx"), false);
});

test("Substo invitations use Substo's own Clerk application, and Estio platform tools see Estio brands only", () => {
  const substo = read("lib/brands/substo-brands.ts");
  assert.match(substo, /getClerkBrandKeys\("substo"\)/);
  assert.match(substo, /createClerkClient\(\{ secretKey: keys\.secretKey/);
  const options = read("lib/auth/platform-location-options.ts");
  assert.match(options, /where: \{ authRealm: "estio" \}/);
  assert.match(options, /authRealm: "estio",\s*clerkId: \{ not: null \}/);
});

test("Studio and brand pages share the CRM sidebar shell in both apps", () => {
  assert.match(read("app/(main)/studio/layout.tsx"), /<StudioShell \{\.\.\.shell\}>/);
  assert.match(read("app/(main)/brand/layout.tsx"), /<StudioShell \{\.\.\.shell\}>/);
  const shell = read("app/(main)/studio/_components/studio-shell.tsx");
  assert.match(shell, /<DashboardSideBar/);
  assert.match(shell, /useSidebarCollapsed\(\)/);
  assert.match(shell, /<AdminNavigationGroups collapsed=\{collapsed\} groups=\{groups\} \/>/);
  assert.equal(fs.existsSync("app/(main)/studio/_components/studio-header.tsx"), false);
});
