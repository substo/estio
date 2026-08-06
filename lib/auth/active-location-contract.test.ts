import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");
const resolver = read("lib/auth/active-location.ts");
const layout = read("app/(main)/admin/layout.tsx");
const topNav = read("app/(main)/admin/_components/dashbord-top-nav.tsx");
const switcher = read("app/(main)/admin/_components/active-location-switcher.tsx");
const platformAccess = read("lib/auth/platform-access.ts");
const platformPage = read("app/(main)/platform/page.tsx");
const dashboardEntry = read("app/(main)/dashboard/page.tsx");
const publicNavbar = read("components/wrapper/navbar.tsx");

test("resolver uses immutable Clerk mapping and local connection-role intersection", () => {
  assert.match(resolver, /where: \{ clerkId: clerkUserId \}/);
  assert.match(resolver, /intersectAuthorizedLocations/);
  assert.doesNotMatch(resolver, /publicMetadata|crm_location_id|searchParams|localStorage/);
  assert.match(resolver, /httpOnly: true/);
  assert.match(resolver, /sameSite: "lax"/);
  assert.match(resolver, /path: "\/"/);
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

test("platform access is role-based, tenant-independent, and exposes only aggregate location data", () => {
  assert.match(platformAccess, /where: \{ clerkId: userId \}/);
  assert.match(platformAccess, /platformRole !== "PLATFORM_ADMIN"/);
  assert.doesNotMatch(platformAccess, /email|locations|cookie|metadata/);
  assert.match(platformPage, /Active members/);
  assert.match(platformPage, /Most recent activity/);
  assert.doesNotMatch(platformPage, /conversation|message|contact|credential|apiKey|ipAddress/);
});

test("public dashboard entry sends platform administrators to the platform console", () => {
  assert.match(dashboardEntry, /getPlatformAdminContext/);
  assert.match(dashboardEntry, /\? "\/platform" : "\/admin"/);
  assert.doesNotMatch(dashboardEntry, /email|publicMetadata|cookie/);
  assert.doesNotMatch(publicNavbar, /href="\/admin"/);
  assert.match(publicNavbar, /href="\/dashboard"/);
});
