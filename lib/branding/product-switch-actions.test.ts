import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

/** Execute the actual actions with request/Clerk/storage ports; never contact a real service. */
function actions(options: { app?: string; access?: any; resolution?: any } = {}) {
  const writes: unknown[][] = [];
  const checks: string[] = [];
  const workspace = "11111111-1111-4111-8111-111111111111";
  const deps: Record<string, any> = {
    "server-only": {},
    "@/lib/auth/request-realm": { getRequestAuthRealm: async () => options.app ?? "substo" },
    "next/headers": { headers: async () => ({ get: () => "substo.com" }), cookies: async () => ({ set: (...args: unknown[]) => writes.push(args) }) },
    "next/navigation": { redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } },
    "@/lib/db": {},
    "@/lib/auth/active-location": {
      ACTIVE_LOCATION_COOKIE: "active_location_id", ACTIVE_LOCATION_COOKIE_OPTIONS: { httpOnly: true, path: "/" },
      validateActiveLocationSelection: async (id: string) => { checks.push(id); return options.resolution ?? { status: "authorized", user: { clerkId: "substo-user" }, location: { id: "brand-b", authRealm: "substo" } }; },
    },
    "@/lib/studio/access": { getStudioWorkspaceAccess: async (id: string) => { assert.equal(id, workspace); return options.access === undefined ? { brand: "substo", locationId: "brand-b" } : options.access; } },
    "@/lib/auth/host-brand": { getHostBrandConfig: () => ({}), resolveHostBrand: () => options.app ?? "substo" },
    "@/lib/studio/supabase-service": {},
    "@/lib/locations/location-service": { ensureLocationWorkspace: async (_deps: unknown, brand: any, clerkId: string) => { assert.equal(brand.authRealm, "substo"); assert.equal(clerkId, "substo-user"); return workspace; } },
    "@/lib/locations/substo-locations": { substoLocationDeps: () => ({}) },
  };
  deps["./request-realm"] = deps["@/lib/auth/request-realm"];
  deps["./active-location"] = deps["@/lib/auth/active-location"];
  const sharedSource = ts.transpileModule(fs.readFileSync("lib/auth/product-navigation.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const sharedExports: any = {};
  vm.runInNewContext(`(function(require, exports) {${sharedSource}\n})`)((name: string) => { assert.ok(name in deps, name); return deps[name]; }, sharedExports);
  deps["@/lib/auth/product-navigation"] = sharedExports;
  const source = ts.transpileModule(fs.readFileSync("app/(main)/studio/actions.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports: any = {};
  vm.runInNewContext(`(function(require, exports) {${source}\n})`)((name: string) => { assert.ok(name in deps, name); return deps[name]; }, exports);
  return { ...exports, writes, checks, workspace };
}

test("Studio → CRM rechecks and selects the displayed workspace's brand instead of the stale active cookie", async () => {
  const api = actions();
  await assert.rejects(api.openSubstoStudioCrmAction(api.workspace), /REDIRECT:\/admin$/);
  assert.deepEqual(api.checks, ["brand-b"]);
  assert.equal(api.writes.length, 1);
  assert.equal(api.writes[0][0], "active_location_id");
  assert.equal(api.writes[0][1], "brand-b");
});

test("foreign, deleted or revoked workspace access never changes the active brand", async () => {
  for (const options of [
    { app: "estio" }, { access: null }, { access: { brand: "estio", locationId: "estio" } },
    { resolution: { status: "no_access", location: null } },
    { resolution: { status: "authorized", location: { id: "brand-b", authRealm: "estio" } } },
    { resolution: { status: "authorized", location: { id: "other", authRealm: "substo" } } },
  ]) {
    const api = actions(options);
    await assert.rejects(api.openSubstoStudioCrmAction(api.workspace), /REDIRECT:\/studio\/select\?error=access/);
    assert.equal(api.writes.length, 0);
  }
});

test("CRM → Studio validates the posted brand and opens only its workspace", async () => {
  const api = actions();
  const form = new FormData();
  form.set("brandId", "brand-b");
  await assert.rejects(api.openSubstoLocationStudioAction(form), new RegExp(`REDIRECT:/studio`));
  assert.deepEqual(api.checks, ["brand-b"]);
  assert.equal(api.writes[0][1], "brand-b");
  const revoked = actions({ resolution: { status: "no_access", location: null } });
  form.set("brandId", "estio-brand");
  await assert.rejects(revoked.openSubstoLocationStudioAction(form), /REDIRECT:\/studio\/select\?error=access/);
  assert.equal(revoked.writes.length, 0);
});

function uiModule(file: string, dependencies: Record<string, any>) {
  const jsx = (type: unknown, props: unknown) => ({ type, props });
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const exports: any = {};
  vm.runInNewContext(`(function(require, exports) {${code}\n})`)((name: string) => {
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
    return dependencies[name] ?? {};
  }, exports);
  return exports;
}

const productConfigModule = (dependencies: Record<string, any> = {}) => uiModule("components/app-shell/product-config.ts", dependencies);

test("CRM switch uses the correct realm action and brand field on desktop, collapsed and mobile renders", () => {
  const estio = () => {};
  for (const realm of ["estio", "substo"]) {
    const { productShellConfig } = productConfigModule({ "@/app/(main)/studio/actions": { openEstioStudioLocation: estio } });
    const { targets } = productShellConfig(realm, "crm", { locationId: "brand-b", workspaceId: null });
    assert.equal(targets.crm.href, "/admin");
    if (realm === "substo") { assert.equal(targets.studio.formAction, "/api/studio/product-switch"); assert.equal(targets.studio.fields.product, "studio"); } else assert.equal(targets.studio.action, estio);
    assert.equal(targets.studio.fields[realm === "substo" ? "brandId" : "locationId"], "brand-b");
  }
});

/** Render the one shell with stub widgets; returns the sidebar switch and the header element. */
function renderShell(app: string, product: "crm" | "studio", overrides: Record<string, unknown> = {}) {
  const ProductSwitcher = () => {};
  const AppHeader = () => {};
  const { productShellConfig } = productConfigModule({ "@/app/(main)/studio/actions": { openEstioStudioLocation: () => {} } });
  const { AppShell } = uiModule("components/app-shell/app-shell.tsx", {
    "./sidebar-preference": { useSidebarCollapsed: () => [false, () => {}], SidebarPreferenceScript: () => null },
    "@/app/(main)/admin/_components/admin-layout-policy": { useResolvedAdminLayoutPolicy: () => ({ appSurface: false }), AdminLayoutPolicyProvider: "policy" },
    "@/app/(main)/admin/_components/crm-realm": { CrmRealmProvider: "realm" },
    "@/lib/utils": { cn: (...args: string[]) => args.filter(Boolean).join(" ") },
    "@/components/product-switcher": { ProductSwitcher },
    "./app-header": { AppHeader },
    "./product-config": { productShellConfig },
  });
  const tree = AppShell({
    product, app, activeLocationId: "location-b", locations: [{ id: "location-b", name: "Tenant B" }], platformLoginLocations: null,
    impersonation: null, canViewAiUsage: true, workspaceId: "private-storage-key", children: null, ...overrides,
  });
  const find = (type: unknown): any[] => {
    const found: any[] = [];
    (function walk(value: any) {
      if (!value || typeof value !== "object") return;
      if (value.type === type) found.push(value);
      for (const child of Object.values(value)) walk(child);
    })(tree);
    return found;
  };
  return { tree, switches: find(ProductSwitcher), headers: find(AppHeader) };
}

test("both Studio menus bind CRM to the displayed Location rather than a storage UUID", () => {
  for (const app of ["estio", "substo"]) {
    const { switches, headers } = renderShell(app, "studio");
    assert.equal(switches.length, 1); assert.equal(headers.length, 1);
    // Desktop sidebar and mobile header menu share one target set.
    for (const targets of [switches[0].props.targets, headers[0].props.productConfig.targets]) {
      assert.equal(targets.crm.formAction, "/api/studio/tenant-switch");
      assert.equal(targets.crm.fields.locationId, "location-b");
      assert.equal(targets.crm.fields.workspaceId, undefined);
    }
  }
});

test("CRM and Studio headers render the same tenant-only control including platform access choices", () => {
  const locations = [{ id: "a", name: "Agency A" }, { id: "b", name: "Agency B" }];
  const platformLoginLocations = [{ id: "a", name: "Agency A", isPlatformMaster: true, members: [] }, { id: "c", name: "Support tenant", isPlatformMaster: false, members: [] }];
  for (const product of ["crm", "studio"] as const) {
    const { headers } = renderShell("estio", product, { activeLocationId: "a", locations, platformLoginLocations });
    assert.equal(headers.length, 1);
    const props = headers[0].props;
    assert.equal(props.product, product);
    assert.equal(props.locations, locations);
    assert.equal(props.platformLoginLocations, platformLoginLocations);
    assert.equal(props.activeLocationId, "a");
  }
  const header = fs.readFileSync("components/app-shell/app-header.tsx", "utf8");
  assert.match(header, /<TenantHeaderSelector app=\{app\} product=\{product\} activeLocationId=\{activeLocationId\} locations=\{locations\} platformLoginLocations=\{platformLoginLocations\} \/>/);
  assert.doesNotMatch(header, /AppLogo|AppTenantIdentity|Support access|Manage brands|Manage locations/);
});

test("Studio team management is in Settings and no independent brand management section is added", () => {
  const { studioNavGroups } = productConfigModule();
  for (const app of ["estio", "substo"]) {
    const groups = studioNavGroups(app, "workspace", "location-a");
    assert.equal(groups.some((group: any) => group.label === "Brand" || group.label === "Workspace"), false);
    const settings = groups.find((group: any) => group.label === "Settings");
    const team = settings.items.find((item: any) => item.label === "Team"); assert.ok(team);
    if (app === "estio") { assert.equal(team.formTarget.fields.locationId, "location-a"); assert.equal(team.formTarget.fields.product, "team"); }
    else assert.equal(team.href, "/brand/team");
  }
});

test("Studio exposes no action for creating an additional tenant", () => {
  assert.equal(actions().createSubstoBrandAction, undefined);
  const chooser = fs.readFileSync("app/(main)/studio/select/page.tsx", "utf8");
  assert.doesNotMatch(chooser, /Create a brand|createSubstoBrandAction|Create brand/);
});
