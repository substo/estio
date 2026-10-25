import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { NextRequest, NextResponse } from "next/server";
import { getHostOrigin } from "./host-brand";

function handler(options: { realm?: string; signedIn?: boolean; allowed?: boolean } = {}) {
  const selections: string[] = [];
  const deps: Record<string, any> = {
    "next/server": { NextResponse },
    "@clerk/nextjs/server": { auth: async () => ({ userId: options.signedIn === false ? null : "user" }) },
    "@/lib/auth/host-brand": { getHostOrigin },
    "@/lib/auth/request-realm": { getRequestAuthRealm: async () => options.realm ?? "substo" },
    "@/lib/auth/active-location": { ACTIVE_LOCATION_COOKIE: "active_location_id", ACTIVE_LOCATION_COOKIE_OPTIONS: { httpOnly: true, secure: true, path: "/", sameSite: "lax" } },
    "@/lib/auth/product-navigation": {
      substoCrmDestination: async (id: string) => { selections.push(id); return options.allowed === false ? null : { locationId: "brand-b", path: "/admin" }; },
      substoStudioDestination: async (id: string) => { selections.push(id); return options.allowed === false ? null : { locationId: "brand-b", path: "/studio/workspace/own-workspace" }; },
    },
  };
  const module = { exports: {} as any };
  const code = ts.transpileModule(fs.readFileSync("app/api/studio/product-switch/route.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, URL, require: (name: string) => { assert.ok(name in deps, name); return deps[name]; } });
  return { ...module.exports, selections };
}
function request(product = "crm", origin = "https://substo.com") {
  const body = new FormData(); body.set("product", product); body.set(product === "crm" ? "workspaceId" : "brandId", "selected-id");
  return new NextRequest("https://substo.com/api/studio/product-switch", { method: "POST", headers: { host: "substo.com", origin }, body });
}

test("native product handoff redirects with 303 and sets only the server-authorized brand cookie", async () => {
  for (const product of ["crm", "studio"]) {
    const api = handler(); const response = await api.POST(request(product));
    assert.equal(response.status, 303);
    assert.equal(new URL(response.headers.get("location")).pathname, product === "crm" ? "/admin" : "/studio/workspace/own-workspace");
    assert.equal(response.cookies.get("active_location_id").value, "brand-b");
    assert.equal(api.selections[0], "selected-id");
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
});
test("foreign origin, realm and malformed product cannot reach selection; revoked access cannot change cookies", async () => {
  for (const [options, req, status] of [[{}, request("crm", "https://estio.co"), 403], [{ realm: "estio" }, request(), 403], [{}, request("unknown"), 400]] as const) {
    const api = handler(options); assert.equal((await api.POST(req)).status, status); assert.equal(api.selections.length, 0);
  }
  const api = handler({ allowed: false }); const response = await api.POST(request());
  assert.equal(response.cookies.get("active_location_id"), undefined);
  assert.equal(new URL(response.headers.get("location")).searchParams.get("error"), "access");
});
test("expired CRM handoff returns to CRM after sign-in rather than defaulting to Studio", async () => {
  const api = handler({ signedIn: false }); const response = await api.POST(request());
  const destination = new URL(response.headers.get("location"));
  assert.equal(destination.pathname, "/sign-in"); assert.equal(destination.searchParams.get("redirect_url"), "/admin");
  assert.equal(api.selections.length, 0); assert.equal(response.cookies.get("active_location_id"), undefined);
});
