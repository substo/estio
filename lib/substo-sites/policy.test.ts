import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import middleware from "@/middleware";
import { classifySubstoRoute } from "@/lib/auth/host-routing-policy";
import { isSubstoSitePath, siteSlug, siteLink, websiteSettings } from "./policy";

test("public website paths are an exact read-only surface with no auth, properties or operational nesting", () => {
  for (const path of ["/sites/my-brand", "/sites/my-brand/about", "/sites/my-brand/blog", "/sites/my-brand/blog/post-one", "/sites/my-brand/sitemap.xml"]) {
    assert.equal(isSubstoSitePath(path), true);
    assert.equal(classifySubstoRoute(path), "site");
  }
  for (const path of ["/sites", "/sites-x/foo", "/sites/foo/api/private", "/sites/foo/sign-in/x", "/sites/foo/blog/post/extra", "/sites/foo/properties/search", "/sites/foo/a.json", "/sites/foo/../admin", "/sites/%2fadmin"]) assert.equal(isSubstoSitePath(path), false, path);
});

test("website reads bypass Clerk readiness while writes are rejected before auth or actions", async () => {
  const before = process.env.SUBSTO_APP_HOSTS;
  process.env.SUBSTO_APP_HOSTS = "substo.example.com";
  try {
    for (const host of ["estio.co", "tenant.example.com"]) {
      const result = await middleware(new NextRequest(`https://${host}/sites/my-brand/about`, { headers: { host } }), undefined);
      assert.equal(result?.status, 404);
    }
    for (const method of ["GET", "HEAD", "POST", "PUT", "DELETE"]) {
      const result = await middleware(new NextRequest("https://substo.example.com/sites/my-brand/about", { method, headers: { host: "substo.example.com", "next-action": "forged-action" } }), undefined);
      assert.equal(result?.status, ["GET", "HEAD"].includes(method) ? 200 : 405);
      if (method === "GET") {
        assert.equal(result?.headers.get("cache-control"), "no-store");
        assert.match(result?.headers.get("content-security-policy") || "", /script-src 'none'/);
      }
    }
  } finally { if (before === undefined) delete process.env.SUBSTO_APP_HOSTS; else process.env.SUBSTO_APP_HOSTS = before; }
});

test("website settings strip unknown/private fields and reject executable URLs and CSS", () => {
  assert.equal(siteSlug(" My-Brand "), "my-brand");
  for (const slug of ["x", "has space", "has--hyphens", "../admin", "a".repeat(64)]) assert.equal(siteSlug(slug), null);
  const result = websiteSettings({ title: "Public", googleAiApiKey: "SECRET", accent: "red;display:none", logoUrl: "javascript:alert(1)", email: "bad\r\nvalue@example.com" });
  assert.equal(result.accent, "#111827");
  assert.equal(result.logoUrl, "");
  assert.equal(result.email, "");
  assert.doesNotMatch(JSON.stringify(result), /SECRET|display/);
});

test("authored root links stay inside the brand website and active schemes are denied", () => {
  assert.equal(siteLink("/about", "my-brand"), "/sites/my-brand/about");
  assert.equal(siteLink("/blog/news", "my-brand"), "/sites/my-brand/blog/news");
  assert.equal(siteLink("/../admin", "my-brand"), "/sites/my-brand/admin");
  for (const link of ["javascript:alert(1)", "data:text/html,x", "//other.example", "\\other.example", "java\nscript:alert(1)"]) assert.equal(siteLink(link, "my-brand"), null);
  assert.equal(siteLink("mailto:team@example.com", "my-brand"), "mailto:team@example.com");
});
