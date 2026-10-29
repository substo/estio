import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

// Per-request React.cache is a pass-through outside a server render.
const passthroughReact = { cache: <T>(fn: T) => fn };

function load(file: string, deps: Record<string, any>) {
  const module = { exports: {} as any };
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, Request, Response, URL, require: (name: string) => { if (name === "react" && !(name in deps)) return passthroughReact; assert.ok(name in deps, name); return deps[name]; } });
  return module.exports;
}
function context(status = "authorized", storage: string | null = "location-a") {
  return load("lib/studio/route-context.ts", {
    "server-only": {}, "next/navigation": { redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); } },
    "@/lib/auth/tenant-context": { resolveTenantContext: async () => status !== "authorized" ? null : ({ resolution: { status, location: status === "authorized" ? { id: "location-a" } : null }, locationId: storage }) },
  });
}
function request(tenant?: string, method = "POST") {
  return new Request("https://substo.com/studio/content/idea-reviews/api", { method, headers: tenant ? { "X-Studio-Tenant": tenant } : {} });
}
test("clean route params use active Location mapping, never posted URL storage identity", async () => {
  const api = context();
  const value = await api.studioRouteParams(Promise.resolve({ recordId: "record", locationId: "foreign-storage" }));
  assert.equal(value.locationId, "location-a"); assert.equal(value.recordId, "record");
  const get = await api.studioRouteParams(Promise.resolve({}), request(undefined, "GET")); assert.equal(get.locationId, "location-a");
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
  for (const [status, storage, code] of [["no_access", "storage-a", 403], ["selection_required", null, 403], ["authorized", null, 403]] as const) {
    const api = context(status, storage);
    await assert.rejects(api.studioRouteParams(Promise.resolve({}), request("location-a")), (error: any) => error.status === code);
    await assert.rejects(api.studioRouteParams(Promise.resolve({})), /REDIRECT:\/studio\/select/);
  }
});
test("generated Studio links never expose the legacy workspace prefix", () => {
  const files = ["app", "lib", "components"].flatMap((root) => fs.readdirSync(root, { recursive: true }).filter((name) => /\.(ts|tsx)$/.test(String(name)) && !/\.test\./.test(String(name))).map((name) => `${root}/${name}`));
  for (const file of files) assert.doesNotMatch(fs.readFileSync(file, "utf8"), /\/studio\/workspace\/\$\{/ , file);
});

test("storage access follows the active canonical Location and realm without a membership mirror", async () => {
  for (const realm of ["estio", "substo"]) for (const matches of [true, false]) {
    const location = { id: matches ? "location-a" : "location-b", authRealm: realm, name: "Canonical location" };
    const api = load("lib/studio/access.ts", {
      "server-only": {}, "../platform/profile-lifecycle": { isPlatformProfileDeleted: async () => false }, "./studio-db": { studioDb: {} },
      "@clerk/nextjs/server": { auth: async () => ({ userId: "person", actor: null }) },
      "next/headers": { headers: async () => ({ get: () => realm }) },
      "@/lib/auth/active-location": {
        resolveActiveLocation: async () => ({ status: "authorized", location, role: "ADMIN" }),
        validateActiveLocationSelection: async () => ({ status: "authorized", user: {}, role: "ADMIN", location }),
      },
      "@/lib/auth/host-brand": { getHostBrandConfig: () => ({}), resolveHostBrand: () => realm },
      "@/lib/auth/impersonation": {}, "./access-policy": { isStudioLocationAllowedForSession: () => true },
    });
    const result = await api.getStudioAccess("location-a");
    if (matches) { assert.equal(result.locationName, "Canonical location"); assert.equal(result.app, realm); assert.equal(result.locationId, "location-a"); }
    else assert.equal(result, null);
  }
});

test("Studio API database failures propagate without old provider fallback", async () => {
  const api = context();
  await assert.rejects(api.withStudioRoute(async () => { throw new Error("database unavailable"); })(request("location-a"), { params: Promise.resolve({}) }), /database unavailable/);
});
