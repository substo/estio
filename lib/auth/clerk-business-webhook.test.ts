import assert from "node:assert/strict";
import test from "node:test";
import { Webhook } from "svix";
import { realmAcceptsTeamInvites, realmHandlesTenantContacts, verifyClerkBusinessWebhook } from "./clerk-business-webhook";

const estioSecret = `whsec_${Buffer.alloc(32, 5).toString("base64")}`;
const substoSecret = `whsec_${Buffer.alloc(32, 7).toString("base64")}`;
const env = {
  NODE_ENV: "test" as const,
  SUBSTO_APP_HOSTS: "substo.example.com",
  CLERK_WEBHOOK_SECRET: estioSecret,
  SUBSTO_CLERK_WEBHOOK_SECRET: substoSecret,
  ESTIO_CLERK_INSTANCE_ID: "ins_estio_fixture",
  SUBSTO_CLERK_INSTANCE_ID: "ins_substo_fixture",
};

const userCreated = (instance: string) => JSON.stringify({
  object: "event", type: "user.created", instance_id: instance, timestamp: Date.now(),
  data: { id: "user_same", email_addresses: [{ email_address: "shared@example.com" }], public_metadata: { source: "team_invite", locationId: "loc_estio" } },
});

function request(body: string, options: { host: string; secret: string; id?: string }) {
  const id = options.id ?? "msg_fixture";
  const sentAt = new Date();
  return new Request(`https://${options.host}/api/webhooks/clerk`, {
    method: "POST",
    headers: {
      host: options.host, "content-type": "application/json", "svix-id": id,
      "svix-timestamp": String(Math.floor(sentAt.getTime() / 1000)),
      "svix-signature": new Webhook(options.secret).sign(id, sentAt, body),
    },
    body,
  });
}

const quiet = async <T>(run: () => Promise<T>) => {
  const original = console.error;
  console.error = () => undefined;
  try { return await run(); } finally { console.error = original; }
};

test("each realm verifies with its own secret and the realm comes from the host", async () => {
  const estio = await verifyClerkBusinessWebhook(request(userCreated("ins_estio_fixture"), { host: "estio.co", secret: estioSecret }), env);
  assert.ok(!(estio instanceof Response));
  assert.equal(estio.realm, "estio");
  assert.equal(estio.event.type, "user.created");

  const tenant = await verifyClerkBusinessWebhook(request(userCreated("ins_estio_fixture"), { host: "agency.example.org", secret: estioSecret }), env);
  assert.ok(!(tenant instanceof Response));
  assert.equal(tenant.realm, "estio");

  const substo = await verifyClerkBusinessWebhook(request(userCreated("ins_substo_fixture"), { host: "substo.example.com", secret: substoSecret }), env);
  assert.ok(!(substo instanceof Response));
  assert.equal(substo.realm, "substo");
});

test("an event signed by one realm is rejected on the other realm's host", async () => {
  const substoOnEstio = await quiet(() => verifyClerkBusinessWebhook(request(userCreated("ins_substo_fixture"), { host: "estio.co", secret: substoSecret }), env));
  assert.ok(substoOnEstio instanceof Response);
  assert.equal(substoOnEstio.status, 400);

  const estioOnSubsto = await quiet(() => verifyClerkBusinessWebhook(request(userCreated("ins_estio_fixture"), { host: "substo.example.com", secret: estioSecret }), env));
  assert.ok(estioOnSubsto instanceof Response);
  assert.equal(estioOnSubsto.status, 400);
});

test("a correctly signed event from another Clerk instance is rejected", async () => {
  const wrongInstance = await quiet(() => verifyClerkBusinessWebhook(request(userCreated("ins_substo_fixture"), { host: "estio.co", secret: estioSecret }), env));
  assert.ok(wrongInstance instanceof Response);
  assert.equal(wrongInstance.status, 400);
});

test("tampered bodies and missing Svix headers are rejected", async () => {
  const signed = request(userCreated("ins_estio_fixture"), { host: "estio.co", secret: estioSecret });
  const tampered = new Request(signed.url, { method: "POST", headers: signed.headers, body: userCreated("ins_estio_fixture").replace("shared@", "other@") });
  const result = await quiet(() => verifyClerkBusinessWebhook(tampered, env));
  assert.ok(result instanceof Response);
  assert.equal(result.status, 400);

  const unsigned = new Request("https://estio.co/api/webhooks/clerk", { method: "POST", headers: { host: "estio.co" }, body: "{}" });
  const missing = await verifyClerkBusinessWebhook(unsigned, env);
  assert.ok(missing instanceof Response);
  assert.equal(missing.status, 400);
});

test("shared or missing realm configuration fails closed", async () => {
  const shared = { ...env, SUBSTO_CLERK_WEBHOOK_SECRET: estioSecret };
  for (const host of ["estio.co", "substo.example.com"]) {
    const result = await quiet(() => verifyClerkBusinessWebhook(request(userCreated("ins_estio_fixture"), { host, secret: estioSecret }), shared));
    assert.ok(result instanceof Response);
    assert.equal(result.status, 503);
  }

  const noSubstoSecret = await quiet(() => verifyClerkBusinessWebhook(request(userCreated("ins_substo_fixture"), { host: "substo.example.com", secret: substoSecret }), { ...env, SUBSTO_CLERK_WEBHOOK_SECRET: "" }));
  assert.ok(noSubstoSecret instanceof Response);
  assert.equal(noSubstoSecret.status, 503);

  const noSubstoInstance = await quiet(() => verifyClerkBusinessWebhook(request(userCreated("ins_substo_fixture"), { host: "substo.example.com", secret: substoSecret }), { ...env, SUBSTO_CLERK_INSTANCE_ID: "" }));
  assert.ok(noSubstoInstance instanceof Response);
  assert.equal(noSubstoInstance.status, 503);

  const noEstioSecret = await quiet(() => verifyClerkBusinessWebhook(request(userCreated("ins_estio_fixture"), { host: "estio.co", secret: estioSecret }), { ...env, CLERK_WEBHOOK_SECRET: undefined }));
  assert.ok(noEstioSecret instanceof Response);
  assert.equal(noEstioSecret.status, 503);
});

test("legacy Estio configuration without instance or Substo settings keeps working", async () => {
  const legacy = { NODE_ENV: "test" as const, CLERK_WEBHOOK_SECRET: estioSecret };
  const result = await verifyClerkBusinessWebhook(request(userCreated("ins_anything"), { host: "estio.co", secret: estioSecret }), legacy);
  assert.ok(!(result instanceof Response));
  assert.equal(result.realm, "estio");
});

test("Substo events cannot create Business members or tenant contacts through the webhook", () => {
  assert.equal(realmAcceptsTeamInvites("estio"), true);
  assert.equal(realmHandlesTenantContacts("estio"), true);
  assert.equal(realmAcceptsTeamInvites("substo"), false);
  assert.equal(realmHandlesTenantContacts("substo"), false);
});
