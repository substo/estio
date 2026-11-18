import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import matter from "gray-matter";
import ts from "typescript";
import { z } from "zod";
import * as communicationPolicy from "../prompts/communication-policy";
import type { LoadedSkill, SkillExecutionContext } from "./loader";

// Run the actual loader module with an isolated registry and LLM, following the
// existing VM harness pattern. No production tool imports or provider calls run.
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, "loader.ts"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }
}).outputText;

const context: SkillExecutionContext = {
    conversationId: "fixture-conversation", contactId: "fixture-contact",
    locationId: "fixture-location", agentUserId: "fixture-agent",
    message: "Thanks", conversationHistory: "", intent: "QUALIFICATION",
    sentiment: { emotion: "neutral", buyerReadiness: "cold", score: 0, urgency: "low" },
    memories: []
};

function skill(overrides: Partial<LoadedSkill> = {}): LoadedSkill {
    return { name: "fixture-skill", description: "Permission test", instructions: "Fixture", ...overrides };
}

function fixture(toolCalls: Array<{ name: string; arguments?: Record<string, unknown> }>, resolution = "resolved", mode = "DIRECT_SCHEDULE") {
    const invoked: Array<{ name: string; args: any; context: any }> = [];
    let promptTools: string[] = [];
    const llmCalls: Array<{ model: string; options: any }> = [];
    const registry = ["declared", "required", "undeclared", "resolve_viewing_property_context", "check_availability", "propose_slots"].map(name => ({
        name, description: name, inputSchema: {},
        handler: async (args: any, handlerContext: any) => {
            invoked.push({ name, args, context: handlerContext });
            return { content: [{ text: JSON.stringify(name === "resolve_viewing_property_context"
                ? { resolutionStatus: resolution, selectedProperty: { schedulePath: { mode } } }
                : { ok: true }) }] };
        }
    }));
    const dependencies: Record<string, unknown> = {
        fs, path, "gray-matter": matter, zod: { z },
        "../model-router": { getModelForTask: () => "fixture-model" },
        "../mcp/registry": { toolRegistry: registry },
        "../prompts/communication-policy": communicationPolicy,
        "../pricing": { calculateRunCostFromUsage: () => ({ amount: 0, method: "fixture", confidence: "high" }) },
        "../llm": { callLLMWithMetadata: async (_model: string, system: string, _user: string, options: { jsonMode: boolean }) => {
            llmCalls.push({ model: _model, options });
            if (options.jsonMode) {
                promptTools = JSON.parse(system.split("## Available Tools\n")[1].split("\n\n## Client Memory")[0]).map((tool: any) => tool.name);
            }
            return {
                text: options.jsonMode ? JSON.stringify({ tool_calls: toolCalls, final_response: "Fixture reply" }) : "Fixture reply",
                provider: "google_gemini",
                model: "actual-provider-model", fundingScope: "location_api", executionMode: "interactive",
                usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
            };
        } }
    };
    const module = { exports: {} as any };
    vm.runInNewContext(code, {
        module, exports: module.exports, process: { cwd: () => process.cwd(), env: {} },
        console: { log() {}, warn() {}, error() {} },
        require: (name: string) => {
            assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
            return dependencies[name];
        }
    });
    return { execute: module.exports.executeSkill, loader: module.exports.SkillLoader, invoked, llmCalls, promptTools: () => promptTools };
}

test("selected interactive model reaches planning and tool-result synthesis; traces retain actual route", async () => {
    const f = fixture([{ name: "propose_slots" }]);
    const result = await f.execute(skill({ tools: ["propose_slots"] }), {
        ...context, textExecution: { model: "selected-model", executionMode: "interactive" }
    });
    assert.equal(f.llmCalls.length, 2);
    for (const call of f.llmCalls) {
        assert.equal(call.model, "selected-model");
        assert.equal(call.options.executionMode, "interactive");
        assert.equal(call.options.locationId, context.locationId);
    }
    assert.equal(result.modelUsed, "actual-provider-model");
    assert.equal(result.fundingScope, "location_api");
    assert.ok(result.llmCall.executions.every((call: any) => call.requestedModel === "selected-model" && call.model === "actual-provider-model"));
});

test("executeSkill blocks registered undeclared and hallucinated tools without invoking handlers", async () => {
    const f = fixture([{ name: "undeclared" }, { name: "hallucinated" }, { name: "declared" }, { name: "required" }]);
    const result = await f.execute(skill({ tools: ["declared"], requiredTools: ["required", "declared"] }), context);
    assert.deepEqual(f.promptTools(), ["declared", "required"]);
    assert.deepEqual(f.invoked.map(call => call.name), ["declared", "required"]);
    assert.equal(result.toolCalls.length, 4);
    for (const call of result.toolCalls.slice(0, 2)) {
        assert.match(call.error, /Blocked: tool is not declared for this skill or is unavailable/);
        assert.equal(call.result, undefined);
    }
    assert.equal(result.toolCalls[2].result.ok, true);
    assert.equal(result.toolCalls[3].result.ok, true);
});

test("skills with absent or empty declarations expose and execute no tools", async () => {
    for (const declarations of [{}, { tools: [], requiredTools: [] }]) {
        const f = fixture([{ name: "undeclared" }]);
        const result = await f.execute(skill(declarations), context);
        assert.deepEqual(f.promptTools(), []);
        assert.equal(f.invoked.length, 0);
        assert.match(result.toolCalls[0].error, /Blocked: tool is not declared/);
    }
});

test("loaded viewing declarations authorize injected resolver before scheduling", async () => {
    const f = fixture([{ name: "check_availability", arguments: { userId: "current_user" } }]);
    const loaded = f.loader.loadSkill("viewing_management");
    assert.ok(loaded.tools.includes("resolve_viewing_property_context"));
    assert.ok(loaded.requiredTools.includes("resolve_viewing_property_context"));
    assert.ok(loaded.tools.every((name: string) => loaded.requiredTools.includes(name)), "loadSkill preserves requiredTools merge");
    const result = await f.execute(loaded, context);
    assert.deepEqual(f.invoked.map(call => call.name), ["resolve_viewing_property_context", "check_availability"]);
    assert.equal(f.invoked[1].args.userId, context.agentUserId);
    assert.equal(f.invoked[1].context.locationId, context.locationId);
    assert.ok(result.toolCalls.every((call: any) => !call.error));
});

test("requiredTools alone authorizes injected viewing preflight; scheduling preconditions remain enforced", async () => {
    for (const [resolution, mode, expectedError] of [
        ["ambiguous", "DIRECT_SCHEDULE", /must resolve one property/],
        ["resolved", "OWNER_APPROVAL", /requires owner approval/]
    ] as const) {
        const f = fixture([{ name: "check_availability" }, { name: "propose_slots" }], resolution, mode);
        const result = await f.execute(skill({
            name: "coordinating-viewings", tools: ["check_availability", "propose_slots"],
            requiredTools: ["resolve_viewing_property_context"]
        }), context);
        assert.deepEqual(f.invoked.map(call => call.name), ["resolve_viewing_property_context"]);
        assert.match(result.toolCalls[1].error, expectedError);
        assert.match(result.toolCalls[2].error, expectedError);
    }
});

test("viewing injection never grants an undeclared resolver permission", async () => {
    const f = fixture([{ name: "check_availability" }]);
    const result = await f.execute(skill({ name: "coordinating-viewings", tools: ["check_availability"] }), context);
    assert.equal(f.invoked.length, 0);
    assert.match(result.toolCalls[0].error, /Blocked: tool is not declared/);
    assert.match(result.toolCalls[1].error, /must resolve one property/);
});

test("automatic requested-time availability lookup obeys the same skill permissions", async () => {
    for (const authorized of [false, true]) {
        const f = fixture([]);
        const result = await f.execute(skill({
            name: "coordinating-viewings", tools: ["resolve_viewing_property_context"],
            requiredTools: authorized ? ["check_availability"] : []
        }), { ...context, message: "Can I view tomorrow at 3pm?", conversationHistory: "User: I'd like a property viewing." });
        assert.deepEqual(f.invoked.map(call => call.name), authorized
            ? ["resolve_viewing_property_context", "check_availability"] : ["resolve_viewing_property_context"]);
        const automatic = result.toolCalls.find((call: any) => call.name === "check_availability");
        assert.equal(automatic.synthetic, true);
        if (authorized) assert.equal(automatic.result.ok, true);
        else assert.match(automatic.error, /Blocked: tool is not declared/);
    }
});
