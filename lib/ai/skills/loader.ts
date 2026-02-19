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

import { getModelForTask, estimateCost } from "../model-router";
import { callLLMWithMetadata } from "../llm";
import { toolRegistry } from "../mcp/registry";
import { SentimentResult } from "../sentiment";

export interface SkillExecutionContext {
    conversationId: string;
    contactId: string;
    locationId?: string;
    message: string;
    conversationHistory: string;
    intent: string;
    sentiment: SentimentResult;
    memories: any[]; // simplified type
    dealStage?: string;
    apiKey?: string;
    // Agent Identity (injected from User + Location + SiteConfig)
    agentName?: string;
    businessName?: string;
    websiteDomain?: string;
    brandVoice?: string;
    agentUserId?: string;
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
    llmCall?: {
        request: {
            model: string;
            systemPrompt: string;
            userPrompt: string;
            jsonMode: boolean;
            truncated: boolean;
        };
        response: {
            rawText: string;
            parsed: any;
            truncated: boolean;
        };
        usage: {
            promptTokens: number;
            completionTokens: number;
            totalTokens: number;
        };
    };
    error?: string;
}

const TRACE_TEXT_LIMIT = Number(process.env.AI_TRACE_TEXT_LIMIT || "12000");
const TRACE_FULL_PAYLOAD = process.env.AI_TRACE_FULL_PAYLOAD === "true";
const LOG_FULL_LLM_CALLS = process.env.AI_LOG_FULL_CALLS === "true";
const SAFE_TRACE_TEXT_LIMIT = Number.isFinite(TRACE_TEXT_LIMIT) && TRACE_TEXT_LIMIT > 0 ? TRACE_TEXT_LIMIT : 12000;

function truncateForTrace(text: string): { value: string; truncated: boolean } {
    if (TRACE_FULL_PAYLOAD) return { value: text, truncated: false };
    if (text.length <= SAFE_TRACE_TEXT_LIMIT) return { value: text, truncated: false };
    return { value: `${text.slice(0, SAFE_TRACE_TEXT_LIMIT)}\n...[truncated]`, truncated: true };
}

function resolvePlaceholderString(value: string, context: SkillExecutionContext): string {
    const normalized = value.trim().toLowerCase();
    const agentPlaceholders = new Set([
        "current_user",
        "current-agent",
        "current_agent",
        "assigned_agent",
        "agent",
        "agent_id",
    ]);
    const contactPlaceholders = new Set(["current_contact", "current_contact_id", "contact"]);
    const conversationPlaceholders = new Set(["current_conversation", "conversation"]);
    const locationPlaceholders = new Set(["current_location", "location_id", "location"]);

    if (agentPlaceholders.has(normalized) && context.agentUserId) return context.agentUserId;
    if (contactPlaceholders.has(normalized)) return context.contactId;
    if (conversationPlaceholders.has(normalized)) return context.conversationId;
    if (locationPlaceholders.has(normalized) && context.locationId) return context.locationId;
    return value;
}

function resolveToolArguments(value: any, context: SkillExecutionContext): any {
    if (Array.isArray(value)) return value.map(v => resolveToolArguments(v, context));
    if (value && typeof value === "object") {
        const out: Record<string, any> = {};
        for (const [k, v] of Object.entries(value)) {
            out[k] = resolveToolArguments(v, context);
        }
        return out;
    }
    if (typeof value === "string") return resolvePlaceholderString(value, context);
    return value;
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
        parameters: Object.keys(t.inputSchema || {})
    }));

    // 2. Build System Prompt
    const systemPrompt = `${skill.instructions}

## Available Tools
${JSON.stringify(toolDefinitions, null, 2)}

## Client Memory (Relevant Insights)
${context.memories.map((m: any) => `- [${m.category}] ${m.text}`).join("\n")}

## Agent Identity
- Agent Name: ${context.agentName ?? "Agent"}
- Business Name: ${context.businessName ?? "the agency"}
- Agent User ID: ${context.agentUserId ?? "unassigned"}
${context.websiteDomain ? `- Website: https://${context.websiteDomain}` : ""}
${context.brandVoice ? `- Brand Voice: ${context.brandVoice}` : ""}

You are "${context.agentName ?? "Agent"}" from "${context.businessName ?? "the agency"}". Always introduce yourself by name and business in your first message to a new lead.

## Current Context
- Contact ID: ${context.contactId}
- Conversation ID: ${context.conversationId}
- Location ID: ${context.locationId ?? "unknown"}
- Intent: ${context.intent}
- Sentiment: ${context.sentiment.emotion} (Readiness: ${context.sentiment.buyerReadiness})
- Deal Stage: ${context.dealStage ?? "N/A"}

IMPORTANT: When calling tools that require a contactId, use the exact Contact ID above ("${context.contactId}"). Do NOT use placeholder values like "current".
IMPORTANT: If a tool requires userId/agentUserId, use the exact Agent User ID above. Never use placeholders like "current_user".
IMPORTANT: If a tool requires locationId, use the exact Location ID above.

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
        const userPrompt = `Conversation History:\n${context.conversationHistory}\n\nLatest User Message: "${context.message}"`;
        const { text: response, usage } = await callLLMWithMetadata(
            modelId,
            systemPrompt,
            userPrompt,
            { jsonMode: true }
        );

        const parsed = JSON.parse(response);
        const isViewingSkill = skill.name === "coordinating-viewings";
        let plannedToolCalls = Array.isArray(parsed.tool_calls) ? [...parsed.tool_calls] : [];

        if (isViewingSkill) {
            const hasResolveCall = plannedToolCalls.some((c: any) => c?.name === "resolve_viewing_property_context");
            if (!hasResolveCall) {
                plannedToolCalls.unshift({
                    name: "resolve_viewing_property_context",
                    arguments: {
                        contactId: context.contactId,
                        conversationId: context.conversationId,
                        message: context.message
                    }
                });
            }

            // Enforce resolve call execution before calendar actions.
            const resolveCalls = plannedToolCalls.filter((c: any) => c?.name === "resolve_viewing_property_context");
            const otherCalls = plannedToolCalls.filter((c: any) => c?.name !== "resolve_viewing_property_context");
            plannedToolCalls = [...resolveCalls, ...otherCalls];
            parsed.tool_calls = plannedToolCalls;
        }

        console.log(`[SKILL:${skill.name}] LLM response keys:`, Object.keys(parsed));
        console.log(`[SKILL:${skill.name}] final_response:`, parsed.final_response?.substring(0, 100) || 'MISSING');
        console.log(`[SKILL:${skill.name}] draft_reply:`, parsed.draft_reply?.substring(0, 100) || 'MISSING');
        console.log(`[SKILL:${skill.name}] Raw response (first 500 chars):`, response.substring(0, 500));
        if (LOG_FULL_LLM_CALLS) {
            console.log(`[SKILL:${skill.name}] Full LLM call:`, JSON.stringify({
                model: modelId,
                request: { systemPrompt, userPrompt, jsonMode: true },
                response
            }, null, 2));
        }

        // 4. Trace Metadata construction
        const results = [];
        let viewingPrecheck: any = null;
        if (plannedToolCalls.length > 0) {
            for (const call of plannedToolCalls) {
                const tool = toolRegistry.find(t => t.name === call.name);
                const resolvedArgs = resolveToolArguments(call.arguments ?? {}, context);

                if (isViewingSkill && (call.name === "check_availability" || call.name === "propose_slots")) {
                    if (!viewingPrecheck || viewingPrecheck.resolutionStatus !== "resolved") {
                        results.push({
                            name: call.name,
                            args: resolvedArgs,
                            error: "Blocked: resolve_viewing_property_context must resolve one property before scheduling."
                        });
                        continue;
                    }

                    const mode = viewingPrecheck?.selectedProperty?.schedulePath?.mode;
                    if (mode && mode !== "DIRECT_SCHEDULE") {
                        results.push({
                            name: call.name,
                            args: resolvedArgs,
                            error: `Blocked: property requires ${mode.toLowerCase().replace(/_/g, " ")} before calendar scheduling.`
                        });
                        continue;
                    }
                }

                if (tool) {
                    try {
                        // Pass apiKey in context
                        const result = await tool.handler(resolvedArgs, {
                            apiKey: context.apiKey,
                            contactId: context.contactId,
                            conversationId: context.conversationId,
                            agentUserId: context.agentUserId,
                            locationId: context.locationId,
                            latestUserMessage: context.message
                        });
                        const parsedResultText = result?.content?.[0]?.text;
                        let parsedResult = result;
                        if (typeof parsedResultText === "string") {
                            try {
                                parsedResult = JSON.parse(parsedResultText);
                            } catch {
                                parsedResult = parsedResultText;
                            }
                        }
                        if (call.name === "resolve_viewing_property_context") {
                            viewingPrecheck = parsedResult;
                        }
                        results.push({ name: call.name, args: resolvedArgs, result: parsedResult });
                    } catch (e: any) {
                        results.push({ name: call.name, args: resolvedArgs, error: e.message });
                    }
                } else {
                    results.push({ name: call.name, args: resolvedArgs, error: "Tool not found or not allowed for this skill" });
                }
            }
        }

        const cost = estimateCost(modelId, usage.promptTokens, usage.completionTokens);
        const reqSystem = truncateForTrace(systemPrompt);
        const reqUser = truncateForTrace(userPrompt);
        const resRaw = truncateForTrace(response);
        const llmCall = {
            request: {
                model: modelId,
                systemPrompt: reqSystem.value,
                userPrompt: reqUser.value,
                jsonMode: true,
                truncated: reqSystem.truncated || reqUser.truncated
            },
            response: {
                rawText: resRaw.value,
                parsed,
                truncated: resRaw.truncated
            },
            usage: {
                promptTokens: usage.promptTokens,
                completionTokens: usage.completionTokens,
                totalTokens: usage.totalTokens
            }
        };

        return {
            modelUsed: modelId,
            thoughtSummary: parsed.thought_summary || "",
            thoughtSteps: parsed.thought_steps || [],
            toolCalls: results,
            draftReply: parsed.final_response || parsed.draft_reply || null,
            promptTokens: usage.promptTokens,
            completionTokens: usage.completionTokens,
            cost: cost,
            llmCall
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
