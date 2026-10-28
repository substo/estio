import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { NextRequest, NextResponse } from "next/server";

// Per-request React.cache is a pass-through outside a server render.
const passthroughReact = { cache: <T>(fn: T) => fn };

function load(file: string, deps: Record<string, any>) {
  const module = { exports: {} as any };
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require: (name: string) => { if (name === "react" && !(name in deps)) return passthroughReact; assert.ok(name in deps, `Unexpected dependency: ${name}`); return deps[name]; }, URL });
  return module.exports;
}
const locationId = "11111111-1111-4111-8111-111111111111";
function context(options: { realm?: string; denied?: boolean; deleted?: boolean; unmapped?: boolean } = {}) {
  const selected: string[] = [];
  const realm = options.realm ?? "substo";
  const authorized = { status: "authorized", location: { id: "tenant-b", name: "Canonical name", authRealm: realm, studioWorkspaceId: locationId }, availableLocations: [{ id: "tenant-b", name: "Canonical name" }] };
  const workspace = { id: locationId, name: "Stale workspace name", estio_location_id: "tenant-b" };
  const api = load("lib/auth/tenant-context.ts", {
    "server-only": {}, "@/lib/db": { default: { location: { findFirst: async (args: any) => { assert.equal(args.where.authRealm, realm); assert.equal(args.where.studioWorkspaceId, locationId); return options.unmapped ? null : { id: "tenant-b" }; } } } },
    "@clerk/nextjs/server": { auth: async () => ({ userId: "person" }) }, "./request-realm": { getRequestAuthRealm: async () => realm },
    "./active-location": { resolveActiveLocation: async () => ({ status: "authorized", location: { id: "cookie-a" } }), validateActiveLocationSelection: async (id: string) => { selected.push(id); return options.denied ? { status: "no_access", location: null } : authorized; } },
    "@/lib/studio/supabase-service": { getEstioStudioWorkspace: async () => workspace, getEstioStudioWorkspaceById: async () => workspace, getSubstoStudioWorkspace: async () => workspace },
    "@/lib/platform/profile-lifecycle": { isPlatformProfileDeleted: async () => Boolean(options.deleted) }, "@/lib/studio/rest": { studioRest: () => { throw new Error("No writes permitted"); } },
  });
  return { api, selected };
}
test("explicit workspace wins over cookie context in each realm without provisioning", async () => {
  for (const realm of ["estio", "substo"]) {
    const { api, selected } = context({ realm }); const value = await api.resolveTenantContext({ locationId });
    assert.equal(value.resolution.location.id, "tenant-b"); assert.equal(value.locationId, locationId); assert.deepEqual(selected, ["tenant-b"]);
  }
});
test("foreign/revoked, deleted profile, unmapped and malformed workspaces fail closed", async () => {
  for (const options of [{ denied: true }, { deleted: true }, { unmapped: true }, { realm: "unknown" }]) {
    assert.equal(await context(options).api.resolveTenantContext({ locationId }), null);
  }
  assert.equal(await context().api.resolveWorkspaceTenant("not-a-uuid"), null);
});
test("explicit denied Location never falls back to the cookie", async () => {
  assert.equal(await context({ denied: true }).api.resolveTenantContext({ locationId: "foreign" }), null);
});
test("the retired workspace preference protocol cannot change selection", async () => {
  const api = load("app/api/studio/tenant-selection/route.ts", { "next/server": { NextResponse } });
  const response = await api.POST();
  assert.equal(response.status, 409); assert.equal(response.cookies.get("active_location_id"), undefined);
});

test("native tenant switches reauthorize before provisioning or changing the cookie", async () => {
  for (const allowed of [true, false]) {
    const checks: string[] = [];
    const api = load("app/api/studio/tenant-switch/route.ts", {
      "next/server": { NextResponse }, "@/lib/auth/host-brand": { getHostOrigin: () => "https://substo.com" },
      "@/lib/auth/product-navigation": { studioDestination: async (id: string) => { checks.push(id); return allowed ? { locationId: id, path: `/studio` } : null; } },
      "@/lib/auth/active-location": { ACTIVE_LOCATION_COOKIE: "active_location_id", ACTIVE_LOCATION_COOKIE_OPTIONS: { httpOnly: true, path: "/", sameSite: "lax" }, validateActiveLocationSelection: async (id: string) => { checks.push(id); return allowed ? { status: "authorized", location: { id } } : { status: "no_access" }; } },
    });
    for (const product of ["studio", "crm", "team"]) {
      const body = new FormData(); body.set("product", product); body.set("locationId", "tenant-b");
      const response = await api.POST(new NextRequest("https://substo.com/api/studio/tenant-switch", { method: "POST", headers: { host: "substo.com", origin: "https://substo.com" }, body }));
      assert.equal(response.status, 303); assert.equal(response.cookies.get("active_location_id")?.value, allowed ? "tenant-b" : undefined);
      assert.equal(new URL(response.headers.get("location")!).pathname, allowed ? product === "studio" ? `/studio` : product === "team" ? "/admin/team" : "/admin" : "/studio/select");
    }
    assert.deepEqual(checks, Array(3).fill("tenant-b"));
    const foreignBody = new FormData(); foreignBody.set("product", "studio"); foreignBody.set("locationId", "foreign");
    const foreign = await api.POST(new NextRequest("https://substo.com/api/studio/tenant-switch", { method: "POST", headers: { host: "substo.com", origin: "https://estio.co" }, body: foreignBody }));
    assert.equal(foreign.status, 403); assert.equal(checks.length, 3);
  }
});

test("Studio shell loads the same platform location choices as CRM without replacing route context", async () => {
  for (const platform of [true, false]) {
    for (const role of ["ADMIN", "MEMBER"]) {
      let optionsCalls = 0;
      const available = [{ id: "tenant-b", name: "Canonical", role, isPlatformMaster: false, contactAccessScope: "ALL" }];
      const choices = [{ id: "master", name: "Master" }, { id: "support-target", name: "Support" }];
      const shellData = load("components/app-shell/app-shell-data.ts", {
        "server-only": {},
        "@/lib/db": { default: { siteConfig: { findUnique: async (args: any) => { assert.equal(args.where.locationId, "tenant-b"); return { theme: { logo: { url: "/logo.png", lightUrl: "/logo-light.png" } } }; } } } },
        "@/lib/ai/usage-summary-scope": { canAccessAiUsageView: (scope: string, isAdmin: boolean) => scope === "user" || isAdmin },
        "@/lib/auth/platform-access": { getPlatformAdminContext: async () => platform ? { internalUserId: "platform-actor" } : null },
        "@/lib/auth/platform-location-options": { listPlatformLocationLoginOptions: async (id: string) => { assert.equal(id, "platform-actor"); optionsCalls++; return choices; } },
      });
      const api = load("app/(main)/studio/_components/studio-shell-data.ts", {
        "server-only": {},
        "@clerk/nextjs/server": { auth: async () => ({ actor: null }) },
        "@/lib/auth/tenant-context": { resolveTenantContext: async () => ({ app: "estio", locationId, resolution: { location: { id: "tenant-b" }, role, availableLocations: available } }) },
        "@/lib/auth/impersonation": {},
        "@/components/app-shell/app-shell-data": shellData,
        "@/lib/auth/active-location": {}, "@/lib/auth/request-realm": {}, "@/lib/studio/rest": { isStudioProviderUnavailable: () => false },
      });
      const result = await api.getStudioShellData({ locationId });
      assert.equal(result.activeLocationId, "tenant-b");
      assert.equal(result.locationId, locationId);
      assert.equal(result.platformLoginLocations, platform ? choices : null);
      assert.equal(optionsCalls, platform ? 1 : 0);
      assert.deepEqual(Array.from(result.locations, (row: any) => row.id), ["tenant-b"]);
      // The same tenant logo and admin-only AI usage rule as the CRM header.
      assert.equal(result.logoUrl, "/logo.png");
      assert.equal(result.canViewAiUsage, role === "ADMIN");
    }
  }
});

test("platform login accepts only the two known product destinations", async () => {
  const products: string[] = [];
  const api = load("app/api/platform/impersonation/start/route.ts", {
    "next/server": { NextResponse }, "@/lib/auth/impersonation": { startImpersonation: async (input: any) => { products.push(input.product); return { launchUrl: "/sign-in" }; } },
    "@/lib/auth/impersonation-policy": { describeImpersonationStartError: () => "Denied" },
  });
  for (const product of ["studio", "crm", "https://foreign.invalid"]) {
    const response = await api.POST(new Request("https://estio.co/api/platform/impersonation/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ product, targetUserId: "target", locationId: "tenant" }) }));
    assert.equal(response.status, 200);
  }
  assert.deepEqual(products, ["studio", "crm", "crm"]);
});

test("a restricted Studio database keeps the Studio shell from the CRM Location alone", async () => {
  const restricted = Object.assign(new Error("restricted"), { restricted: true });
  for (const app of ["estio", "substo"]) {
    const api = load("app/(main)/studio/_components/studio-shell-data.ts", {
      "server-only": {}, "@clerk/nextjs/server": { auth: async () => ({ actor: null }) }, "@/lib/auth/impersonation": {},
      "@/lib/auth/tenant-context": { resolveTenantContext: async () => { throw restricted; } },
      "@/lib/auth/active-location": { resolveActiveLocation: async () => ({ status: "authorized", location: { id: "crm-location" }, availableLocations: [] }) },
      "@/lib/auth/request-realm": { getRequestAuthRealm: async () => app },
      "@/lib/studio/rest": { isStudioProviderUnavailable: (error: unknown) => error === restricted },
      "@/components/app-shell/app-shell-data": { getAppShellData: async (input: any) => ({ app: input.app, activeLocationId: input.resolution.location.id, locationId: input.locationId }) },
    });
    assert.deepEqual(await api.getStudioShellData(), { app, activeLocationId: "crm-location", locationId: null });
  }
  const other = load("app/(main)/studio/_components/studio-shell-data.ts", {
    "server-only": {}, "@clerk/nextjs/server": {}, "@/lib/auth/impersonation": {}, "@/lib/auth/active-location": {}, "@/lib/auth/request-realm": {},
    "@/lib/auth/tenant-context": { resolveTenantContext: async () => { throw new Error("schema"); } },
    "@/lib/studio/rest": { isStudioProviderUnavailable: () => false }, "@/components/app-shell/app-shell-data": {},
  });
  await assert.rejects(other.getStudioShellData(), /schema/);
});
