import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { NextRequest, NextResponse } from "next/server";

function load(file: string, deps: Record<string, any>) {
  const module = { exports: {} as any };
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require: (name: string) => { assert.ok(name in deps, `Unexpected dependency: ${name}`); return deps[name]; }, URL });
  return module.exports;
}
const workspaceId = "11111111-1111-4111-8111-111111111111";
function context(options: { realm?: string; denied?: boolean; deleted?: boolean; unmapped?: boolean } = {}) {
  const selected: string[] = [];
  const realm = options.realm ?? "substo";
  const authorized = { status: "authorized", location: { id: "tenant-b", name: "Canonical name", authRealm: realm, studioWorkspaceId: workspaceId }, availableLocations: [{ id: "tenant-b", name: "Canonical name" }] };
  const workspace = { id: workspaceId, name: "Stale workspace name", estio_location_id: "tenant-b" };
  const api = load("lib/auth/tenant-context.ts", {
    "server-only": {}, "@/lib/db": { default: { location: { findFirst: async (args: any) => { assert.equal(args.where.authRealm, realm); assert.equal(args.where.studioWorkspaceId, workspaceId); return options.unmapped ? null : { id: "tenant-b" }; } } } },
    "@clerk/nextjs/server": { auth: async () => ({ userId: "person" }) }, "./request-realm": { getRequestAuthRealm: async () => realm },
    "./active-location": { resolveActiveLocation: async () => ({ status: "authorized", location: { id: "cookie-a" } }), validateActiveLocationSelection: async (id: string) => { selected.push(id); return options.denied ? { status: "no_access", location: null } : authorized; } },
    "@/lib/studio/supabase-service": { getEstioStudioWorkspace: async () => workspace, getEstioStudioWorkspaceById: async () => workspace, getSubstoStudioWorkspace: async () => workspace },
    "@/lib/platform/profile-lifecycle": { isPlatformProfileDeleted: async () => Boolean(options.deleted) }, "@/lib/studio/rest": { studioRest: () => { throw new Error("No writes permitted"); } },
  });
  return { api, selected };
}
test("explicit workspace wins over cookie context in each realm without provisioning", async () => {
  for (const realm of ["estio", "substo"]) {
    const { api, selected } = context({ realm }); const value = await api.resolveTenantContext({ workspaceId });
    assert.equal(value.resolution.location.id, "tenant-b"); assert.equal(value.workspaceId, workspaceId); assert.deepEqual(selected, ["tenant-b"]);
  }
});
test("foreign/revoked, deleted profile, unmapped and malformed workspaces fail closed", async () => {
  for (const options of [{ denied: true }, { deleted: true }, { unmapped: true }, { realm: "unknown" }]) {
    assert.equal(await context(options).api.resolveTenantContext({ workspaceId }), null);
  }
  assert.equal(await context().api.resolveWorkspaceTenant("not-a-uuid"), null);
});
test("explicit denied Location never falls back to the cookie", async () => {
  assert.equal(await context({ denied: true }).api.resolveTenantContext({ locationId: "foreign" }), null);
});
test("preference POST validates origin and authorization before setting any cookie", async () => {
  for (const allowed of [true, false]) {
    const api = load("app/api/studio/tenant-selection/route.ts", {
      "next/server": { NextResponse }, "@/lib/auth/host-brand": { getHostOrigin: () => "https://substo.com" },
      "@/lib/auth/active-location": { ACTIVE_LOCATION_COOKIE: "active_location_id", ACTIVE_LOCATION_COOKIE_OPTIONS: { httpOnly: true, path: "/", sameSite: "lax" } },
      "@/lib/auth/tenant-context": { resolveWorkspaceTenant: async () => allowed ? { location: { id: "tenant-b" } } : null },
    });
    const request = (origin: string) => new NextRequest("https://substo.com/api/studio/tenant-selection", { method: "POST", headers: { host: "substo.com", origin, "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId }) });
    const foreign = await api.POST(request("https://estio.co")); assert.equal(foreign.status, 403); assert.equal(foreign.cookies.get("active_location_id"), undefined);
    const response = await api.POST(request("https://substo.com")); assert.equal(response.status, allowed ? 200 : 403);
    assert.equal(response.cookies.get("active_location_id")?.value, allowed ? "tenant-b" : undefined);
  }
});
test("native tenant switches reauthorize before provisioning or changing the cookie", async () => {
  for (const allowed of [true, false]) {
    const checks: string[] = [];
    const api = load("app/api/studio/tenant-switch/route.ts", {
      "next/server": { NextResponse }, "@/lib/auth/host-brand": { getHostOrigin: () => "https://substo.com" },
      "@/lib/auth/product-navigation": { studioDestination: async (id: string) => { checks.push(id); return allowed ? { locationId: id, path: `/studio/workspace/${workspaceId}` } : null; } },
      "@/lib/auth/active-location": { ACTIVE_LOCATION_COOKIE: "active_location_id", ACTIVE_LOCATION_COOKIE_OPTIONS: { httpOnly: true, path: "/", sameSite: "lax" }, validateActiveLocationSelection: async (id: string) => { checks.push(id); return allowed ? { status: "authorized", location: { id } } : { status: "no_access" }; } },
    });
    for (const product of ["studio", "crm", "team"]) {
      const body = new FormData(); body.set("product", product); body.set("locationId", "tenant-b");
      const response = await api.POST(new NextRequest("https://substo.com/api/studio/tenant-switch", { method: "POST", headers: { host: "substo.com", origin: "https://substo.com" }, body }));
      assert.equal(response.status, 303); assert.equal(response.cookies.get("active_location_id")?.value, allowed ? "tenant-b" : undefined);
      assert.equal(new URL(response.headers.get("location")!).pathname, allowed ? product === "studio" ? `/studio/workspace/${workspaceId}` : product === "team" ? "/admin/team" : "/admin" : "/studio");
    }
    assert.deepEqual(checks, Array(3).fill("tenant-b"));
    const foreignBody = new FormData(); foreignBody.set("product", "studio"); foreignBody.set("locationId", "foreign");
    const foreign = await api.POST(new NextRequest("https://substo.com/api/studio/tenant-switch", { method: "POST", headers: { host: "substo.com", origin: "https://estio.co" }, body: foreignBody }));
    assert.equal(foreign.status, 403); assert.equal(checks.length, 3);
  }
});
