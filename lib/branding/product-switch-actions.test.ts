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
    "@/lib/studio/access": { getStudioWorkspaceAccess: async (id: string) => { assert.equal(id, workspace); return options.access === undefined ? { brand: "substo", brandId: "brand-b" } : options.access; } },
    "@/lib/auth/host-brand": { getHostBrandConfig: () => ({}), resolveHostBrand: () => options.app ?? "substo" },
    "@/lib/studio/supabase-service": {},
    "@/lib/brands/brand-service": { ensureBrandWorkspace: async (_deps: unknown, brand: any, clerkId: string) => { assert.equal(brand.authRealm, "substo"); assert.equal(clerkId, "substo-user"); return workspace; } },
    "@/lib/brands/substo-brands": { substoBrandDeps: () => ({}) },
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
  await assert.rejects(api.openSubstoBrandStudioAction(form), new RegExp(`REDIRECT:/studio`));
  assert.deepEqual(api.checks, ["brand-b"]);
  assert.equal(api.writes[0][1], "brand-b");
  const revoked = actions({ resolution: { status: "no_access", location: null } });
  form.set("brandId", "estio-brand");
  await assert.rejects(revoked.openSubstoBrandStudioAction(form), /REDIRECT:\/studio\/select\?error=access/);
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

test("CRM switch uses the correct realm action and brand field on desktop, collapsed and mobile renders", () => {
  const substo = () => {};
  const estio = () => {};
  const ProductSwitcher = () => {};
  for (const realm of ["estio", "substo"]) {
    const { AdminProductSwitcher } = uiModule("app/(main)/admin/_components/admin-product-switcher.tsx", {
      "./crm-realm": { useCrmRealm: () => realm }, "@/components/product-switcher": { ProductSwitcher },
      "../../studio/actions": { openEstioStudioLocation: estio, openSubstoBrandStudioAction: substo },
    });
    for (const compact of [false, true]) {
      const node = AdminProductSwitcher({ locationId: "brand-b", compact });
      assert.equal(node.type, ProductSwitcher);
      assert.equal(node.props.active, "crm");
      assert.equal(node.props.compact, compact);
      if (realm === "substo") { assert.equal(node.props.targets.studio.formAction, "/api/studio/product-switch"); assert.equal(node.props.targets.studio.fields.product, "studio"); } else assert.equal(node.props.targets.studio.action, estio);
      assert.equal(node.props.targets.studio.fields[realm === "substo" ? "brandId" : "locationId"], "brand-b");
    }
  }
});

test("both Studio menus bind CRM to the displayed Location rather than a storage UUID", () => {
  const ProductSwitcher = () => {};
  for (const app of ["estio", "substo"]) {
    const { StudioShell } = uiModule("app/(main)/studio/_components/studio-shell.tsx", {
      "next/navigation": { usePathname: () => "/studio/library" }, "@/config": { auth: { enabled: false } },
      "../../admin/_components/admin-shell-layout": { useSidebarCollapsed: () => [false, () => {}] },
      "@/components/product-switcher": { ProductSwitcher },
    });
    const tree = StudioShell({ app, brands: [{ id: "location-b", name: "Tenant B" }], activeBrandId: "location-b", fallbackWorkspaceId: "private-storage-key", children: null });
    const switches: any[] = [];
    function walk(value: any) {
      if (!value || typeof value !== "object") return;
      if (value.type === ProductSwitcher) switches.push(value.props);
      for (const child of Object.values(value)) walk(child);
    }
    walk(tree); assert.equal(switches.length, 2);
    for (const props of switches) {
      assert.equal(props.targets.crm.formAction, "/api/studio/tenant-switch");
      assert.equal(props.targets.crm.fields.locationId, "location-b");
      assert.equal(props.targets.crm.fields.workspaceId, undefined);
    }
  }
});

test("CRM and Studio headers render the same tenant-only control including platform access choices", () => {
  const TenantHeaderSelector = () => {};
  const workspace = "11111111-1111-4111-8111-111111111111";
  const locations = [{ id: "a", name: "Agency A" }, { id: "b", name: "Agency B" }];
  const platformLoginLocations = [{ id: "a", name: "Agency A", isPlatformMaster: true, members: [] }, { id: "c", name: "Support tenant", isPlatformMaster: false, members: [] }];
  const dependencies = {
    "@/components/tenant-header-selector": { TenantHeaderSelector },
    "next/navigation": { usePathname: () => `/studio` },
    "@/config": { auth: { enabled: false } },
    "@/lib/utils": { cn: (...args: string[]) => args.filter(Boolean).join(" ") },
    "./crm-realm": { useCrmRealm: () => "estio" },
    "@/lib/branding/app-identity": { appIdentity: () => ({ name: "Estio" }) },
    "@/lib/viewings/sessions/types": { VIEWING_SESSION_MODES: { assistantLiveTranslate: "live" }, VIEWING_SESSION_KINDS: { twoWayInterpreter: "interpreter" } },
    "../../admin/_components/admin-shell-layout": { useSidebarCollapsed: () => [false, () => {}] },
    "../actions": { openEstioStudioBusinessAction: () => {} },
  };
  const StudioShell = uiModule("app/(main)/studio/_components/studio-shell.tsx", dependencies).StudioShell;
  const DashboardTopNav = uiModule("app/(main)/admin/_components/dashbord-top-nav.tsx", dependencies).default;
  function find(tree: any, type: any): any[] {
    if (!tree || typeof tree !== "object") return [];
    return [...(tree.type === type ? [tree] : []), ...Object.values(tree).flatMap((child) => find(child, type))];
  }
  const studio = StudioShell({ app: "estio", brands: locations, activeBrandId: "a", fallbackWorkspaceId: workspace, platformLoginLocations, children: null });
  const crm = DashboardTopNav({ activeLocation: locations[0], availableLocations: locations, platformLoginLocations, children: null });
  for (const [tree, product] of [[crm, "crm"], [studio, "studio"]] as const) {
    const headers = find(tree, "header"); assert.equal(headers.length, 1);
    const controls = find(headers[0], TenantHeaderSelector); assert.equal(controls.length, 1);
    assert.equal(controls[0].props.product, product);
    assert.equal(controls[0].props.locations, locations);
    assert.equal(controls[0].props.platformLoginLocations, platformLoginLocations);
    assert.equal(controls[0].props.activeLocationId, "a");
    assert.doesNotMatch(JSON.stringify(headers), /AppLogo|AppTenantIdentity|Support access/);
  }
  assert.doesNotMatch(JSON.stringify(studio), /Manage brands|Manage locations/);
});

test("Studio team management is in Settings and no independent brand management section is added", () => {
  const { studioNavGroups } = uiModule("app/(main)/studio/_components/studio-shell.tsx", {});
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
