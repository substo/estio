import { fixtureDb } from "../studio/testing/fixture-db";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Webhook } from "svix";
import { clerkProfileWebhookResponse, type ProfileDeletionCommand } from "./clerk-profile-webhook";
import { isPlatformProfileDeleted } from "./profile-lifecycle";
import { authorizeEstioSchedule } from "../studio/schedule-authority";
const estioSecret = `whsec_${Buffer.alloc(32, 3).toString("base64")}`;
const substoSecret = `whsec_${Buffer.alloc(32, 9).toString("base64")}`;
const env = { NODE_ENV: "test" as const, SUBSTO_APP_HOSTS: "studio.example.com", ESTIO_CLERK_PROFILE_WEBHOOK_SECRET: estioSecret,
 SUBSTO_CLERK_PROFILE_WEBHOOK_SECRET: substoSecret, ESTIO_CLERK_INSTANCE_ID: "ins_estio_fixture", SUBSTO_CLERK_INSTANCE_ID: "ins_substo_fixture" };
const event = (realm = "substo") => ({ object: "event", instance_id: realm === "substo" ? "ins_substo_fixture" : "ins_estio_fixture", type: "user.deleted", timestamp: Date.now() - 3600000,
 data: { id: "user_same_id", object: "user", deleted: true } });
function request(body: string, options: { host?: string; secret?: string; sentAt?: Date; id?: string } = {}) {
 const host = options.host ?? "studio.example.com"; const id = options.id ?? "msg_fixture"; const sentAt = options.sentAt ?? new Date();
 return new Request(`https://${host}/api/webhooks/clerk-profile`, { method: "POST", headers: { host, "Content-Type": "application/json", "svix-id": id,
  "svix-timestamp": String(Math.floor(sentAt.getTime() / 1000)), "svix-signature": new Webhook(options.secret ?? substoSecret).sign(id, sentAt, body) }, body });
}
test("real Svix signatures verify exact raw bytes and bind host/instance, not payload realm or email", async () => {
 const commands: ProfileDeletionCommand[] = [];
 const cleanup = async (c: ProfileDeletionCommand) => { commands.push(c); };
 const body = JSON.stringify({ ...event(), brand: "estio", data: { ...event().data, email: "shared@example.com", external_id: "wrong-id" } }, null, 2);
 assert.equal((await clerkProfileWebhookResponse(request(body), { env, cleanup })).status, 200);
 assert.equal(commands[0].brand, "substo"); assert.equal(commands[0].userId, "user_same_id"); assert.equal(commands[0].bodyDigest.length, 64);
 assert.equal(Object.hasOwn(commands[0], "email"), false);
 assert.equal((await clerkProfileWebhookResponse(request(JSON.stringify(event("estio")), { host: "estio.co", secret: estioSecret }), { env, cleanup })).status, 200);
 assert.equal(commands[1].brand, "estio"); assert.equal(commands[1].userId, commands[0].userId);
});
test("cross-realm secrets/instances, stale signatures, tampered bodies and malformed deletion data never clean up", async () => {
 let calls = 0; const cleanup = async () => { calls++; };
 const body = JSON.stringify(event());
 for (const req of [request(body, { host: "estio.co" }), request(body, { host: "estio.co", secret: estioSecret }), request(body, { sentAt: new Date(Date.now() - 600000) }),
  request(JSON.stringify({ ...event(), data: { ...event().data, deleted: false } })), request(JSON.stringify({ ...event(), data: { ...event().data, id: undefined } })),
  request(JSON.stringify({ ...event(), timestamp: Date.now() + 3600000 }))]) {
  assert.equal((await clerkProfileWebhookResponse(req, { env, cleanup })).status, 400);
 }
 const signed = request(body); const headers = new Headers(signed.headers);
 assert.equal((await clerkProfileWebhookResponse(new Request(signed.url, { method: "POST", headers, body: body + " " }), { env, cleanup })).status, 400);
 assert.equal(calls, 0);
});
test("missing/reused signing configuration, unknown hosts and oversized payloads fail closed", async () => {
 let calls = 0; const cleanup = async () => { calls++; }; const body = JSON.stringify(event());
 for (const patch of [{ SUBSTO_CLERK_PROFILE_WEBHOOK_SECRET: undefined }, { SUBSTO_CLERK_INSTANCE_ID: undefined },
  { SUBSTO_CLERK_PROFILE_WEBHOOK_SECRET: estioSecret }, { SUBSTO_CLERK_INSTANCE_ID: env.ESTIO_CLERK_INSTANCE_ID }, { SUBSTO_CLERK_PROFILE_WEBHOOK_SECRET: "whsec_" }]) {
  assert.equal((await clerkProfileWebhookResponse(request(body), { env: { ...env, ...patch }, cleanup })).status, 503);
 }
 assert.equal((await clerkProfileWebhookResponse(request(body, { host: "customer.example" }), { env, cleanup })).status, 404);
 assert.equal((await clerkProfileWebhookResponse(request("x".repeat(65537)), { env, cleanup })).status, 413);
 assert.equal(calls, 0);
});
test("unrelated verified events are ignored; storage failures return retryable failure and exact event identity survives retries", async () => {
 let calls = 0; const commands: ProfileDeletionCommand[] = []; const body = JSON.stringify(event());
 const cleanup = async (c: ProfileDeletionCommand) => { commands.push(c); calls++; if (calls === 1) throw Error("Storage unavailable"); };
 assert.equal((await clerkProfileWebhookResponse(request(JSON.stringify({ ...event(), type: "user.updated" })), { env, cleanup })).status, 200);
 assert.equal(calls, 0);
 assert.equal((await clerkProfileWebhookResponse(request(body), { env, cleanup })).status, 503);
 assert.equal((await clerkProfileWebhookResponse(request(body), { env, cleanup })).status, 200);
 assert.deepEqual(commands[0], commands[1]);
});
test("deleted-profile reads are realm/user scoped and stop unattended Estio checks before Business access", async () => {
 const reads: string[] = [];
 const read = async <T>(path: string) => { reads.push(path); return [{ clerk_user_id: "user_same_id" }] as T; };
 assert.equal(await isPlatformProfileDeleted(fixtureDb(read), "substo", "user_same_id"), true);
 const q = new URLSearchParams(reads[0].split("?")[1]); assert.equal(q.get("app"), "eq.substo"); assert.equal(q.get("clerk_user_id"), "eq.user_same_id");
 let checks = 0;
 assert.equal(await authorizeEstioSchedule(fixtureDb(read), "workspace", "user_same_id", async () => { checks++; return true; }), false);
 assert.equal(checks, 0); assert.equal(reads.length, 2);
 await assert.rejects(isPlatformProfileDeleted(fixtureDb(async () => { throw Error("Storage unavailable"); }), "estio", "user_same_id"));
});
