import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");
const resolver = read("lib/auth/active-location.ts");
const layout = read("app/(main)/admin/layout.tsx");
const topNav = read("app/(main)/admin/_components/dashbord-top-nav.tsx");
const adminNavigation = read("app/(main)/admin/_components/admin-navigation.tsx");
const switcher = read("app/(main)/admin/_components/active-location-switcher.tsx");
const platformAccess = read("lib/auth/platform-access.ts");
const platformPage = read("app/(main)/platform/page.tsx");
const platformLocationOptions = read("lib/auth/platform-location-options.ts");
const platformLocationSwitcher = read("app/(main)/admin/_components/platform-location-login-switcher.tsx");
const dashboardEntry = read("app/(main)/dashboard/page.tsx");
const publicNavbar = read("components/wrapper/navbar.tsx");
const platformBootstrapScript = read("scripts/grant-platform-admin.ts");
const platformMasterProvisioner = read("scripts/provision-platform-master-location.ts");
const activeLocationRoute = read("app/api/active-location/route.ts");

test("resolver uses immutable Clerk mapping and local connection-role intersection", () => {
  assert.match(resolver, /where: \{ clerkId: clerkUserId \}/);
  assert.match(resolver, /intersectAuthorizedLocations/);
  assert.doesNotMatch(resolver, /publicMetadata|crm_location_id|searchParams|localStorage/);
  assert.match(resolver, /httpOnly: true/);
  assert.match(resolver, /sameSite: "lax"/);
  assert.match(resolver, /path: "\/"/);
  assert.match(resolver, /isPlatformMaster: true/);
  assert.match(resolver, /scopeDirectLocationsForSession/);
});

test("admin layout blocks multi-location tenant rendering until selection", () => {
  assert.match(layout, /status === "selection_required"\) redirect\("\/select-location"\)/);
  assert.doesNotMatch(layout, /take:\s*1|locations\[0\]/);
});

test("one-location header renders no label or disabled selector and multi-location switcher is accessible", () => {
  assert.doesNotMatch(topNav, /Current location/);
  assert.match(topNav, /availableLocations\.length > 1/);
  assert.match(switcher, /aria-label="Switch location"/);
  assert.match(switcher, /DropdownMenuRadioGroup/);
  assert.match(switcher, /role="alert" aria-live="assertive"/);
  assert.match(switcher, /window\.location\.reload\(\)/);
});

test("platform access is role-based, tenant-independent, and offers location-user master login", () => {
  assert.match(platformAccess, /where: \{ clerkId: userId \}/);
  assert.match(platformAccess, /platformRole !== "PLATFORM_ADMIN"/);
  assert.doesNotMatch(platformAccess, /email|locations|cookie|metadata/);
  assert.match(platformAccess, /!userId \|\| actor/);
  assert.match(layout, /getPlatformAdminContext/);
  assert.match(layout, /listPlatformLocationLoginOptions/);
  assert.match(layout, /AdminShellLayout/);
  assert.doesNotMatch(layout, /MasterLoginPage/);
  assert.match(platformLocationOptions, /user\.locations\.some/);
  assert.match(platformLocationOptions, /canImpersonate: membership\.user\.id !== platformAdminUserId/);
  assert.match(platformLocationSwitcher, /aria-label="Choose location"/);
  assert.match(platformLocationSwitcher, /aria-label="Choose user"/);
  assert.match(platformLocationSwitcher, /DropdownMenuRadioGroup/);
  assert.match(platformLocationSwitcher, /Log in/);
  assert.match(platformLocationSwitcher, /!selectedLocation\.isPlatformMaster/);
  assert.doesNotMatch(platformLocationOptions, /conversation|message|contact|credential|apiKey|ipAddress/);
  assert.match(platformPage, /Platform overview/);
  assert.match(platformPage, /db\.location\.findMany/);
  assert.match(platformPage, /db\.userLocationRole\.count/);
  assert.match(platformPage, /db\.locationSessionActivity\.groupBy/);
  assert.match(adminNavigation, /showPlatformAdministration/);
  assert.match(adminNavigation, /href: "\/platform"/);
  assert.match(layout, /showPlatformAdministration=\{Boolean\(platformAdmin\)\}/);
});

test("active-location writes accept the public origin behind the reverse proxy", () => {
  assert.match(activeLocationRoute, /isAllowedRequestOrigin/);
  assert.match(activeLocationRoute, /x-forwarded-host/);
  assert.match(activeLocationRoute, /x-forwarded-proto/);
  assert.doesNotMatch(activeLocationRoute, /origin !== request\.nextUrl\.origin/);
});

test("public dashboard entry sends every authenticated user to admin", () => {
  assert.match(dashboardEntry, /redirect\("\/admin"\)/);
  assert.doesNotMatch(dashboardEntry, /email|publicMetadata|cookie/);
  assert.doesNotMatch(publicNavbar, /href="\/admin"/);
  assert.match(publicNavbar, /href="\/dashboard"/);
});

test("platform bootstrap apply is pinned to an explicit Clerk environment and reviewed identity", () => {
  assert.doesNotMatch(platformBootstrapScript, /from "dotenv"/);
  assert.match(platformBootstrapScript, /loadEnvFile/);
  assert.match(platformBootstrapScript, /--apply requires an explicit --env-file/);
  assert.match(platformBootstrapScript, /--expected-clerk-id/);
  assert.match(platformBootstrapScript, /clerkKeyFingerprint/);
  assert.match(platformMasterProvisioner, /--apply requires an explicit --env-file/);
  assert.match(platformMasterProvisioner, /isPlatformMaster: true/);
  assert.match(platformMasterProvisioner, /role: "ADMIN"/);
  assert.match(platformMasterProvisioner, /contactAccessScope: "LOCATION_WIDE"/);
  assert.match(platformMasterProvisioner, /siteConfig\.upsert/);
});
