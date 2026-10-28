import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { NextRequest, NextResponse } from "next/server";
import { cleanStudioLegacyPath } from "./route-policy";
import * as restClient from "./rest-client";

// Per-request React.cache is a pass-through outside a server render.
const passthroughReact = { cache: <T>(fn: T) => fn };

function load(file: string, deps: Record<string, any>) {
  const module = { exports: {} as any };
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, Request, Response, URL, require: (name: string) => { if (name === "react" && !(name in deps)) return passthroughReact; assert.ok(name in deps, name); return deps[name]; } });
  return module.exports;
}
function context(status = "authorized", storage: string | null = "storage-a") {
  return load("lib/studio/route-context.ts", {
    "server-only": {}, "next/navigation": { redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); } },
    "@/lib/auth/tenant-context": { resolveTenantContext: async () => ({ resolution: { status, location: status === "authorized" ? { id: "location-a" } : null }, locationId: storage }) },
    "./rest-client": restClient,
  });
}
function request(tenant?: string, method = "POST") {
  return new Request("https://substo.com/studio/content/idea-reviews/api", { method, headers: tenant ? { "X-Studio-Tenant": tenant } : {} });
}
test("clean route params use active Location mapping, never posted URL storage identity", async () => {
  const api = context();
  const value = await api.studioRouteParams(Promise.resolve({ recordId: "record", locationId: "foreign-storage" }));
  assert.equal(value.locationId, "storage-a"); assert.equal(value.recordId, "record");
  const get = await api.studioRouteParams(Promise.resolve({}), request(undefined, "GET")); assert.equal(get.locationId, "storage-a");
});
test("commands reject stale or absent rendered Location identity before any execution", async () => {
  const api = context(); let executions = 0;
  const handler = api.withStudioRoute(async (req: Request, ctx: any) => {
    const { locationId } = await api.studioRouteParams(ctx.params, req); executions++; return Response.json({ locationId });
  });
  for (const tenant of [undefined, "location-b"]) {
    const result = await handler(request(tenant), { params: Promise.resolve({}) }); assert.equal(result.status, 409);
  }
  assert.equal(executions, 0);
  const accepted = await handler(request("location-a"), { params: Promise.resolve({}) }); assert.equal(accepted.status, 200); assert.equal(executions, 1);
});
test("no-access and missing storage fail closed; pages return to the existing tenant chooser", async () => {
  for (const [status, storage, code] of [["no_access", "storage-a", 403], ["selection_required", null, 403], ["authorized", null, 409]] as const) {
    const api = context(status, storage);
    await assert.rejects(api.studioRouteParams(Promise.resolve({}), request("location-a")), (error: any) => error.status === code);
    await assert.rejects(api.studioRouteParams(Promise.resolve({})), /REDIRECT:\/studio\/select/);
  }
});
test("legacy resource paths cannot become open redirects or route escapes", () => {
  assert.equal(cleanStudioLegacyPath(), "/studio");
  assert.equal(cleanStudioLegacyPath(["library", "record-a"]), "/studio/library/record-a");
  for (const path of [["select"], ["workspace"], ["https://foreign.invalid"], ["library", ".."], ["library", "a/b"], ["library", "a\\b"]]) assert.equal(cleanStudioLegacyPath(path), null);
});
test("both old app links authorize their Location before clean redirect; revoked access changes no cookie", async () => {
  const locationId = "11111111-1111-4111-8111-111111111111";
  for (const host of ["estio.co", "substo.com"]) for (const allowed of [true, false]) {
    let calls = 0;
    const api = load("app/(main)/studio/workspace/[locationId]/[[...path]]/route.ts", {
      "@/lib/auth/host-brand": { getHostOrigin: (requestHost: string) => requestHost === host ? `https://${host}` : null },
      "next/server": { NextResponse }, "@/lib/studio/route-policy": { cleanStudioLegacyPath },
      "@/lib/auth/tenant-context": { resolveWorkspaceTenant: async (id: string) => { assert.equal(id, locationId); calls++; return allowed ? { location: { id: "location-b" } } : null; } },
      "@/lib/auth/active-location": { ACTIVE_LOCATION_COOKIE: "active_location_id", ACTIVE_LOCATION_COOKIE_OPTIONS: { httpOnly: true, path: "/", sameSite: "lax" } },
      "@/lib/studio/rest": { isStudioProviderUnavailable: restClient.isStudioProviderUnavailable },
    });
    const response = await api.GET(new NextRequest(`http://localhost:3002/studio/workspace/${locationId}/library?page=2`, { headers: { host } }), { params: Promise.resolve({ locationId, path: ["library"] }) });
    assert.equal(response.status, allowed ? 303 : 404); assert.equal(response.cookies.get("active_location_id")?.value, allowed ? "location-b" : undefined);
    if (allowed) { const destination = new URL(response.headers.get("location")); assert.equal(destination.host, host); assert.equal(destination.pathname, "/studio/library"); assert.equal(destination.search, "?page=2"); }
    const post = await api.POST(); assert.equal(post.status, 409); assert.equal(calls, 1);
  }
});
test("generated Studio links never expose the legacy workspace prefix", () => {
  const files = ["app", "lib", "components"].flatMap((root) => fs.readdirSync(root, { recursive: true }).filter((name) => /\.(ts|tsx)$/.test(String(name)) && !/\.test\./.test(String(name))).map((name) => `${root}/${name}`));
  for (const file of files) assert.doesNotMatch(fs.readFileSync(file, "utf8"), /\/studio\/workspace\/\$\{/ , file);
});

test("storage access follows the active Location in both realms, never a second selected workspace", async () => {
  const storageId = "11111111-1111-4111-8111-111111111111";
  for (const realm of ["estio", "substo"]) for (const matches of [true, false]) {
    let mirrorCalls = 0;
    const location = { id: matches ? "location-a" : "location-b", authRealm: realm, name: "Canonical location", studioWorkspaceId: matches ? storageId : "another-storage" };
    const workspace = { id: storageId, estio_location_id: "location-a", name: "Old storage label" };
    const api = load("lib/studio/access.ts", {
      "server-only": {}, "../platform/profile-lifecycle": { isPlatformProfileDeleted: async () => false }, "./rest": { studioRest: () => {} },
      "@clerk/nextjs/server": { auth: async () => ({ userId: "person", actor: null }) },
      "next/headers": { headers: async () => ({ get: () => realm }) },
      "@/lib/auth/active-location": {
        resolveActiveLocation: async () => ({ status: "authorized", location }),
        validateActiveLocationSelection: async () => ({ status: "authorized", user: {}, role: "ADMIN", location }),
      },
      "@/lib/auth/host-brand": { getHostBrandConfig: () => ({}), resolveHostBrand: () => realm },
      "@/lib/auth/impersonation": {}, "./access-policy": { isStudioLocationAllowedForSession: () => true },
      "./supabase-service": { getEstioStudioWorkspaceById: async () => workspace, getSubstoStudioWorkspace: async () => workspace },
      "@/lib/locations/location-service": { resolveLocationWorkspaceAccess: async () => { mirrorCalls++; return { location: { id: "location-a", name: "Canonical location" }, studioRole: "admin" }; } },
      "@/lib/locations/substo-locations": { substoLocationDeps: () => ({}) },
    });
    const result = await api.getStudioAccess(storageId);
    if (matches) { assert.equal(result.locationName, "Canonical location"); assert.equal(result.brand, realm); }
    else { assert.equal(result, null); assert.equal(mirrorCalls, 0); }
  }
});

test("Studio API routes answer a restricted provider with one 503 + Retry-After, and rethrow anything else", async () => {
  const api = context();
  const unavailable = await api.withStudioRoute(async () => { throw new restClient.StudioRestError(402, undefined, true); })(request("location-a"), { params: Promise.resolve({}) });
  assert.equal(unavailable.status, 503); assert.equal(unavailable.headers.get("Retry-After"), "120");
  assert.match((await unavailable.json()).error, /temporarily unavailable/);
  await assert.rejects(api.withStudioRoute(async () => { throw new restClient.StudioRestError(402); })(request("location-a"), { params: Promise.resolve({}) }), restClient.StudioRestError);
});
