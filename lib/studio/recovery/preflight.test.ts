import assert from "node:assert/strict";
import test from "node:test";
import { buildStudioReleasePreflight } from "./preflight";
const ref = "fixturestudio00000000";
const env = { NODE_ENV: "test" as const, STUDIO_SUPABASE_URL: `https://${ref}.supabase.co`, STUDIO_DATABASE_URL: `postgresql://role:synthetic-password@db.${ref}.supabase.co/postgres`,
 DATABASE_URL: "postgresql://role:other-password@db.businessfixture000000.supabase.co/postgres", STUDIO_SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-key",
 STUDIO_R2_ENDPOINT: "https://r2.example", STUDIO_R2_ACCESS_KEY_ID: "synthetic-access", STUDIO_R2_SECRET_ACCESS_KEY: "synthetic-secret", STUDIO_R2_BUCKET_NAME: "studio-media",
 STUDIO_SECRETS_KEY: Buffer.alloc(32, 1).toString("base64"), NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_estio_fixture", CLERK_SECRET_KEY: "sk_estio_fixture",
 SUBSTO_CLERK_PUBLISHABLE_KEY: "pk_substo_fixture", SUBSTO_CLERK_SECRET_KEY: "sk_substo_fixture", CLERK_ENCRYPTION_KEY: "synthetic-clerk-encryption",
 ESTIO_CLERK_PROFILE_WEBHOOK_SECRET: "synthetic-estio-webhook", SUBSTO_CLERK_PROFILE_WEBHOOK_SECRET: "synthetic-substo-webhook", ESTIO_CLERK_INSTANCE_ID: "instance-estio", SUBSTO_CLERK_INSTANCE_ID: "instance-substo",
 GOOGLE_CLIENT_ID: "synthetic-client", GOOGLE_CLIENT_SECRET: "synthetic-client-secret", CRON_SECRET: "synthetic-cron-secret" };
const input = () => ({ env, projectRef: ref, bucket: "studio-media", freeBytes: 10 * 1024 ** 3, artifactBytes: 1024 ** 3, backupSpoolBytes: 2 * 1024 ** 3, mediaTempBytes: 1024 ** 3,
 migrations: Array.from({ length: 27 }, (_, n) => ({ name: `${20261022000000 + n}_fixture.sql`, sha256: "a".repeat(64) })) });
test("offline configuration and concrete capacity plan never claim release readiness or disclose configuration values", () => {
 const result = buildStudioReleasePreflight(input()); assert.equal(result.configurationReady, true); assert.equal(result.releaseReady, false); assert.equal(result.capacity.requiredFreeBytes, 6 * 1024 ** 3);
 const output = JSON.stringify(result); for (const value of Object.values(env)) if (value.includes("synthetic") || value.includes("postgresql:")) assert.ok(!output.includes(value));
 assert.ok(result.unverified.includes("authorized_deployment"));
});
test("wrong/Business targets, shared realms, redirect conflicts, partial Google config and insufficient disk fail", () => {
 for (const patch of [{ STUDIO_DATABASE_URL: env.DATABASE_URL }, { DATABASE_URL: env.STUDIO_DATABASE_URL }, { STUDIO_SUPABASE_URL: "https://wrong.example" },
  { SUBSTO_CLERK_SECRET_KEY: env.CLERK_SECRET_KEY }, { NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL: "/admin" }, { PLATFORM_GOOGLE_CLIENT_ID: "partial" }, { CRON_SECRET: "" }]) {
  assert.equal(buildStudioReleasePreflight({ ...input(), env: { ...env, ...patch } }).configurationReady, false, JSON.stringify(Object.keys(patch)));
 }
 assert.equal(buildStudioReleasePreflight({ ...input(), freeBytes: 1024 ** 3 }).configurationReady, false);
});
test("pooler identities are pinned by project username and cannot alias the Business direct host", () => {
 const url = `postgresql://postgres.${ref}:synthetic@aws-1-eu.pooler.supabase.com:6543/postgres`;
 assert.equal(buildStudioReleasePreflight({ ...input(), env: { ...env, STUDIO_DATABASE_URL: url } }).configurationReady, true);
 assert.equal(buildStudioReleasePreflight({ ...input(), env: { ...env, STUDIO_DATABASE_URL: url, DATABASE_URL: env.STUDIO_DATABASE_URL } }).configurationReady, false);
});
test("invalid estimates, credentials in API URLs and missing migration inventory cannot pass", () => {
 assert.throws(() => buildStudioReleasePreflight({ ...input(), artifactBytes: -1 }));
 assert.equal(buildStudioReleasePreflight({ ...input(), migrations: [] }).configurationReady, false);
 assert.equal(buildStudioReleasePreflight({ ...input(), env: { ...env, STUDIO_SUPABASE_URL: `https://user:password@${ref}.supabase.co` } }).configurationReady, false);
});
