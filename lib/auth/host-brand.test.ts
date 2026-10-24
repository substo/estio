import assert from "node:assert/strict";
import test from "node:test";
import { getHostBrandConfig, getHostOrigin, resolveHostBrand } from "./host-brand";

const config = {
  estioHosts: ["estio.co", "app.estio.co"],
  substoHosts: ["studio.example.com", "substo.localhost"],
  estioDevelopmentHosts: ["localhost", "127.0.0.1", "::1"],
};

test("origins preserve local ports without substring-based local-domain detection", () => {
  assert.equal(getHostOrigin("substo.localhost:3000"), "http://substo.localhost:3000");
  assert.equal(getHostOrigin("[::1]:443"), "http://[::1]:443");
  assert.equal(getHostOrigin("localhost.evil.example"), "https://localhost.evil.example");
  assert.equal(getHostOrigin("example.com@evil.example"), null);
  assert.equal(getHostOrigin("example.com/path"), null);
});

test("resolves first-party hosts by exact normalized hostname", () => {
  assert.equal(resolveHostBrand("ESTIO.CO:443", config), "estio");
  assert.equal(resolveHostBrand("studio.example.com.", config), "substo");
  assert.equal(resolveHostBrand("substo.localhost:3000", config), "substo");
});

test("keeps localhost on Estio unless an exact Substo development host is used", () => {
  assert.equal(resolveHostBrand("localhost:3000", config), "estio");
  assert.equal(resolveHostBrand("substo.localhost:3000", config), "substo");
  assert.equal(resolveHostBrand("[::1]:3000", config), "estio");
});

test("unknown and empty hosts remain in the public tenant routing bucket", () => {
  assert.equal(resolveHostBrand("client-site.example", config), "tenant");
  assert.equal(resolveHostBrand(null, config), "tenant");
});

test("runtime config requires an explicit Substo host allowlist", () => {
  const runtime = getHostBrandConfig({ ESTIO_APP_HOSTS: "portal.estio.co", SUBSTO_APP_HOSTS: "studio.example.com" } as unknown as NodeJS.ProcessEnv);
  assert.equal(resolveHostBrand("portal.estio.co", runtime), "estio");
  assert.equal(resolveHostBrand("studio.example.com", runtime), "substo");
  assert.equal(resolveHostBrand("other.example.com", runtime), "tenant");
});
