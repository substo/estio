import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { canManageStudioAi, formatUsd, keyHint, readMonthlyBudget, readOpenAiKey, verifyOpenAiKey } from "./ai-settings-policy";
import { aiCredentialContext, decryptStudioSecret, encryptStudioSecret, hasStudioSecretsKey } from "./secrets";

const keyA = randomBytes(32).toString("base64");
const keyB = randomBytes(32).toString("base64");
const ws = "70000000-0000-4000-8000-000000000001";
const secret = "sk-proj-abcdefghijklmnopqrstuvwxyz0123";

test("secrets round-trip, bind to workspace and purpose, and survive key rotation", () => {
  const env = { STUDIO_SECRETS_KEY: keyA };
  const sealed = encryptStudioSecret(secret, aiCredentialContext(ws, "openai"), env);
  assert.equal(sealed.keyId, "v1"); assert.ok(!sealed.ciphertext.includes("sk-"));
  assert.match(sealed.iv, /^[A-Za-z0-9+/]{16}$/); assert.match(sealed.authTag, /^[A-Za-z0-9+/]{22}==$/);
  assert.equal(decryptStudioSecret(sealed, aiCredentialContext(ws, "openai"), env), secret);
  assert.throws(() => decryptStudioSecret(sealed, aiCredentialContext("70000000-0000-4000-8000-000000000002", "openai"), env));
  assert.throws(() => decryptStudioSecret({ ...sealed, ciphertext: Buffer.from("tampered").toString("base64") }, aiCredentialContext(ws, "openai"), env));
  const rotated = { STUDIO_SECRETS_KEY: keyB, STUDIO_SECRETS_KEY_ID: "v2", STUDIO_SECRETS_PREVIOUS_KEYS: `v1:${keyA}` };
  assert.equal(decryptStudioSecret(sealed, aiCredentialContext(ws, "openai"), rotated), secret);
  assert.equal(encryptStudioSecret(secret, "c", rotated).keyId, "v2");
  assert.throws(() => decryptStudioSecret(sealed, aiCredentialContext(ws, "openai"), { STUDIO_SECRETS_KEY: keyB, STUDIO_SECRETS_KEY_ID: "v2" }));
  assert.equal(hasStudioSecretsKey({}), false); assert.equal(hasStudioSecretsKey({ STUDIO_SECRETS_KEY: "short" }), false);
  assert.throws(() => encryptStudioSecret(secret, "c", {}), /not configured/);
});

test("only Substo owners/admins and Estio location admins manage AI settings", () => {
  assert.equal(canManageStudioAi({ brand: "substo", role: "owner" }), true);
  assert.equal(canManageStudioAi({ brand: "substo", role: "admin" }), true);
  assert.equal(canManageStudioAi({ brand: "substo", role: "member" }), false);
  assert.equal(canManageStudioAi({ brand: "estio", role: "ADMIN" }), true);
  assert.equal(canManageStudioAi({ brand: "estio", role: "MEMBER" }), false);
});

test("key and budget inputs are validated exactly", () => {
  assert.equal(readOpenAiKey(`  ${secret} `), secret); assert.equal(keyHint(secret), "0123");
  for (const bad of ["", "pk-abc", "sk-short", "sk-has spaces in it 1234567890", null]) assert.throws(() => readOpenAiKey(bad));
  assert.equal(readMonthlyBudget("25"), 25_000_000); assert.equal(readMonthlyBudget("25.5"), 25_500_000); assert.equal(readMonthlyBudget("0"), 0);
  for (const bad of ["-1", "1.234", "abc", "", "100000.01"]) assert.throws(() => readMonthlyBudget(bad));
  assert.equal(readMonthlyBudget("100000"), 100_000_000_000);
  assert.equal(formatUsd(25_500_000), "$25.50");
});

test("key verification classifies OpenAI responses without leaking the key", async () => {
  let seen: Headers | null = null;
  const reply = (status: number) => (async (_url: unknown, init?: RequestInit) => { seen = new Headers(init?.headers); return new Response("{}", { status }); }) as typeof fetch;
  assert.equal(await verifyOpenAiKey(secret, reply(200)), "valid");
  assert.equal(seen!.get("authorization"), `Bearer ${secret}`);
  assert.equal(await verifyOpenAiKey(secret, reply(401)), "invalid");
  assert.equal(await verifyOpenAiKey(secret, reply(503)), "unavailable");
  assert.equal(await verifyOpenAiKey(secret, (async () => { throw new Error("offline"); }) as typeof fetch), "unavailable");
});
