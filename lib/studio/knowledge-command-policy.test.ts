import { test } from "node:test";
import assert from "node:assert/strict";
import { readKnowledgeCommand } from "./knowledge-command-policy";
import { studioCommandResponse } from "./command-http";
import { StudioRestError } from "./rest-client";
const id = "D1500000-0000-4000-8000-000000000001";
const command = { requestId: id, action: "edit", version: 1, statement: "  Café example.\nExact wording 🌿  ", reason: "  Preserve this note.\n", topic: { mode: "keep" } };
test("knowledge commands preserve exact statements/notes and canonical request IDs", () => {
 const parsed = readKnowledgeCommand(command);
 assert.equal(parsed.statement, command.statement); assert.equal(parsed.reason, command.reason);
 assert.equal(parsed.requestId, id.toLowerCase()); assert.equal(parsed.version, 1);
});
test("approval explicitly assigns, creates or retains a topic without trusting a client principal", () => {
 assert.deepEqual(readKnowledgeCommand({ ...command, action: "approve", statement: null, topic: { mode: "existing", id }, userId: "forged" }).topic, { mode: "existing", id: id.toLowerCase() });
 assert.deepEqual(readKnowledgeCommand({ ...command, action: "approve", statement: null, topic: { mode: "create", name: "  AI methods  " } }).topic, { mode: "create", name: "AI methods" });
 assert.equal(Object.hasOwn(readKnowledgeCommand(command), "userId"), false);
});
test("unsupported actions, unbounded/empty wording, stale-shaped versions and inappropriate topic mutations reject", () => {
 for (const patch of [{ action: "delete" }, { version: 0 }, { version: 1.2 }, { version: "1" }, { requestId: "bad" },
  { statement: null }, { statement: " \n\t" }, { statement: "\u00a0\u2003" }, { statement: "x".repeat(4001) }, { statement: "x\0y" },
  { reason: "x".repeat(2001) }, { topic: null }, { topic: { mode: "existing", id } }]) assert.throws(() => readKnowledgeCommand({ ...command, ...patch }));
 for (const topic of [{ mode: "existing", id: "foreign-shape" }, { mode: "create", name: "" }, { mode: "create", name: "\nTopic" }, { mode: "create", name: "x".repeat(121) }]) assert.throws(() => readKnowledgeCommand({ ...command, action: "approve", topic }));
 assert.equal(readKnowledgeCommand({ ...command, action: "reopen", statement: null }).statement, null);
});
test("knowledge HTTP commands enforce own origin and bounded JSON; conflicts remain explicit", async () => {
 let writes = 0;
 const deps = { profile: async () => ({ origin: "https://substo.com" }), parse: readKnowledgeCommand, execute: async () => { writes++; return { version: 2 }; } };
 const req = (body: unknown, origin = "https://substo.com") => new Request("https://substo.com/studio/knowledge/api", { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
 assert.equal((await studioCommandResponse(req(command, "https://estio.co"), deps)).status, 403);
 assert.equal((await studioCommandResponse(req({ ...command, statement: "x".repeat(20000) }), deps)).status, 413);
 assert.equal(writes, 0);
 assert.equal((await studioCommandResponse(req(command), deps)).status, 200); assert.equal(writes, 1);
 assert.equal((await studioCommandResponse(req(command), { ...deps, execute: async () => { throw new StudioRestError(409, "40001"); } })).status, 409);
 assert.equal((await studioCommandResponse(req(command), { ...deps, profile: async () => null })).status, 401);
});
