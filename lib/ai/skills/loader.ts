import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { z } from "zod";

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
import { callLLMWithMetadata } from "../llm";
import { toolRegistry } from "../mcp/registry";
import { SentimentResult } from "../sentiment";
import { calculateRunCostFromUsage } from "../pricing";

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
            thoughtsTokens?: number;
            toolUsePromptTokens?: number;
        };
        costEstimate?: {
            method: string;
            confidence: string;
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

function isLocationPinRequest(message: string): boolean {
    return /\b(location|address|pin|map)\b/i.test(message) &&
        (/\b(send|share|drop|give)\b/i.test(message) || message.trim().length <= 80);
}

function extractResolvedPropertyFromToolResults(toolCalls: any[]): any | null {
    const resolveCall = toolCalls.find((c: any) =>
        c?.name === "resolve_viewing_property_context" &&
        c?.result?.resolutionStatus === "resolved" &&
        c?.result?.selectedProperty
    );
    return resolveCall?.result?.selectedProperty || null;
}

function extractSearchPropertyFromToolResults(toolCalls: any[]): any | null {
    const searchCall = toolCalls.find((c: any) =>
        c?.name === "search_properties" &&
        c?.result?.count > 0 &&
        Array.isArray(c?.result?.properties) &&
        c.result.properties.length > 0
    );
    return searchCall?.result?.properties?.[0] || null;
}

function inferViewingFollowUpQuestion(context: SkillExecutionContext): string | null {
    const history = context.conversationHistory || "";
    const lower = history.toLowerCase();
    const looksLikeViewingThread = /\bview(?:ing)?\b/.test(lower) || /\bavailable\b/.test(lower);
    if (!looksLikeViewingThread) return null;

    if (/\btomorrow\b/.test(lower)) {
        return "What time works best for you tomorrow to go and see it?";
    }

    return "What time works best for you to go and see it?";
}

function buildDeterministicLocationReply(context: SkillExecutionContext, toolCalls: any[]): string | null {
    if (!isLocationPinRequest(context.message)) return null;

    const resolvedProperty = extractResolvedPropertyFromToolResults(toolCalls);
    const searchedProperty = extractSearchPropertyFromToolResults(toolCalls);

    const googleMapsLink =
        resolvedProperty?.googleMapsLink ||
        resolvedProperty?.schedulingContext?.googleMapsLink ||
        searchedProperty?.googleMapsLink ||
        null;

    const fallbackLocationText =
        resolvedProperty?.locationAddress ||
        resolvedProperty?.location ||
        searchedProperty?.locationAddress ||
        searchedProperty?.propertyLocation ||
        searchedProperty?.city ||
        null;

    const followUpQuestion = inferViewingFollowUpQuestion(context);

    if (googleMapsLink) {
        const lines = [
            "Here's the location:",
            "",
            googleMapsLink
        ];
        if (followUpQuestion) {
            lines.push("", followUpQuestion);
        }
        return lines.join("\n");
    }

    if (fallbackLocationText) {
        const lines = [
            `It's in ${fallbackLocationText}.`
        ];
        if (followUpQuestion) {
            lines.push("", followUpQuestion);
        }
        return lines.join("\n");
    }

    return null;
}

async function synthesizeReplyFromToolResults(params: {
    modelId: string;
    skillName: string;
    context: SkillExecutionContext;
    initialDraft: string | null;
    thoughtSummary: string;
    toolCalls: any[];
}): Promise<{ draft: string | null; usage?: { promptTokens: number; completionTokens: number; totalTokens: number; thoughtsTokens: number; toolUsePromptTokens: number; cachedContentTokens: number; raw: string; } }> {
    const successfulToolCalls = params.toolCalls.filter((c: any) => c?.result && !c?.error);
    if (successfulToolCalls.length === 0) {
        return { draft: params.initialDraft ?? null };
    }

    const replyChangingTools = new Set([
        "search_properties",
        "resolve_viewing_property_context",
        "semantic_search",
        "recommend_similar",
        "check_availability",
        "propose_slots",
        "confirm_viewing",
        "create_viewing",
    ]);
    const hasReplyChangingToolResult = successfulToolCalls.some((c: any) => replyChangingTools.has(c?.name));
    if (!hasReplyChangingToolResult) {
        return { draft: params.initialDraft ?? null };
    }

    const deterministicLocationReply = buildDeterministicLocationReply(params.context, params.toolCalls);
    if (deterministicLocationReply) {
        return { draft: deterministicLocationReply };
    }

    const synthesisSystemPrompt = `You are a real estate CRM reply synthesizer.
Write the FINAL outbound message for the agent using the tool results that were just executed.

Rules:
- Answer the latest user message directly using the tool results.
- Do NOT say you are about to look something up if the tool results are already available.
- Do NOT repeat greetings or the contact's name in an ongoing thread unless this is clearly the first outbound message.
- Keep it conversational and practical.
- If the user asked for a location/pin/map/address and a Google Maps link is present in tool results, send the link immediately near the top.
- After sending a location for a viewing-related conversation, ask one short next-step scheduling question.
- Output only the message text (no JSON, no labels).`;

    const toolResultsJson = JSON.stringify(params.toolCalls, null, 2);
    const toolResultsTrimmed = toolResultsJson.length > 12000
        ? `${toolResultsJson.slice(0, 12000)}\n...[truncated tool results]`
        : toolResultsJson;

    const synthesisUserPrompt = `Skill: ${params.skillName}
Thought Summary: ${params.thoughtSummary || "N/A"}

Conversation History:
${params.context.conversationHistory}

Latest User Message:
"${params.context.message}"

Initial Draft (pre-tool; may be incomplete):
${params.initialDraft || "null"}

Executed Tool Results:
${toolResultsTrimmed}

Write the final message the agent should send now.`;

    try {
        const { text, usage } = await callLLMWithMetadata(
            params.modelId,
            synthesisSystemPrompt,
            synthesisUserPrompt,
            { jsonMode: false }
        );
        return { draft: text?.trim() || params.initialDraft || null, usage };
    } catch (e) {
        console.warn(`[SKILL:${params.skillName}] Post-tool synthesis failed, falling back to initial draft`, e);
        return { draft: params.initialDraft ?? null };
    }
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

function describeZodField(field: any): any {
    if (!field) return { type: "unknown" };

    if (field instanceof z.ZodOptional || field instanceof z.ZodNullable || field instanceof z.ZodDefault) {
        const inner = describeZodField((field as any)._def.innerType);
        return { ...inner, optional: true };
    }
    if (field instanceof z.ZodString) return { type: "string" };
    if (field instanceof z.ZodNumber) return { type: "number" };
    if (field instanceof z.ZodBoolean) return { type: "boolean" };
    if (field instanceof z.ZodEnum) return { type: "enum", values: field.options };
    if (field instanceof z.ZodArray) return { type: "array", items: describeZodField(field.element) };
    if (field instanceof z.ZodObject) return { type: "object", properties: describeToolSchema((field as any).shape) };
    if (field instanceof z.ZodUnion) return { type: "union", options: ((field as any)._def.options || []).map(describeZodField) };

    return { type: "unknown" };
}

function describeToolSchema(schema: Record<string, any>): Record<string, any> {
    const description: Record<string, any> = {};
    for (const [key, value] of Object.entries(schema || {})) {
        description[key] = describeZodField(value);
    }
    return description;
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
        parameters: describeToolSchema(t.inputSchema || {})
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

You are "${context.agentName ?? "Agent"}" from "${context.businessName ?? "the agency"}".
Introduce yourself by name and business only in your first outbound message to a new lead.
In ongoing conversations, do NOT repeat your introduction or the contact's name in every message.
Always answer the latest user message first before adding extra context.

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

        const synthesized = await synthesizeReplyFromToolResults({
            modelId,
            skillName: skill.name,
            context,
            initialDraft: parsed.final_response || parsed.draft_reply || null,
            thoughtSummary: parsed.thought_summary || "",
            toolCalls: results
        });

        const initialDraft = parsed.final_response || parsed.draft_reply || null;
        const finalDraft = synthesized.draft ?? initialDraft;
        if (finalDraft && finalDraft !== initialDraft) {
            parsed.post_tool_final_response = finalDraft;
        }

        const aggregatedUsage = {
            promptTokens: usage.promptTokens + (synthesized.usage?.promptTokens || 0),
            completionTokens: usage.completionTokens + (synthesized.usage?.completionTokens || 0),
            totalTokens: usage.totalTokens + (synthesized.usage?.totalTokens || 0),
            thoughtsTokens: (usage.thoughtsTokens || 0) + (synthesized.usage?.thoughtsTokens || 0),
            toolUsePromptTokens: (usage.toolUsePromptTokens || 0) + (synthesized.usage?.toolUsePromptTokens || 0)
        };

        const costEstimate = calculateRunCostFromUsage(modelId, {
            promptTokens: aggregatedUsage.promptTokens,
            completionTokens: aggregatedUsage.completionTokens,
            totalTokens: aggregatedUsage.totalTokens,
            thoughtsTokens: aggregatedUsage.thoughtsTokens,
            toolUsePromptTokens: aggregatedUsage.toolUsePromptTokens
        });
        const cost = costEstimate.amount;
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
                promptTokens: aggregatedUsage.promptTokens,
                completionTokens: aggregatedUsage.completionTokens,
                totalTokens: aggregatedUsage.totalTokens,
                thoughtsTokens: aggregatedUsage.thoughtsTokens,
                toolUsePromptTokens: aggregatedUsage.toolUsePromptTokens
            },
            costEstimate: {
                method: costEstimate.method,
                confidence: costEstimate.confidence
            }
        };

        return {
            modelUsed: modelId,
            thoughtSummary: parsed.thought_summary || "",
            thoughtSteps: parsed.thought_steps || [],
            toolCalls: results,
            draftReply: finalDraft,
            promptTokens: aggregatedUsage.promptTokens,
            completionTokens: aggregatedUsage.completionTokens,
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
