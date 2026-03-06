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
import {
    buildDealProtectiveCommunicationContract,
    resolveCommunicationLanguage
} from "../prompts/communication-policy";

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
    contactPreferredLanguage?: string | null;
    latestInboundText?: string | null;
    expectedReplyLanguage?: string | null;
    latestInboundLanguage?: string | null;
    threadDefaultLanguage?: string | null;
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

const WEEKDAY_TO_INDEX: Record<string, number> = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
};

function looksLikeViewingThread(conversationHistory: string): boolean {
    const lower = (conversationHistory || "").toLowerCase();
    return /\bview(?:ing)?\b/.test(lower) ||
        /\bref\.?\s*no\b/.test(lower) ||
        /\b[A-Z]{2,4}\d{3,6}\b/i.test(conversationHistory || "") ||
        /\bproperty\b/.test(lower);
}

function extractProposedClockTime(message: string): { hour24: number; minute: number } | null {
    const amPmMatch = message.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
    if (amPmMatch) {
        let hour = Number(amPmMatch[1]);
        const minute = Number(amPmMatch[2] || "0");
        const meridiem = amPmMatch[3].toLowerCase();
        if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute < 0 || minute > 59) return null;
        if (hour < 1 || hour > 12) return null;
        if (meridiem === "am") {
            if (hour === 12) hour = 0;
        } else if (hour !== 12) {
            hour += 12;
        }
        return { hour24: hour, minute };
    }

    const twentyFourHourMatch = message.match(/\b(\d{1,2}):(\d{2})\b/);
    if (twentyFourHourMatch) {
        const hour = Number(twentyFourHourMatch[1]);
        const minute = Number(twentyFourHourMatch[2]);
        if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
        if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
        return { hour24: hour, minute };
    }

    return null;
}

function isSchedulingFollowOnMessage(message: string): boolean {
    return /\b(i will call|will call you|i'll call|ok|okay|sure|great)\b/i.test(message || "");
}

function extractRecentUserProposedClockTime(conversationHistory: string): { hour24: number; minute: number } | null {
    const lines = (conversationHistory || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .reverse();

    for (const line of lines) {
        if (!/^user:/i.test(line)) continue;
        const parsed = extractProposedClockTime(line);
        if (parsed) return parsed;
    }

    return null;
}

function inferRequestedDayAnchor(context: SkillExecutionContext): { date: Date; label: "today" | "tomorrow" | null } | null {
    const combined = `${context.message}\n${context.conversationHistory || ""}`.toLowerCase();
    const now = new Date();

    if (/\btomorrow\b/.test(combined)) {
        const date = new Date(now);
        date.setDate(date.getDate() + 1);
        return { date, label: "tomorrow" };
    }

    if (/\btoday\b/.test(combined)) {
        return { date: new Date(now), label: "today" };
    }

    let bestMatch: { index: number; weekday: number } | null = null;
    for (const [name, weekday] of Object.entries(WEEKDAY_TO_INDEX)) {
        const idx = combined.lastIndexOf(name);
        if (idx >= 0 && (!bestMatch || idx > bestMatch.index)) {
            bestMatch = { index: idx, weekday };
        }
    }

    if (!bestMatch) return null;

    const date = new Date(now);
    const delta = (bestMatch.weekday - now.getDay() + 7) % 7;
    date.setDate(date.getDate() + (delta === 0 ? 7 : delta));
    return { date, label: null };
}

function isSpecificViewingTimeProposal(context: SkillExecutionContext): boolean {
    if (!looksLikeViewingThread(context.conversationHistory || "")) return false;

    const message = context.message || "";
    const hasSpecificTime =
        /\b\d{1,2}:\d{2}\s*(?:am|pm)?\b/i.test(message) ||
        /\b\d{1,2}\s*(?:am|pm)\b/i.test(message);
    if (!hasSpecificTime) return false;

    const hasSchedulingLanguage =
        /\b(come|view|see|meet|available|availability|works?)\b/i.test(message) ||
        /\b(i can|can do|i will come|around|about|at)\b/i.test(message);

    return hasSchedulingLanguage;
}

function extractRequestedViewingDateTime(context: SkillExecutionContext): { requestedAt: Date; dayLabel: "today" | "tomorrow" | null } | null {
    let clockTime: { hour24: number; minute: number } | null = null;
    if (isSpecificViewingTimeProposal(context)) {
        clockTime = extractProposedClockTime(context.message);
    } else if (looksLikeViewingThread(context.conversationHistory || "") && isSchedulingFollowOnMessage(context.message)) {
        clockTime = extractRecentUserProposedClockTime(context.conversationHistory || "");
    }
    if (!clockTime) return null;

    const dayAnchor = inferRequestedDayAnchor(context);
    if (!dayAnchor) return null;

    const requestedAt = new Date(dayAnchor.date);
    requestedAt.setHours(clockTime.hour24, clockTime.minute, 0, 0);
    return { requestedAt, dayLabel: dayAnchor.label };
}

function toDateOrNull(value: any): Date | null {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (typeof value === "string" || typeof value === "number") {
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    return null;
}

function formatCompactTime(date: Date): string {
    return date
        .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
        .replace(/\s+/g, "")
        .toLowerCase();
}

function isSameCalendarDay(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate();
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

function buildDeterministicRequestedTimeReply(context: SkillExecutionContext, toolCalls: any[]): string | null {
    const requested = extractRequestedViewingDateTime(context);
    if (!requested) return null;

    const availabilityCall = [...toolCalls].reverse().find((c: any) =>
        c?.name === "check_availability" &&
        c?.result &&
        Array.isArray(c.result.freeSlots)
    );
    if (!availabilityCall) return null;

    const durationMinutes = Number.isFinite(availabilityCall?.args?.durationMinutes)
        ? Math.max(15, Math.round(Number(availabilityCall.args.durationMinutes)))
        : 60;
    const bufferMinutes = Number.isFinite(availabilityCall?.args?.bufferMinutes)
        ? Math.max(0, Math.round(Number(availabilityCall.args.bufferMinutes)))
        : 0;

    const requestedStart = requested.requestedAt;
    const requestedEnd = new Date(requestedStart.getTime() + durationMinutes * 60000);

    const freeSlots = (availabilityCall.result.freeSlots || [])
        .map((slot: any) => ({
            start: toDateOrNull(slot?.start),
            end: toDateOrNull(slot?.end),
        }))
        .filter((slot: any) => slot.start && slot.end) as Array<{ start: Date; end: Date }>;

    const busySlots = (availabilityCall.result.busySlots || [])
        .map((slot: any) => ({
            start: toDateOrNull(slot?.start),
            end: toDateOrNull(slot?.end),
        }))
        .filter((slot: any) => slot.start && slot.end) as Array<{ start: Date; end: Date }>;

    const sameDayFreeSlots = freeSlots
        .filter((slot) => isSameCalendarDay(slot.start, requestedStart))
        .sort((a, b) => a.start.getTime() - b.start.getTime());

    const exactMatch = sameDayFreeSlots.find(
        (slot) => Math.abs(slot.start.getTime() - requestedStart.getTime()) < 60_000
    );
    if (exactMatch) {
        const daySuffix = requested.dayLabel ? ` ${requested.dayLabel}` : "";
        return `${formatCompactTime(requestedStart)} works for me${daySuffix}. Does that still suit you?`;
    }

    const nextSameDaySlot = sameDayFreeSlots.find((slot) => slot.start.getTime() >= requestedStart.getTime());
    if (!nextSameDaySlot) {
        const daySuffix = requested.dayLabel ? ` ${requested.dayLabel}` : "";
        return `${formatCompactTime(requestedStart)} won't work${daySuffix}. Could you send another time that suits you?`;
    }

    const bufferMs = bufferMinutes * 60000;
    const blockingBusy = busySlots
        .filter((busy) => {
            const blockedStart = busy.start.getTime() - bufferMs;
            const blockedEnd = busy.end.getTime() + bufferMs;
            return requestedStart.getTime() < blockedEnd && requestedEnd.getTime() > blockedStart;
        })
        .sort((a, b) => a.end.getTime() - b.end.getTime())[0];

    const daySuffix = requested.dayLabel ? ` ${requested.dayLabel}` : "";
    const reason = blockingBusy && bufferMinutes > 0 && blockingBusy.end.getTime() <= nextSameDaySlot.start.getTime()
        ? ` I have another appointment until ${formatCompactTime(blockingBusy.end)} and I need a ${bufferMinutes}-minute buffer after that.`
        : bufferMinutes > 0
            ? ` I need a ${bufferMinutes}-minute buffer around appointments.`
            : "";

    return `${formatCompactTime(requestedStart)} won't work${daySuffix}.${reason} The earliest I can do is ${formatCompactTime(nextSameDaySlot.start)}${daySuffix}. Would that still suit you?`;
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

    const deterministicRequestedTimeReply = buildDeterministicRequestedTimeReply(params.context, params.toolCalls);
    if (deterministicRequestedTimeReply) {
        return { draft: deterministicRequestedTimeReply };
    }

    const deterministicLocationReply = buildDeterministicLocationReply(params.context, params.toolCalls);
    if (deterministicLocationReply) {
        return { draft: deterministicLocationReply };
    }
    const languageResolution = resolveCommunicationLanguage({
        latestInboundText: params.context.latestInboundText || params.context.message,
        contactPreferredLanguage: params.context.contactPreferredLanguage || params.context.expectedReplyLanguage || null,
        threadText: params.context.conversationHistory,
        fallbackLanguage: params.context.expectedReplyLanguage || params.context.threadDefaultLanguage || null,
    });
    const communicationContract = buildDealProtectiveCommunicationContract({
        expectedLanguage: languageResolution.expectedLanguage,
        latestInboundLanguage: languageResolution.latestInboundLanguage,
        contactPreferredLanguage: languageResolution.contactPreferredLanguage,
        contextLabel: "post-tool synthesized outbound reply",
    });

    const synthesisSystemPrompt = `You are a real estate CRM reply synthesizer.
Write the FINAL outbound message for the agent using the tool results that were just executed.

${communicationContract}

Rules:
- Answer the latest user message directly using the tool results.
- Do NOT say you are about to look something up if the tool results are already available.
- Do NOT repeat greetings or the contact's name in an ongoing thread unless this is clearly the first outbound message.
- Keep it conversational and practical.
- If the user asked for a location/pin/map/address and a Google Maps link is present in tool results, send the link immediately near the top.
- After sending a location for a viewing-related conversation, ask one short next-step scheduling question.
- If the user proposed a specific viewing time and it is unavailable, counter-propose the nearest available time (using the tool results) and ask if it still suits them.
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
    const languageResolution = resolveCommunicationLanguage({
        latestInboundText: context.latestInboundText || context.message,
        contactPreferredLanguage: context.contactPreferredLanguage || context.expectedReplyLanguage || null,
        threadText: context.conversationHistory,
        fallbackLanguage: context.expectedReplyLanguage || context.threadDefaultLanguage || null,
    });
    const communicationContract = buildDealProtectiveCommunicationContract({
        expectedLanguage: languageResolution.expectedLanguage,
        latestInboundLanguage: languageResolution.latestInboundLanguage || context.latestInboundLanguage || null,
        contactPreferredLanguage: languageResolution.contactPreferredLanguage,
        contextLabel: "skill-generated outbound communication",
    });

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
Expected reply language: ${languageResolution.expectedLanguage || "same as contact language"}.

${communicationContract}

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

        const hasSuccessfulAvailabilityCheck = results.some((r: any) => r?.name === "check_availability" && r?.result && !r?.error);
        const requestedViewingTime = isViewingSkill ? extractRequestedViewingDateTime(context) : null;
        const canAutoCheckRequestedTime =
            isViewingSkill &&
            !!requestedViewingTime &&
            !!context.agentUserId &&
            !hasSuccessfulAvailabilityCheck &&
            viewingPrecheck?.resolutionStatus === "resolved" &&
            viewingPrecheck?.selectedProperty?.schedulePath?.mode === "DIRECT_SCHEDULE";

        if (canAutoCheckRequestedTime) {
            const checkAvailabilityTool = toolRegistry.find(t => t.name === "check_availability");
            if (checkAvailabilityTool) {
                const dayStart = new Date(requestedViewingTime.requestedAt);
                dayStart.setHours(9, 0, 0, 0);
                const dayEnd = new Date(requestedViewingTime.requestedAt);
                dayEnd.setHours(18, 0, 0, 0);
                const autoArgs = {
                    userId: context.agentUserId,
                    startDate: dayStart.toISOString(),
                    endDate: dayEnd.toISOString(),
                    durationMinutes: 60,
                    bufferMinutes: 30,
                    slotStepMinutes: 30,
                };

                try {
                    const result = await checkAvailabilityTool.handler(autoArgs, {
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
                    results.push({
                        name: "check_availability",
                        args: autoArgs,
                        result: parsedResult,
                        synthetic: true
                    });
                } catch (e: any) {
                    results.push({
                        name: "check_availability",
                        args: autoArgs,
                        error: e.message,
                        synthetic: true
                    });
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
