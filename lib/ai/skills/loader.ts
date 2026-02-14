import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

// Helper to define what a Skill looks like in the registry (lightweight)
export interface SkillRegistryEntry {
    name: string;
    description: string;
}

// Helper to define loaded skill (heavyweight)
export interface LoadedSkill {
    name: string;
    description: string;
    instructions: string;
    tools?: string[];
}

const SKILLS_DIR = path.join(process.cwd(), 'lib/ai/skills');

export class SkillLoader {
    /**
     * Scans the skills directory and returns a registry of available skills.
     * Reads the YAML frontmatter from SKILL.md files.
     */
    static getRegistry(): SkillRegistryEntry[] {
        const registry: SkillRegistryEntry[] = [];

        if (!fs.existsSync(SKILLS_DIR)) {
            return registry;
        }

        const skillDirs = fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name);

        for (const dir of skillDirs) {
            const skillPath = path.join(SKILLS_DIR, dir, 'SKILL.md');
            if (fs.existsSync(skillPath)) {
                try {
                    const fileContent = fs.readFileSync(skillPath, 'utf-8');
                    const { data } = matter(fileContent);

                    if (data.name && data.description) {
                        registry.push({
                            name: data.name,
                            description: data.description
                        });
                    }
                } catch (e) {
                    console.error(`Failed to load skill from ${dir}`, e);
                }
            }
        }

        return registry;
    }

    /**
     * Loads the full instructions for a specific skill.
     */
    static loadSkill(skillName: string): LoadedSkill | null {
        // Security check: simple strict matching against registry scan or valid directory names
        // to prevent path traversal (though path.join is fairly safe, explicit check is better)
        const safeName = skillName.replace(/[^a-zA-Z0-9_-]/g, '');
        const skillPath = path.join(SKILLS_DIR, safeName, 'SKILL.md');

        if (!fs.existsSync(skillPath)) {
            return null;
        }

        try {
            const fileContent = fs.readFileSync(skillPath, 'utf-8');
            const { data, content } = matter(fileContent);

            return {
                name: data.name,
                description: data.description,
                instructions: content,
                tools: data.tools ?? [] // Load allowed tools list
            };
        } catch (e) {
            console.error(`Failed to load skill body for ${skillName}`, e);
            return null;
        }
    }
}

// ── EXECUTION LOGIC ─────────────────────────────────────────────────────────────

import { getModelForTask } from "../model-router";
import { callLLM } from "../llm";
import { toolRegistry } from "../mcp/registry";
import { SentimentResult } from "../sentiment";

export interface SkillExecutionContext {
    conversationId: string;
    contactId: string;
    message: string;
    conversationHistory: string;
    intent: string;
    sentiment: SentimentResult;
    memories: any[]; // simplified type
    dealStage?: string;
}

export interface SkillExecutionResult {
    modelUsed: string;
    thoughtSummary: string;
    thoughtSteps: any[];
    toolCalls: any[];
    draftReply: string | null;
    promptTokens: number;
    completionTokens: number;
    cost: number;
    error?: string;
}

/**
 * Execute a loaded skill against the current context.
 * This runs the "Specialist Agent" phase.
 */
export async function executeSkill(
    skill: LoadedSkill & { tools?: string[] },
    context: SkillExecutionContext
): Promise<SkillExecutionResult> {
    const modelId = getModelForTask(
        context.intent === "PRICE_NEGOTIATION" ? "negotiation" :
            context.intent === "QUALIFICATION" ? "qualification" : "draft_reply"
    );

    // 1. Filter Tools
    // Only expose tools that are explicitly listed in the skill's frontmatter
    // If no tools listed, expose none (or default set? For Phase 1 we'll be strict)
    const allowedToolNames = skill.tools || [];
    const allowedTools = toolRegistry.filter(t => allowedToolNames.includes(t.name));

    const toolDefinitions = allowedTools.map(t => ({
        name: t.name,
        description: t.description,
        parameters: t.inputSchema
    }));

    // 2. Build System Prompt
    const systemPrompt = `${skill.instructions}

## Available Tools
${JSON.stringify(toolDefinitions, null, 2)}

## Client Memory (Relevant Insights)
${context.memories.map((m: any) => `- [${m.category}] ${m.text}`).join("\n")}

## Current Context
- Intent: ${context.intent}
- Sentiment: ${context.sentiment.emotion} (Readiness: ${context.sentiment.buyerReadiness})
- Deal Stage: ${context.dealStage ?? "N/A"}

## Response Format
You must respond with valid JSON:
{
  "thought_summary": "One-line summary of your reasoning",
  "thought_steps": [
    { "step": 1, "description": "Analysis", "conclusion": "Outcome" }
  ],
  "tool_calls": [
    { "name": "tool_name", "arguments": { ... } }
  ],
  "final_response": "Draft text reply to the user (optional if just performing actions)"
}`;

    // 3. Call LLM
    try {
        const response = await callLLM(
            modelId,
            systemPrompt,
            `Conversation History:\n${context.conversationHistory}\n\nLatest User Message: "${context.message}"`,
            { jsonMode: true }
        );

        const parsed = JSON.parse(response);

        // 4. Trace Metadata construction
        // Note: We don't execute tools here (Orchestrator handles that? Or should we?)
        // The Phase 1 doc says "Dispatches tool calls via MCP registry (reusing logic from agent.ts)"
        // The Orchestrator code says `skillResult = await executeSkill(...)` and then logs `actions: skillResult.toolCalls`.
        // It implies `executeSkill` returns the *planned* tool calls, but maybe the orchestrator or this function executes them?
        // Re-reading doc: "Step 4: Route to Skill ... executeSkill ... actions: skillResult.toolCalls".
        // It seems Phase 1 focuses on *planning* the actions.
        // BUT `agent.ts` executes them.
        // If `executeSkill` is to replace `executeAgentTask`, it should probably execute them too.
        // Let's implement execution here to be self-contained.

        const results = [];
        if (parsed.tool_calls) {
            for (const call of parsed.tool_calls) {
                const tool = toolRegistry.find(t => t.name === call.name);
                if (tool) {
                    try {
                        const result = await tool.handler(call.arguments);
                        results.push({ name: call.name, args: call.arguments, result });
                    } catch (e: any) {
                        results.push({ name: call.name, args: call.arguments, error: e.message });
                    }
                } else {
                    results.push({ name: call.name, args: call.arguments, error: "Tool not found or not allowed for this skill" });
                }
            }
        }

        return {
            modelUsed: modelId,
            thoughtSummary: parsed.thought_summary || "",
            thoughtSteps: parsed.thought_steps || [],
            toolCalls: results, // These are executed results now
            draftReply: parsed.final_response,
            promptTokens: 0, // Placeholder
            completionTokens: 0, // Placeholder
            cost: 0 // Placeholder
        };

    } catch (e: any) {
        console.error(`Skill execution failed for ${skill.name}`, e);
        return {
            modelUsed: modelId,
            thoughtSummary: "Execution failed",
            thoughtSteps: [],
            toolCalls: [],
            draftReply: null,
            promptTokens: 0,
            completionTokens: 0,
            cost: 0,
            error: e.message
        };
    }
}
