import assert from "node:assert/strict";
import test from "node:test";
import { getClerkBrandKeys, getClerkSatelliteProps, getSubstoClerkConfigConflicts, hasClerkEncryptionKey } from "./clerk-runtime";

test("satellite options provide a tenant host and stay absent for primary/local realms", () => {
  assert.deepEqual(getClerkSatelliteProps("tenant", "https://customer.example"), { isSatellite: true, domain: "customer.example" });
  assert.deepEqual(getClerkSatelliteProps("tenant", "https://customer.example:8443"), { isSatellite: true, domain: "customer.example" });
  assert.deepEqual(getClerkSatelliteProps("substo", "https://studio.example.com"), {});
  assert.deepEqual(getClerkSatelliteProps("estio", "https://estio.co"), {});
  assert.deepEqual(getClerkSatelliteProps("tenant", "http://customer.localhost:3000"), {});
});

test("Substo rejects shared realm/proxy and forced/legacy redirect settings", () => {
  for (const key of ["NEXT_PUBLIC_CLERK_DOMAIN", "NEXT_PUBLIC_CLERK_PROXY_URL", "CLERK_DOMAIN", "CLERK_PROXY_URL", "NEXT_PUBLIC_CLERK_SIGN_IN_FORCE_REDIRECT_URL", "NEXT_PUBLIC_CLERK_SIGN_UP_FORCE_REDIRECT_URL", "NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL", "NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL", "NEXT_PUBLIC_CLERK_IS_SATELLITE", "CLERK_IS_SATELLITE"]) {
    assert.deepEqual(getSubstoClerkConfigConflicts({ [key]: key.endsWith("IS_SATELLITE") ? "true" : "configured" } as unknown as NodeJS.ProcessEnv), [key]);
  }
  assert.deepEqual(getSubstoClerkConfigConflicts({ NEXT_PUBLIC_CLERK_IS_SATELLITE: "false", NEXT_PUBLIC_CLERK_SIGN_IN_URL: "/sign-in", NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL: "/" } as unknown as NodeJS.ProcessEnv), []);
});

test("generic Clerk CDN settings remain usable while an Estio proxy script cannot cross realms", () => {
  assert.deepEqual(getSubstoClerkConfigConflicts({ NEXT_PUBLIC_CLERK_JS_URL: "https://cdn.jsdelivr.net/npm/@clerk/clerk-js/dist/clerk.browser.js" } as unknown as NodeJS.ProcessEnv), []);
  assert.deepEqual(getSubstoClerkConfigConflicts({ NEXT_PUBLIC_CLERK_JS_URL: "/api/__clerk/npm/clerk.browser.js" } as unknown as NodeJS.ProcessEnv), ["NEXT_PUBLIC_CLERK_JS_URL"]);
  assert.deepEqual(getSubstoClerkConfigConflicts({ NEXT_PUBLIC_CLERK_JS_URL: "https://clerk.estio.co/npm/clerk.browser.js" } as unknown as NodeJS.ProcessEnv), ["NEXT_PUBLIC_CLERK_JS_URL"]);
});

test("Substo keys never fall back to the Estio Clerk realm", () => {
  assert.equal(getClerkBrandKeys("substo", {
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_estio",
    CLERK_SECRET_KEY: "sk_estio",
  } as unknown as NodeJS.ProcessEnv), null);
});

test("Substo keys are resolved only from its explicit pair", () => {
  assert.deepEqual(getClerkBrandKeys("substo", {
    SUBSTO_CLERK_PUBLISHABLE_KEY: "pk_substo",
    SUBSTO_CLERK_SECRET_KEY: "sk_substo",
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_estio",
    CLERK_SECRET_KEY: "sk_estio",
  } as unknown as NodeJS.ProcessEnv), {
    publishableKey: "pk_substo",
    secretKey: "sk_substo",
  });
});

test("Estio retains its existing Clerk environment names", () => {
  assert.deepEqual(getClerkBrandKeys("estio", {
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_estio",
    CLERK_SECRET_KEY: "sk_estio",
  } as unknown as NodeJS.ProcessEnv), {
    publishableKey: "pk_estio",
    secretKey: "sk_estio",
  });
});

test("dynamic Clerk keys require an explicit encryption key", () => {
  assert.equal(hasClerkEncryptionKey({} as unknown as NodeJS.ProcessEnv), false);
  assert.equal(hasClerkEncryptionKey({ CLERK_ENCRYPTION_KEY: "random-32-byte-key" } as unknown as NodeJS.ProcessEnv), true);
});
