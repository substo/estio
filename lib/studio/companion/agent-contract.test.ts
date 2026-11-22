import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { createSubscriptionTextRunHandler } from "./text-run";
import { createLocalTextAdapter, type LocalProvider } from "./providers";
import { defaultDeviceConfig, safeDeviceCapabilities } from "../devices-policy";
import { agentInstructionsV1 } from "../agent-policy-v1";
import { agentInstructionsV2 } from "../agent-policy-v2";
import { agentInstructionsV3 } from "../agent-policy-v3";
import { AGENT_PROMPT, AGENT_PROMPT_V1, AGENT_PROMPT_V2, AGENT_PROMPT_V3, agentInstructions } from "../agent-policy";
import { scriptBriefSpecFor } from "../worker/script-brief";

// Old vs new companion contract for the conversational agent, through the real native adapter with a fake CLI process.
const id = "ac000000-0000-4000-8000-000000000009";
const config = { ...defaultDeviceConfig, features: { text: true, transcription: false }, textProvider: "codex" as const, textModel: "test-model" };
const context = { workerId: "test", signal: new AbortController().signal };
const usage = async () => ({ codex: { remaining: 80, windows: [], at: new Date().toISOString() } });
const help = "--ignore-user-config --ignore-rules --ephemeral --output-schema --json";
const v1Snapshot = { mode: "studio_agent", focus: "", operation: { turnId: id, round: 1, maxRounds: 4, mustReply: false }, message: "Write the script, about 6 minutes", conversation: [], decisions: [], plan: [],
  draft: { stages: {}, legacyDirection: null, brief: "" }, sources: [], profile: null, observations: [], ideas: [] };
const v2Snapshot = { ...v1Snapshot, length: { targetSeconds: 360, targetWords: 900, minWords: 765, maxWords: 1035, beyondSupported: false }, scriptLimits: { maxWords: 1200, maxChars: 9000, maxSeconds: 480, wordsPerMinute: 150 } };
const v3Snapshot = { ...v2Snapshot, contract: 3 };
const v4Snapshot = { ...v2Snapshot, contract: 4, audience: [], selection: null };
const script = (chars: number, v4 = false) => ({ step: "reply", tool: null, reply: "Here is the script.", choices: [], decisions: [], plan: [], ...(v4 ? { research: null } : {}),
  proposals: [{ stage: "Script", text: "word ".repeat(Math.floor(chars / 5)), rationale: "Six minutes.", evidenceIds: [], verify: [], ...(v4 ? { replaces: null } : {}) }] });
const jobFor = (promptVersion: string, snapshot: unknown) => ({ id, location_id: "tenant", kind: "studio.text_run", payload: { reviewId: id, workflow: "script_brief", promptVersion, snapshot, provider: "codex", model: "test-model", configVersion: 2 },
  lease_token: id, attempts: 1, max_attempts: 1 } as never);

function companion(reply: unknown, seen: { prompt?: string } = {}) {
  const adapter = createLocalTextAdapter("codex", async request => {
    if (request.args[0] === "--version") return { stdout: "codex-cli 0.171.0", stderr: "" };
    if (request.args.includes("--help")) return { stdout: help, stderr: "" };
    if (request.args[0] === "login") return { stdout: "Logged in using ChatGPT", stderr: "" };
    seen.prompt = request.input;
    return { stdout: [{ type: "item.completed", item: { type: "agent_message", text: JSON.stringify(reply) } }, { type: "turn.completed" }].map(e => JSON.stringify(e)).join("\n"), stderr: "" };
  });
  return createSubscriptionTextRunHandler({ adapter: (_: LocalProvider) => adapter, usage, enabled: () => true, config: () => config, configVersion: () => 2 });
}

test("the new companion runs a v4 round and accepts a realistic multi-minute script through the native adapter", async () => {
  const seen: { prompt?: string } = {};
  const big = script(6000, true);                                                           // far over the old 4,000-character limit, about 1,200 characters per minute
  const result = await companion(big, seen)(jobFor(AGENT_PROMPT, v4Snapshot), context);
  assert.ok((result.output as typeof big).proposals[0].text.length > 5990);
  assert.match(seen.prompt!, /150 words per minute/);                                // the CLI is given the v2 instructions
  assert.match(seen.prompt!, /snapshot\.length/);
  assert.match(seen.prompt!, /Part 1 of N/);
  assert.match(seen.prompt!, /CREATIVE PRIORITY/);                                   // the creative rules reach the CLI
  assert.match(seen.prompt!, /search_knowledge/);                                    // and the v4 research tool
  assert.match(seen.prompt!, /SELECTION PATCH/);
  assert.ok(seen.prompt!.includes(agentInstructions));
});

test("rounds stored under v3 keep their frozen prompt, schema and validator on the new companion", async () => {
  assert.equal(createHash("sha256").update(agentInstructionsV3).digest("hex"), "280159fa560e8341d2b0efc0f8c056bb6ed491c73ef1ff8b7d5858b22ec91c01");   // byte-identical to the live v3 prompt
  const seen: { prompt?: string } = {};
  await companion(script(5000), seen)(jobFor(AGENT_PROMPT_V3, v3Snapshot), context);
  assert.ok(seen.prompt!.includes(agentInstructionsV3));
  assert.ok(!/search_knowledge|SELECTION PATCH/.test(seen.prompt!), "v3 rounds do not silently get v4 tools");
  await assert.rejects(companion(script(5000, true))(jobFor(AGENT_PROMPT_V3, v3Snapshot), context), /Automatic replay stopped/);   // a v4-shaped reply is not valid under v3
  assert.equal(scriptBriefSpecFor(v3Snapshot).promptVersion, AGENT_PROMPT_V3);
  assert.equal(scriptBriefSpecFor(v4Snapshot).promptVersion, AGENT_PROMPT);
});

test("rounds stored under v2 keep its frozen prompt (no v3 guidance) and its validator on the new companion", async () => {
  assert.equal(createHash("sha256").update(agentInstructionsV2).digest("hex"), "8961f25ff9c1bb374be0d9253a2bf239999e17cb09f7b77ba7cef9d77e7f0027");   // byte-identical to the live v2 prompt
  const seen: { prompt?: string } = {};
  const out = await companion(script(6000), seen)(jobFor(AGENT_PROMPT_V2, v2Snapshot), context);
  assert.ok((out.output as { proposals: Array<{ text: string }> }).proposals[0].text.length > 5990);
  assert.ok(seen.prompt!.includes(agentInstructionsV2));
  assert.ok(!/CREATIVE PRIORITY/.test(seen.prompt!), "v2 rounds do not silently get the v3 rules");
  assert.equal(scriptBriefSpecFor(v2Snapshot, AGENT_PROMPT_V2).promptVersion, AGENT_PROMPT_V2);
  assert.equal(scriptBriefSpecFor(v2Snapshot).promptVersion, AGENT_PROMPT_V2);
});

test("rounds stored under the first contract keep its exact prompt and 4,000-character validator on the new companion", async () => {
  assert.equal(createHash("sha256").update(agentInstructionsV1).digest("hex"), "2d3c7faf93bfc2a6fe88657397947d077b7142e06b10ae2dfaa78b7232207ae3");   // byte-identical to the deployed v1 prompt
  const seen: { prompt?: string } = {};
  await companion(script(3000), seen)(jobFor(AGENT_PROMPT_V1, v1Snapshot), context);   // legacy rounds still execute
  assert.ok(seen.prompt!.includes(agentInstructionsV1));
  assert.ok(!/150 words per minute/.test(seen.prompt!), "the v1 prompt has no duration contract");
  await assert.rejects(companion(script(6000))(jobFor(AGENT_PROMPT_V1, v1Snapshot), context), /Automatic replay stopped/);   // the old validator still refuses > 4,000
  assert.equal(scriptBriefSpecFor(v1Snapshot, AGENT_PROMPT_V1).promptVersion, AGENT_PROMPT_V1);
  assert.equal(scriptBriefSpecFor(v2Snapshot, AGENT_PROMPT).promptVersion, AGENT_PROMPT);
});

test("a job stamped with a contract the process does not implement stops before any model call (what an older companion does with a v3 round)", async () => {
  let called = false;
  const spy = createSubscriptionTextRunHandler({ adapter: () => { called = true; throw new Error("must not run"); }, usage, enabled: () => true, config: () => config, configVersion: () => 2 });
  await assert.rejects(spy(jobFor("studio.agent.v9", v4Snapshot), context), (e: Error & { code?: string }) => e.code === "text_run_version_unsupported");
  assert.equal(called, false);
});

test("the heartbeat capability whitelist reports version 1 to 4 and nothing else, so SQL pins on a real value", () => {
  assert.equal(safeDeviceCapabilities({ studioAgentVersion: 2 }).studioAgentVersion, 2);
  assert.equal(safeDeviceCapabilities({ studioAgentVersion: 1 }).studioAgentVersion, 1);
  assert.equal(safeDeviceCapabilities({ studioAgentVersion: 3 }).studioAgentVersion, 3);
  assert.equal(safeDeviceCapabilities({ studioAgentVersion: 4 }).studioAgentVersion, 4);
  assert.equal(safeDeviceCapabilities({ studioAgentVersion: 5 }).studioAgentVersion, undefined);
  assert.equal(safeDeviceCapabilities({ studioAgentVersion: "2" }).studioAgentVersion, undefined);
});
