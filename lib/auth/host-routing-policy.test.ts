import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import middleware, { config } from "../../middleware";
import { classifySubstoRoute, safeAuthRedirect, signedInHandoff, SIGNED_IN_HANDOFF_WINDOW_MS, skipsLegacyEstioMiddleware } from "./host-routing-policy";

test("API and application paths with file suffixes still run the brand firewall", () => {
  for (const pathname of [
    "/api/__clerk/npm/@clerk/clerk-js@latest/dist/clerk.browser.js",
    "/api/studio/workspaces/id/records/export.csv",
    "/studio/workspace/id/library/file.svg",
    "/admin/properties/id.js",
  ]) {
    assert.equal(unstable_doesMiddlewareMatch({ config, url: `https://studio.example.com${pathname}` }), true, pathname);
  }
  assert.equal(unstable_doesMiddlewareMatch({ config, url: "https://studio.example.com/_next/static/chunks/app.js" }), false);
});

test("Substo admits its app routes and exact profile webhook at path boundaries", () => {
  assert.equal(classifySubstoRoute("/api/webhooks/clerk-profile"), "webhook");
  for (const path of ["/api/webhooks/clerk", "/api/webhooks/clerk-profile/nested", "/api/webhooks/clerk-profile-malicious", "/api/webhooks/clerk-profile.json"]) assert.equal(classifySubstoRoute(path), "blocked");
  assert.equal(classifySubstoRoute("/"), "root");
  assert.equal(classifySubstoRoute("/sign-in/factor-one"), "auth");
  assert.equal(classifySubstoRoute("/studio/workspace/id/library"), "studio");
  assert.equal(classifySubstoRoute("/account/connections"), "profile");
  assert.equal(classifySubstoRoute("/account/connections/google-youtube/callback"), "profile");
  assert.equal(classifySubstoRoute("/account/connections-malicious"), "blocked");
  assert.equal(classifySubstoRoute("/account/billing"), "blocked");
  assert.equal(classifySubstoRoute("/api/studio/workspaces/id/records/export.csv"), "studio-api");
  for (const pathname of ["/admin/properties", "/studio-admin", "/api/studio-admin", "/sign-in-malicious", "/api/__clerk/v1/client.js", "/api/health"]) {
    assert.equal(classifySubstoRoute(pathname), "blocked", pathname);
  }
});

test("Substo rejects the Estio Clerk proxy before authentication even without runtime keys", async () => {
  const previousHosts = process.env.SUBSTO_APP_HOSTS;
  process.env.SUBSTO_APP_HOSTS = "studio.example.com";
  try {
    const response = await middleware(new NextRequest("https://studio.example.com/api/__clerk/v1/client.js", {
      headers: { host: "studio.example.com" },
    }), undefined);
    assert.equal(response?.status, 404);
  } finally {
    if (previousHosts === undefined) delete process.env.SUBSTO_APP_HOSTS;
    else process.env.SUBSTO_APP_HOSTS = previousHosts;
  }
});

test("Substo rejects shared Clerk routing configuration before initializing its realm", async (context) => {
  const previousHosts = process.env.SUBSTO_APP_HOSTS;
  const previousProxy = process.env.NEXT_PUBLIC_CLERK_PROXY_URL;
  process.env.SUBSTO_APP_HOSTS = "studio.example.com";
  process.env.NEXT_PUBLIC_CLERK_PROXY_URL = "/api/__clerk";
  const logged = context.mock.method(console, "error", () => {});
  try {
    const response = await middleware(new NextRequest("https://studio.example.com/studio", {
      headers: { host: "studio.example.com" },
    }), undefined);
    assert.equal(response?.status, 503);
    assert.match(await response!.text(), /configuration conflicts/);
    assert.deepEqual(logged.mock.calls[0].arguments[1], ["NEXT_PUBLIC_CLERK_PROXY_URL"]);
  } finally {
    if (previousHosts === undefined) delete process.env.SUBSTO_APP_HOSTS;
    else process.env.SUBSTO_APP_HOSTS = previousHosts;
    if (previousProxy === undefined) delete process.env.NEXT_PUBLIC_CLERK_PROXY_URL;
    else process.env.NEXT_PUBLIC_CLERK_PROXY_URL = previousProxy;
  }
});

test("Estio retains its prior static and health middleware behavior", () => {
  assert.equal(skipsLegacyEstioMiddleware("/api/health"), true);
  assert.equal(skipsLegacyEstioMiddleware("/some-image.png"), true);
  assert.equal(skipsLegacyEstioMiddleware("/admin/contacts"), false);
  assert.equal(skipsLegacyEstioMiddleware("/trpc/procedure.js"), false);
});

test("signed-out Estio Studio pages redirect to login while tenant /studio remains public content", () => {
  const script = `
    import assert from "node:assert/strict";
    import { NextRequest } from "next/server";
    const loaded = await import("./middleware.ts");
    const middleware = loaded.default.default ?? loaded.default;
    for (const pathname of ["/studio", "/studio/workspace/11111111-1111-4111-8111-111111111111/library", "/studio/workspace/11111111-1111-4111-8111-111111111111/content"]) {
      const response = await middleware(new NextRequest("https://estio.co" + pathname, { headers: { host: "estio.co", accept: "text/html" } }), undefined);
      assert.equal(response.status, 307);
      assert.equal(new URL(response.headers.get("location")).pathname, "/sign-in");
    }
    globalThis.fetch = async (value) => {
      assert.equal(new URL(value).pathname, "/api/public-site-domains/resolve");
      return Response.json({ redirect: false });
    };
    const tenant = await middleware(new NextRequest("https://customer.example/studio", { headers: { host: "customer.example", accept: "text/html" } }), undefined);
    assert.equal(tenant.status, 200);
    assert.equal(new URL(tenant.headers.get("x-middleware-rewrite")).pathname, "/customer.example/studio");
  `;
  const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
    cwd: process.cwd(), encoding: "utf8",
    env: {
      ...process.env,
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: `pk_live_${Buffer.from("clerk.example.com$").toString("base64")}`,
      CLERK_SECRET_KEY: "sk_live_example_not_a_real_key",
      NEXT_PUBLIC_CLERK_SIGN_IN_URL: "/sign-in",
      SUBSTO_APP_HOSTS: "studio.example.com",
      ESTIO_APP_HOSTS: "",
    },
  });
  assert.equal(result.status, 0, result.stderr);
});

test("ticket redirects stay on origin and use the active brand's landing page", () => {
  assert.equal(safeAuthRedirect(null, "substo"), "/studio");
  assert.equal(safeAuthRedirect("/admin", "substo"), "/admin");
  assert.equal(safeAuthRedirect("/studio/workspace/id?from=invite", "substo"), "/studio/workspace/id?from=invite");
  assert.equal(safeAuthRedirect("/studio/../admin", "substo"), "/admin");
  assert.equal(safeAuthRedirect("/\\evil.example", "estio"), "/admin");
  assert.equal(safeAuthRedirect("//evil.example", "estio"), "/admin");
  assert.equal(safeAuthRedirect("/admin/contacts", "estio"), "/admin/contacts");
});

test("Substo sign-in returns may target only its own profile connections or Studio", () => {
  assert.equal(safeAuthRedirect("/account/connections", "substo"), "/account/connections");
  assert.equal(safeAuthRedirect("/account/connections-malicious", "substo"), "/studio");
  assert.equal(safeAuthRedirect("/account/billing", "substo"), "/studio");
});

test("exact profile webhook bypasses browser auth readiness on first-party realms only", async () => {
 const previous = process.env.SUBSTO_APP_HOSTS;
 process.env.SUBSTO_APP_HOSTS = "studio.example.com";
 try {
  for (const host of ["estio.co", "studio.example.com"]) {
   const response = await middleware(new NextRequest(`https://${host}/api/webhooks/clerk-profile`, { method: "POST", headers: { host } }), undefined);
   assert.ok(response); assert.equal(response.status, 200); assert.equal(response.headers.get("x-middleware-next"), "1");
  }
  const response = await middleware(new NextRequest("https://customer.example/api/webhooks/clerk-profile", { method: "POST", headers: { host: "customer.example" } }), undefined);
  assert.ok(response); assert.equal(response.status, 404);
 } finally { if (previous === undefined) delete process.env.SUBSTO_APP_HOSTS; else process.env.SUBSTO_APP_HOSTS = previous; }
});

test("signed-in Substo sign-in pages hand off once with a full load, then stop", () => {
  const now = 1_000_000;
  assert.equal(signedInHandoff("estio", null, now), "none");
  assert.equal(signedInHandoff("tenant", null, now), "none");
  assert.equal(signedInHandoff("substo", null, now), "redirect");
  assert.equal(signedInHandoff("substo", now - 2_000, now), "stalled");
  assert.equal(signedInHandoff("substo", now - SIGNED_IN_HANDOFF_WINDOW_MS, now), "redirect");
  assert.equal(signedInHandoff("substo", now + 5_000, now), "redirect");
});


test("Clerk's absolute same-origin return preserves CRM while cross-app/open redirects are rejected", () => {
  assert.equal(safeAuthRedirect("https://substo.com/admin", "substo", "https://substo.com"), "/admin");
  assert.equal(safeAuthRedirect("https://substo.com/admin/contacts?view=pipeline", "substo", "https://substo.com"), "/admin/contacts?view=pipeline");
  assert.equal(safeAuthRedirect("https://estio.co/admin", "substo", "https://substo.com"), "/studio");
  for (const target of ["https://evil.example/admin", "//evil.example/admin", "https://evil.example@substo.com/admin", "https://substo.com/admin/properties", "javascript:alert(1)", "/\\evil.example/admin"]) assert.equal(safeAuthRedirect(target, "substo", "https://substo.com"), "/studio");
});
