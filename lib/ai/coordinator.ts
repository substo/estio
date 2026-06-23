import db from "@/lib/db";
import { getMessages, getConversation } from "@/lib/ghl/conversations";
import {
    GEMINI_DRAFT_FAST_DEFAULT,
    GEMINI_FLASH_LATEST_ALIAS,
    GEMINI_FLASH_STABLE_FALLBACK,
} from "@/lib/ai/models";
import { validateAction } from "@/lib/ai/policy";
import { appendAiStreamText } from "@/lib/ai/stream-text";
import { 
    assembleTimelineEvents, 
    type TimelineEvent, 
    formatTimelineEventForPrompt, 
    getTimelineBucket, 
    extractChangeField, 
    emptyTimelineBucketCounts,
    type TimelineBucketCounts 
} from "@/lib/conversations/timeline-events";
import { getDraftModelWithCachedContext } from "@/lib/ai/draft-context-cache";
import { getLocationDefaultReplyLanguage } from "@/lib/ai/location-reply-language";
import { formatLocationKnowledgeForPrompt, listActiveLocationKnowledge } from "@/lib/ai/location-learning";
import { buildConversationReferenceWhere } from "@/lib/conversations/identity";
import {
    buildConversationalMessagingContract,
    buildDealProtectiveCommunicationContract,
    detectLanguageFromText,
    inferCommunicationEvidenceFromText,
    resolveCommunicationLanguage
} from "@/lib/ai/prompts/communication-policy";

interface CoordinationContext {
    conversationId: string;
    locationId: string;
    contactId: string;
    accessToken: string;
    mode?: "chat" | "deal";
    dealId?: string;
    agentName?: string;
    businessName?: string;
    instruction?: string;
    baseDraft?: string;
    model?: string;
    replyLanguageOverride?: string | null;
    draftLanguage?: string | null;
    stream?: boolean;
    onToken?: (chunk: string) => void;
    latencyMode?: "fast" | "full";
}

import { calculateRunCost } from "@/lib/ai/pricing";
import { securelyRecordAiUsage } from "@/lib/ai/usage-metering";

type DraftMessage = {
    direction: string;
    body: string;
    createdAt: Date | null;
};

const NAME_GREETING_LONG_BREAK_HOURS = 3;
const TIMELINE_RECENT_EVENT_WINDOW = 36;
const TIMELINE_FAST_RECENT_EVENT_WINDOW = 14;
const TIMELINE_LINE_MAX_CHARS = 220;
const TIMELINE_FAST_LINE_MAX_CHARS = 160;
const TIMELINE_FETCH_TAKE = 96;
const TIMELINE_FAST_FETCH_TAKE = 32;
const FAST_CHAT_MAX_OUTPUT_TOKENS = 1200;
const FAST_EMAIL_MAX_OUTPUT_TOKENS = 2200;
const MODEL_OUTPUT_TOKEN_LIMITS: Record<string, number> = {
    "gemini-2.5-flash-lite": 65536,
    "gemini-2.5-flash": 65536,
    "gemini-2.5-pro": 65536,
    "gemini-3-flash-preview": 65536,
    "gemini-3-pro-preview": 65536,
    "gemini-3-pro-image-preview": 65536,
    "gemini-3.1-pro": 65536,
    "gemini-flash-latest": 65536,
    "gemini-flash-lite-latest": 65536,
};
const MODEL_OUTPUT_DEFAULT_LIMIT = 8192;

function getModelMaxOutputTokens(modelName: string): number {
    const exact = MODEL_OUTPUT_TOKEN_LIMITS[modelName];
    if (exact) return exact;
    // Pattern match for any Gemini 2.5+ or 3.x model
    if (/gemini-(?:2\.5|3)/i.test(modelName)) return 65536;
    return MODEL_OUTPUT_DEFAULT_LIMIT;
}

function formatDraftContextValue(value: unknown): string {
    if (Array.isArray(value)) {
        return value
            .map((item) => String(item || "").trim())
            .filter(Boolean)
            .join(", ");
    }

    if (value === null || value === undefined) return "";
    return String(value).trim();
}

export function buildContactRequirementGuide(contact: {
    leadStage?: unknown;
    leadGoal?: unknown;
    leadPriority?: unknown;
    requirementStatus?: unknown;
    requirementDistrict?: unknown;
    requirementBedrooms?: unknown;
    requirementMinPrice?: unknown;
    requirementMaxPrice?: unknown;
    requirementCondition?: unknown;
    requirementPropertyTypes?: unknown;
    requirementPropertyLocations?: unknown;
    requirementOtherDetails?: unknown;
    requirementSummary?: unknown;
} | null | undefined): string {
    if (!contact) return "Client requirement guide: No contact requirements available.";

    const minPrice = formatDraftContextValue(contact.requirementMinPrice);
    const maxPrice = formatDraftContextValue(contact.requirementMaxPrice);
    const budget = minPrice || maxPrice
        ? `${minPrice || "Any"} - ${maxPrice || "Any"}`
        : "";
    const lines = [
        ["Lead stage", contact.leadStage],
        ["Lead goal", contact.leadGoal],
        ["Lead priority", contact.leadPriority],
        ["Status", contact.requirementStatus],
        ["District", contact.requirementDistrict],
        ["Locations", contact.requirementPropertyLocations],
        ["Bedrooms", contact.requirementBedrooms],
        ["Budget", budget],
        ["Condition", contact.requirementCondition],
        ["Property types", contact.requirementPropertyTypes],
        ["Other details", contact.requirementOtherDetails],
        ["Requirement summary/history", contact.requirementSummary],
    ]
        .map(([label, value]) => {
            const formatted = formatDraftContextValue(value);
            return formatted ? `- ${label}: ${formatted}` : null;
        })
        .filter(Boolean);

    if (lines.length === 0) return "Client requirement guide: No approved requirements recorded.";

    return [
        "Client requirement guide:",
        ...lines,
        "Use this as relevance guidance. Do not restate these requirements unless they help explain why a property fits, clarify a mismatch, or answer the client's latest message.",
    ].join("\n");
}

const DRAFT_THINKING_BUDGET_SIMPLE = 0;
const DRAFT_THINKING_BUDGET_COMPLEX = 128;
const DRAFT_RETRY_BASE_DELAY_MS = 260;
const DRAFT_MAX_RETRIES_ON_429 = 2;
const DRAFT_STATIC_CONTEXT_VERSION = "v1";

const DRAFT_STATIC_CONTEXT_PROMPT = `You are an expert real-estate message drafting assistant.
Write the exact outbound message the agent should send next, not analysis.

Core rules:
- Keep tone professional, clear, and human.
- Avoid repetitive greeting patterns in active threads.
- Do not include internal analysis, labels, JSON, or tool traces.
- Use context facts exactly; do not invent property status, pricing, or commitments.
- If availability is uncertain, state uncertainty and ask for confirmation.
- If a requested property is unavailable, acknowledge this clearly and propose a practical next step.
- Default to a minimum-sufficient response: include only what is needed to answer the latest message correctly.
- Keep outputs concise while preserving clarity.
- Do not add backup scenarios, persuasive framing, or goodwill filler unless explicitly requested.
- If a user instruction already reads like a send-ready message, preserve its structure and only refine clarity.
- If the user instructs a specific phrasing approach, keep that approach and meaning unless a change is required for factual accuracy, policy safety, or basic grammar.
- If the user instructs to decline sharing the exact location, maps URL, coordinates, address, or directions for any property before a viewing is arranged, state that due to internal procedures you cannot share it yet, but offer to arrange/accompany a viewing and show it in person.
- Do not add hedge phrases such as "based on the information I have" or "at this stage" unless the context truly contains uncertainty, incomplete confirmation, or unresolved authority.
- Avoid manipulative urgency and hard-finality claims unless explicitly supported by context evidence.
- Never include automatic signature blocks unless explicitly asked.
- If you include a URL, put it on its own line and never end the URL with trailing punctuation such as a final period.
- Never invent URLs. Only include a URL if the exact URL appears in the provided context or user instruction.
- Never invent Google Maps links, map shortlinks, coordinates, addresses, directions, or neighborhood descriptions. If exact location context is missing, say you can share only the general area and offer to arrange/accompany a viewing.
- Preserve channel-appropriate style (chat vs email) as instructed in runtime context.`;
const SIGN_OFF_PHRASES = new Set([
    "best regards",
    "kind regards",
    "warm regards",
    "regards",
    "sincerely",
    "many thanks",
    "thanks and regards",
    "thank you",
    "thanks"
]);

function isModelUnavailableError(error: unknown): boolean {
    const message = (error instanceof Error ? error.message : String(error || "")).toLowerCase();
    return (
        message.includes("404") ||
        message.includes("not found") ||
        message.includes("unknown model") ||
        message.includes("invalid model") ||
        message.includes("unsupported model")
    );
}

function isRateLimitError(error: unknown): boolean {
    const message = (error instanceof Error ? error.message : String(error || "")).toLowerCase();
    return message.includes("429") || message.includes("rate limit");
}

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function getUsageInt(meta: Record<string, unknown>, key: string): number {
    const value = Number(meta[key]);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function parseMessageTimestamp(value: unknown): Date | null {
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }

    if (typeof value === "number" && Number.isFinite(value)) {
        const timestampMs = value < 1_000_000_000_000 ? value * 1000 : value;
        const parsed = new Date(timestampMs);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) return null;

        if (/^\d+$/.test(trimmed)) {
            return parseMessageTimestamp(Number(trimmed));
        }

        const parsed = new Date(trimmed);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    return null;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripHtmlTags(value: string): string {
    return value.replace(/<[^>]+>/g, " ");
}

function normalizeLineForSignoff(value: string): string {
    return stripHtmlTags(value)
        .replace(/\u00a0/g, " ")
        .trim()
        .toLowerCase()
        .replace(/[,:;.!-]+$/g, "")
        .replace(/\s+/g, " ");
}

function stripLeadingNameGreeting(text: string, firstName: string | null, allowNameGreeting: boolean): string {
    if (allowNameGreeting || !firstName) return text;

    const escapedFirstName = escapeRegExp(firstName.trim());
    if (!escapedFirstName) return text;

    const salutationRegex = new RegExp(`^\\s*(?:hi|hello|hey|dear)\\s+${escapedFirstName}\\s*[,:!\\-]*\\s*`, "i");
    return text.replace(salutationRegex, "").trimStart();
}

function hasExplicitOpeningGreeting(value: string): boolean {
    return /^(?:hi|hello|hey|dear)\b/i.test(value.trim());
}

export function looksLikeSendReadyDraftInstruction(value: string): boolean {
    const text = value.trim();
    if (text.length < 60) return false;

    const lower = text.toLowerCase();
    if (/^(?:make|write|draft|generate|create|reply|respond|say|tell|ask|include|mention|explain|add|remove|change|rewrite|improve|shorten|translate|summari[sz]e)\b/.test(lower)) {
        return false;
    }

    const sentenceCount = (text.match(/[.!?](?:\s|$)/g) || []).length;
    const hasMessageOpening = hasExplicitOpeningGreeting(text);
    const hasMessageBodySignal = /\b(?:i|we|you|your|please|let me know|regarding|thank you|thanks|sorry)\b/i.test(text);

    return hasMessageBodySignal && (hasMessageOpening || sentenceCount >= 2 || text.includes("\n"));
}

function summarizeDraftInstructionForLog(value: string) {
    let hash = 0;
    for (let idx = 0; idx < value.length; idx += 1) {
        hash = ((hash << 5) - hash + value.charCodeAt(idx)) | 0;
    }
    return {
        chars: value.length,
        hash: Math.abs(hash).toString(36),
    };
}

function stripManualSignatureBlock(text: string): string {
    const trimmed = text.trim();
    if (!trimmed) return text;

    const normalized = trimmed
        .replace(/<\/p>\s*<p[^>]*>/gi, "<br>")
        .replace(/<\/div>\s*<div[^>]*>/gi, "<br>");
    const usesHtmlBreaks = /<br\s*\/?>/i.test(normalized);
    const lines = normalized.split(/(?:\r?\n|<br\s*\/?>)/i);

    if (lines.length < 2) return trimmed;

    const nonEmptyLines = lines
        .map((line, idx) => ({
            idx,
            normalized: normalizeLineForSignoff(line),
            raw: stripHtmlTags(line).replace(/\u00a0/g, " ").trim()
        }))
        .filter(item => item.raw.length > 0);

    if (nonEmptyLines.length < 2) return trimmed;

    for (let pointer = nonEmptyLines.length - 2; pointer >= Math.max(0, nonEmptyLines.length - 7); pointer--) {
        const candidate = nonEmptyLines[pointer];
        if (!SIGN_OFF_PHRASES.has(candidate.normalized)) continue;

        const nonEmptyAfter = nonEmptyLines.length - pointer - 1;
        if (nonEmptyAfter < 1 || nonEmptyAfter > 4) continue;

        const stripped = lines
            .slice(0, candidate.idx)
            .join(usesHtmlBreaks ? "<br>" : "\n")
            .trim();

        return stripped || trimmed;
    }

    return trimmed;
}

function normalizeUrlForGrounding(value: string): string {
    return String(value || "")
        .trim()
        .replace(/[),.;:!?]+$/g, "")
        .toLowerCase();
}

function isMapUrl(value: string): boolean {
    const normalized = normalizeUrlForGrounding(value);
    return (
        normalized.includes("maps.app.goo.gl/") ||
        normalized.includes("google.com/maps") ||
        normalized.includes("maps.google.") ||
        normalized.includes("maps.google.com") ||
        normalized.includes("google.com/?q=")
    );
}

function hasMapSharingRestrictionInstruction(value: string): boolean {
    const normalized = String(value || "").toLowerCase().replace(/\s+/g, " ");
    if (!normalized) return false;

    const referencesLocation = /\b(map|maps|url|link|location|address|coordinate|coordinates|directions)\b/.test(normalized);
    const referencesProcedure = /\b(internal procedure|internal procedures|procedure|procedures|policy|policies)\b/.test(normalized);
    const referencesViewingGate = /\b(before|until|unless|without|prior to)\b.{0,80}\b(viewing|appointment)\b/.test(normalized) ||
        /\b(viewing|appointment)\b.{0,80}\b(arranged|booked|scheduled|confirmed)\b/.test(normalized);
    const deniesSharing = /\b(do not|don't|cannot|can't|can not|not allowed|should not|won't|will not|decline|avoid)\b.{0,80}\b(share|send|give|provide|include)\b/.test(normalized) ||
        /\b(share|send|give|provide|include)\b.{0,80}\b(after|once|when)\b.{0,80}\b(viewing|appointment)\b/.test(normalized);

    return referencesLocation && referencesProcedure && referencesViewingGate && deniesSharing;
}

function stripMapUrls(text: string): string {
    return text
        .split(/\r?\n/)
        .map((line) => {
            const urls = Array.from(line.matchAll(/https?:\/\/[^\s<>"']+/gi)).map((match) => match[0]);
            if (urls.length === 0) return line;

            let nextLine = line;
            let removedMapUrl = false;
            for (const url of urls) {
                if (!isMapUrl(url)) continue;
                removedMapUrl = true;
                nextLine = nextLine.replace(url, "").replace(/\s{2,}/g, " ").trimEnd();
            }

            return removedMapUrl && nextLine.trim().length === 0 ? "" : nextLine;
        })
        .filter((line) => line.trim().length > 0)
        .join("\n")
        .trim();
}

export function stripUngroundedMapUrls(text: string, groundingText: string): string {
    if (!text || !/https?:\/\//i.test(text)) return text;

    const groundedUrls = new Set(
        Array.from(String(groundingText || "").matchAll(/https?:\/\/[^\s<>"']+/gi))
            .map((match) => normalizeUrlForGrounding(match[0]))
            .filter(Boolean)
    );

    if (groundedUrls.size === 0 && !/(maps\.app\.goo\.gl|google\.com\/maps|maps\.google\.|google\.com\/\?q=)/i.test(text)) {
        return text;
    }

    const cleanedLines: string[] = [];
    for (const line of text.split(/\r?\n/)) {
        const urls = Array.from(line.matchAll(/https?:\/\/[^\s<>"']+/gi)).map((match) => match[0]);
        if (urls.length === 0) {
            cleanedLines.push(line);
            continue;
        }

        let nextLine = line;
        let removedMapUrl = false;
        for (const url of urls) {
            const normalized = normalizeUrlForGrounding(url);
            if (!isMapUrl(normalized) || groundedUrls.has(normalized)) continue;
            removedMapUrl = true;
            nextLine = nextLine.replace(url, "").replace(/\s{2,}/g, " ").trimEnd();
        }

        if (removedMapUrl && nextLine.trim().length === 0) {
            let previousIndex = cleanedLines.length - 1;
            while (previousIndex >= 0 && cleanedLines[previousIndex]?.trim().length === 0) {
                previousIndex -= 1;
            }
            const previous = previousIndex >= 0 ? cleanedLines[previousIndex] || "" : "";
            if (/\b(?:map|maps|location)\s+(?:link|url)\b/i.test(previous) || /\bhere(?:'s| is)\s+(?:the\s+)?(?:map|location)(?:\s+(?:link|url))?\b/i.test(previous)) {
                cleanedLines.splice(previousIndex);
            }
            continue;
        }

        cleanedLines.push(nextLine);
    }

    return cleanedLines
        .filter((line) => line.trim().length > 0)
        .join("\n")
        .trim();
}

export function enforceMapSharingInstruction(text: string, instruction: string): string {
    if (!hasMapSharingRestrictionInstruction(instruction)) return text;
    return stripMapUrls(text);
}



function getViewingDateFromEvent(event: TimelineEvent): Date | null {
    if (event.kind !== "activity") return null;
    const action = String(event.action || "").toUpperCase();
    if (!action.startsWith("VIEWING_")) return null;
    const raw = extractChangeField(event.changes, "date") || event.createdAt;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function buildTimelineCompaction(events: TimelineEvent[], options: { recentEventWindow?: number; lineMaxChars?: number } = {}) {
    const recentEventWindow = options.recentEventWindow ?? TIMELINE_RECENT_EVENT_WINDOW;
    const lineMaxChars = options.lineMaxChars ?? TIMELINE_LINE_MAX_CHARS;
    const recentEvents = events.slice(-recentEventWindow);
    const olderEvents = events.slice(0, Math.max(0, events.length - recentEventWindow));

    const totals = emptyTimelineBucketCounts();
    const included = emptyTimelineBucketCounts();

    for (const event of events) {
        totals[getTimelineBucket(event)] += 1;
    }
    for (const event of recentEvents) {
        included[getTimelineBucket(event)] += 1;
    }

    const truncated: TimelineBucketCounts = {
        messages: Math.max(0, totals.messages - included.messages),
        notes: Math.max(0, totals.notes - included.notes),
        viewings: Math.max(0, totals.viewings - included.viewings),
        tasks: Math.max(0, totals.tasks - included.tasks),
    };

    const openTasks = events.filter(
        (event) => event.kind === "activity" && String(event.action || "").toUpperCase() === "TASK_OPEN"
    ).length;
    const completedTasks = events.filter(
        (event) => event.kind === "activity" && String(event.action || "").toUpperCase() === "TASK_DONE"
    ).length;

    const now = new Date();
    const nearestViewing = events
        .map(getViewingDateFromEvent)
        .filter((date): date is Date => !!date && date.getTime() >= now.getTime())
        .sort((a, b) => a.getTime() - b.getTime())[0] || null;

    const latestNoteEvent = [...events]
        .reverse()
        .find((event) => event.kind === "activity" && getTimelineBucket(event) === "notes");

    const olderSummaryLines = [
        olderEvents.length > 0
            ? `Older events omitted from raw section: ${olderEvents.length} (messages ${truncated.messages}, notes ${truncated.notes}, viewings ${truncated.viewings}, tasks ${truncated.tasks}).`
            : "No older timeline events were omitted.",
        `Current task state from timeline: ${openTasks} open, ${completedTasks} completed.`,
        `Nearest upcoming viewing: ${nearestViewing ? nearestViewing.toISOString() : "none"}.`,
        `Latest note/activity timestamp: ${latestNoteEvent ? latestNoteEvent.createdAt : "none"}.`,
    ];

    return {
        recentEvents,
        olderEvents,
        olderSummary: olderSummaryLines.join("\n"),
        recentTimelineText: recentEvents.map((e) => formatTimelineEventForPrompt(e, lineMaxChars)).join("\n"),
        stats: {
            total: totals,
            included,
            truncated,
            totalEvents: events.length,
            includedEvents: recentEvents.length,
            omittedEvents: olderEvents.length,
        },
    };
}

export async function generateDraft(context: CoordinationContext) {
    let promptTokens = 0;
    let completionTokens = 0;
    const overallStartedAt = Date.now();
    const isFastDraft = context.latencyMode === "fast";

    const telemetry: {
        stageMs: {
            contextAssemblyMs: number;
            geminiMs: number;
            postProcessingMs: number;
            totalMs: number;
            firstTokenMs: number | null;
        };
        prompt: {
            chars: number;
            threadMessageCount: number;
            timelineIncludedEvents: number;
            timelineOmittedEvents: number;
            mode: "chat" | "deal";
            complexDraft: boolean;
            latencyMode: "fast" | "full";
        };
        usage: {
            promptTokens: number;
            completionTokens: number;
            totalTokens: number;
            thoughtsTokens: number;
            cachedContentTokens: number;
            toolUsePromptTokens: number;
        };
        model: {
            requested: string;
            actual: string;
            fallbackUsed: boolean;
            streamed: boolean;
            maxOutputTokens: number;
            thinkingBudget: number;
        };
        cache: {
            state: "hit" | "miss" | "disabled" | "error";
            name: string | null;
        };
    } = {
        stageMs: {
            contextAssemblyMs: 0,
            geminiMs: 0,
            postProcessingMs: 0,
            totalMs: 0,
            firstTokenMs: null,
        },
        prompt: {
            chars: 0,
            threadMessageCount: 0,
            timelineIncludedEvents: 0,
            timelineOmittedEvents: 0,
            mode: context.mode === "deal" && context.dealId ? "deal" : "chat",
            complexDraft: false,
            latencyMode: isFastDraft ? "fast" : "full",
        },
        usage: {
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            thoughtsTokens: 0,
            cachedContentTokens: 0,
            toolUsePromptTokens: 0,
        },
        model: {
            requested: context.model || GEMINI_DRAFT_FAST_DEFAULT,
            actual: context.model || GEMINI_DRAFT_FAST_DEFAULT,
            fallbackUsed: false,
            streamed: false,
            maxOutputTokens: 0, // Updated after model resolution
            thinkingBudget: DRAFT_THINKING_BUDGET_SIMPLE,
        },
        cache: {
            state: "disabled",
            name: null,
        },
    };

    try {
        const contextAssemblyStartedAt = Date.now();

        // 0. Fetch Config
        const siteConfig = await db.siteConfig.findUnique({
            where: { locationId: context.locationId }
        });
        const configAny = siteConfig as any;
        const apiKey = configAny?.googleAiApiKey || process.env.GOOGLE_API_KEY;
        const brandVoice = typeof configAny?.brandVoice === "string" ? configAny.brandVoice.trim() : "";
        const websiteDomain = typeof configAny?.domain === "string" && configAny.domain.trim()
            ? configAny.domain.trim()
            : null;
        const locationKnowledge = formatLocationKnowledgeForPrompt(await listActiveLocationKnowledge({
            locationId: context.locationId,
            limit: 8,
        }));

        // Model preference order: explicit request -> location-configured default -> draft fast default.
        const explicitRequestedModel = typeof context.model === "string" && context.model.trim()
            ? context.model.trim()
            : "";
        const configuredDraftModel = typeof configAny?.googleAiModel === "string" && configAny.googleAiModel.trim()
            ? configAny.googleAiModel.trim()
            : "";
        let requestedModelName = explicitRequestedModel || configuredDraftModel || GEMINI_DRAFT_FAST_DEFAULT;
        let actualModelName = requestedModelName;

        if (!apiKey) {
            return {
                draft: "Error: No AI API Key configured.",
                reasoning: "Please configure Google AI in Settings.",
                telemetry,
            };
        }

        telemetry.model.requested = requestedModelName;
        telemetry.model.actual = actualModelName;

        console.log(`[AI Draft] Starting generation for Conversation: ${context.conversationId}, Requested Model: ${requestedModelName}`);

        // 1. Fetch Conversation History & Details
        // STRATEGY: Local Database is the PRIMARY source of truth.
        // We only fetch from GHL if the conversation is missing locally or explicitly designated as GHL-sourced but empty.

        let messages: DraftMessage[] = [];
        let conversationType = 'SMS';
        let foundLocally = false;
        let localConversationReplyLanguageOverride: string | null = null;

        // Step 1: Try Local Lookup (Primary)
        try {
            let localConversation = await db.conversation.findUnique({
                where: { id: context.conversationId },
                include: { messages: { orderBy: { createdAt: 'desc' }, take: 20 } }
            });

            if (!localConversation) {
                // Try looking up by GHL ID (as UI often passes this)
                localConversation = await db.conversation.findFirst({
                    where: buildConversationReferenceWhere(context.locationId, context.conversationId),
                    include: { messages: { orderBy: { createdAt: 'desc' }, take: 20 } }
                });
            }

            if (localConversation) {
                console.log(`[AI Draft] Local DB Fetch Success. Found ${localConversation.messages.length} messages.`);
                messages = localConversation.messages.reverse().map(m => ({
                    direction: m.direction,
                    body: typeof m.body === "string" ? m.body : "",
                    createdAt: parseMessageTimestamp(m.createdAt)
                }));
                conversationType = localConversation.lastMessageType || 'SMS';
                localConversationReplyLanguageOverride = localConversation.replyLanguageOverride || null;
                foundLocally = true;
            } else {
                console.log(`[AI Draft] Conversation not found locally (ID: ${context.conversationId}).`);
            }
        } catch (dbError) {
            console.error("[AI Draft] Local DB Error:", dbError);
        }

        // Step 2: GHL Fallback (Secondary)
        // Used only if local lookup failed OR yielded no messages (and we suspect there might be history in GHL)
        if (!foundLocally || messages.length === 0) {
            console.log(`[AI Draft] Local context empty/missing. Attempting GHL Fallback...`);

            let ghlIdToUse = context.conversationId;

            // If we found it locally (but empty messages), try to find a linked GHL ID
            if (foundLocally) {
                const localRef = await db.conversation.findUnique({
                    where: { id: context.conversationId },
                    select: { ghlConversationId: true }
                });
                if (localRef?.ghlConversationId) {
                    ghlIdToUse = localRef.ghlConversationId;
                }
            }

            // Only attempt GHL if the ID looks valid (length check) 
            // and is essentially distinct/valid compared to raw input if that was internal
            if (ghlIdToUse && ghlIdToUse.length > 15) {
                try {
                    console.log(`[AI Draft] Fetching from GHL (ID: ${ghlIdToUse})...`);
                    const [messagesData, conversationData] = await Promise.all([
                        getMessages(context.accessToken, ghlIdToUse),
                        getConversation(context.accessToken, ghlIdToUse)
                    ]);

                    const ghlMessages = Array.isArray(messagesData?.messages?.messages)
                        ? [...messagesData.messages.messages].reverse()
                        : [];

                    if (ghlMessages.length > 0) {
                        messages = ghlMessages.map((m: any) => ({
                            direction: typeof m?.direction === "string" ? m.direction : "inbound",
                            body: typeof m?.body === "string" ? m.body : "",
                            createdAt: parseMessageTimestamp(m?.dateAdded ?? m?.createdAt)
                        }));
                        conversationType = conversationData?.conversation?.lastMessageType || conversationData?.conversation?.type || 'SMS';
                        console.log(`[AI Draft] GHL Fallback Success. Found ${messages.length} messages.`);
                    } else {
                        console.log(`[AI Draft] GHL returned no messages.`);
                    }
                } catch (ghlError) {
                    console.warn(`[AI Draft] GHL Fallback Failed:`, (ghlError as any).message);
                }
            } else {
                console.log(`[AI Draft] Skipping GHL fallback (ID likely internal/invalid: ${ghlIdToUse})`);
            }
        }

        // Determine Channel
        const channelType = conversationType.toUpperCase();
        const isEmail = channelType.includes('EMAIL');
        const channelName = isEmail ? 'Email' : 'WhatsApp/SMS';
        const agentName = (context.agentName || "").trim();
        const businessName = (context.businessName || configAny?.name || "the agency").trim();

        // 2. Fetch Contact & Property Data from Local DB (Context Enrichment)
        // Support both local Contact.id and external ghlContactId (UI can pass either).
        const contact = await db.contact.findFirst({
            where: {
                locationId: context.locationId,
                OR: [
                    { id: context.contactId },
                    { ghlContactId: context.contactId }
                ]
            },
            include: {
                viewings: true,
                propertyRoles: {
                    include: {
                        property: true
                    }
                }
            }
        });
        const contactFirstName = (contact?.firstName || contact?.name || "").trim().split(/\s+/)[0] || null;
        const requestedTimelineMode = context.mode === "deal" && context.dealId ? "deal" : "chat";
        let timelineScopeLabel = requestedTimelineMode === "deal"
            ? `Deal-aware hybrid timeline (dealId=${context.dealId})`
            : "Selected conversation timeline";
        let timelineEvents: TimelineEvent[] = [];

        try {
            const timelineResult = requestedTimelineMode === "deal"
                ? await assembleTimelineEvents({
                    mode: "deal",
                    locationId: context.locationId,
                    dealId: String(context.dealId),
                    includeMessages: true,
                    includeActivities: true,
                    take: isFastDraft ? TIMELINE_FAST_FETCH_TAKE : TIMELINE_FETCH_TAKE,
                })
                : await assembleTimelineEvents({
                    mode: "chat",
                    locationId: context.locationId,
                    conversationId: context.conversationId,
                    includeMessages: true,
                    includeActivities: true,
                    take: isFastDraft ? TIMELINE_FAST_FETCH_TAKE : TIMELINE_FETCH_TAKE,
                });

            timelineEvents = timelineResult.events;
            timelineScopeLabel = requestedTimelineMode === "deal"
                ? `Deal-aware hybrid timeline across ${timelineResult.conversations.length} participant conversation(s)`
                : "Selected conversation timeline";
        } catch (timelineError: any) {
            console.warn("[AI Draft] Timeline assembly failed:", timelineError?.message || timelineError);
        }

        const timelineCompaction = buildTimelineCompaction(timelineEvents, isFastDraft
            ? {
                recentEventWindow: TIMELINE_FAST_RECENT_EVENT_WINDOW,
                lineMaxChars: TIMELINE_FAST_LINE_MAX_CHARS,
            }
            : undefined);
        console.log("[AI Draft] Timeline compaction stats:", JSON.stringify({
            mode: requestedTimelineMode,
            scope: timelineScopeLabel,
            totalEvents: timelineCompaction.stats.totalEvents,
            includedEvents: timelineCompaction.stats.includedEvents,
            omittedEvents: timelineCompaction.stats.omittedEvents,
            totals: timelineCompaction.stats.total,
            included: timelineCompaction.stats.included,
            truncated: timelineCompaction.stats.truncated,
        }));

        const timelineRecentText = timelineCompaction.recentTimelineText || "[No timeline events found]";
        const timelineOlderSummary = timelineCompaction.olderSummary;
        const latestInboundMessage = [...messages]
            .reverse()
            .find(m => m.direction === "inbound" && (m.body || "").trim().length > 0)?.body || "";
        const threadText = messages
            .map(m => (m.body || "").trim())
            .filter(Boolean)
            .join("\n");
        const requestedDraftLanguage = String(context.draftLanguage || "").trim() || null;
        const manualReplyLanguage = context.replyLanguageOverride === undefined
            ? localConversationReplyLanguageOverride
            : context.replyLanguageOverride;
        const locationDefaultReplyLanguage = await getLocationDefaultReplyLanguage(context.locationId);
        const customerLanguageResolution = resolveCommunicationLanguage({
            manualOverrideLanguage: manualReplyLanguage,
            locationDefaultLanguage: locationDefaultReplyLanguage,
            latestInboundText: latestInboundMessage,
            contactPreferredLanguage: contact?.preferredLang ?? null,
            threadText,
            fallbackLanguage: locationDefaultReplyLanguage,
        });
        const draftLanguageResolution = resolveCommunicationLanguage({
            manualOverrideLanguage: requestedDraftLanguage,
            locationDefaultLanguage: requestedDraftLanguage || locationDefaultReplyLanguage,
            latestInboundText: latestInboundMessage,
            contactPreferredLanguage: contact?.preferredLang ?? null,
            threadText,
            fallbackLanguage: locationDefaultReplyLanguage,
        });
        const expectedDraftLanguage = draftLanguageResolution.expectedLanguage || customerLanguageResolution.expectedLanguage || "en";
        const communicationContract = buildDealProtectiveCommunicationContract({
            expectedLanguage: expectedDraftLanguage,
            latestInboundLanguage: customerLanguageResolution.latestInboundLanguage,
            contactPreferredLanguage: customerLanguageResolution.contactPreferredLanguage,
            contextLabel: requestedDraftLanguage
                ? "the agent's internal review draft"
                : "outbound real-estate communication",
        });
        const conversationalMessagingContract = buildConversationalMessagingContract({
            channel: channelName,
        });

        const meaningfulMessages = messages.filter(m => (m.body || "").trim().length > 0);
        const hasPriorOutbound = meaningfulMessages.some(m => m.direction === "outbound");
        const latestMeaningfulMessage = meaningfulMessages[meaningfulMessages.length - 1] || null;
        const isContinuingAfterAgentMessage = latestMeaningfulMessage?.direction === "outbound";
        const isFirstOutreach = !hasPriorOutbound;
        const normalizedInstruction = String(context.instruction || "").trim();
        const normalizedBaseDraft = String(context.baseDraft || "").trim();
        const instructionLooksSendReady = !!normalizedInstruction && looksLikeSendReadyDraftInstruction(normalizedInstruction);
        const hasOperatorGreeting = hasExplicitOpeningGreeting(normalizedBaseDraft) || hasExplicitOpeningGreeting(normalizedInstruction);

        const messagesWithTimestamps = messages.filter((m): m is DraftMessage & { createdAt: Date } => !!m.createdAt);
        const latestTimestamp = messagesWithTimestamps.length > 0
            ? messagesWithTimestamps[messagesWithTimestamps.length - 1].createdAt
            : null;
        const previousTimestamp = messagesWithTimestamps.length > 1
            ? messagesWithTimestamps[messagesWithTimestamps.length - 2].createdAt
            : null;

        const hoursBetweenLastTwoMessages = latestTimestamp && previousTimestamp
            ? (latestTimestamp.getTime() - previousTimestamp.getTime()) / (60 * 60 * 1000)
            : null;
        const isNewConversationDay = !!(latestTimestamp && previousTimestamp && latestTimestamp.toDateString() !== previousTimestamp.toDateString());
        const hasLongBreak = hoursBetweenLastTwoMessages !== null && hoursBetweenLastTwoMessages >= NAME_GREETING_LONG_BREAK_HOURS;

        const allowNameGreeting = hasOperatorGreeting || (!!contactFirstName && !isContinuingAfterAgentMessage && (isFirstOutreach || isNewConversationDay || hasLongBreak));
        const greetingDecisionReason = hasOperatorGreeting
            ? "The operator supplied an explicit opening greeting in the current draft/instruction; preserve it."
            : !contactFirstName
                ? "No contact first name is available."
            : isContinuingAfterAgentMessage
                ? "The agent is continuing after a recent outbound message with no client reply; repeating a name greeting would sound scripted."
            : isFirstOutreach
                ? "This is first outreach (no prior outbound message in history)."
                : isNewConversationDay
                    ? "The conversation resumed on a new calendar day."
                    : hasLongBreak
                        ? `The conversation resumed after a ${hoursBetweenLastTwoMessages?.toFixed(1)} hour break.`
                        : "Recent messages are close together in the same active thread.";

        const isComplexDraft =
            !isFastDraft
            && (
                requestedTimelineMode === "deal"
                || timelineCompaction.stats.totalEvents > 90
                || normalizedInstruction.length > 220
                || normalizedBaseDraft.length > 300
            );
        telemetry.prompt.complexDraft = isComplexDraft;

        if (!explicitRequestedModel && !configuredDraftModel) {
            actualModelName = isComplexDraft
                ? GEMINI_FLASH_STABLE_FALLBACK
                : GEMINI_DRAFT_FAST_DEFAULT;
            requestedModelName = actualModelName;
            telemetry.model.requested = requestedModelName;
        }

        const maxOutputTokens = isFastDraft
            ? (isEmail ? FAST_EMAIL_MAX_OUTPUT_TOKENS : FAST_CHAT_MAX_OUTPUT_TOKENS)
            : getModelMaxOutputTokens(actualModelName);
        const thinkingBudget = isFastDraft
            ? DRAFT_THINKING_BUDGET_SIMPLE
            : isComplexDraft
            ? DRAFT_THINKING_BUDGET_COMPLEX
            : DRAFT_THINKING_BUDGET_SIMPLE;
        const generationConfig: Record<string, unknown> = {
            responseMimeType: "text/plain",
            candidateCount: 1,
            maxOutputTokens,
            thinkingConfig: {
                thinkingBudget,
            },
        };

        telemetry.model.maxOutputTokens = maxOutputTokens;
        telemetry.model.thinkingBudget = thinkingBudget;

        // 3. Construct Prompt
        let runtimeInstruction = `Runtime Context:
        - Agent Name: ${agentName || "Unknown"}
        - Business Name: ${businessName}
        ${websiteDomain ? `- Website: https://${websiteDomain}` : "- Website: Unknown"}
        ${brandVoice ? `- Brand Voice: ${brandVoice}` : "- Brand Voice: Not provided"}
        ${locationKnowledge ? `- Approved Location Knowledge:\n${locationKnowledge}` : "- Approved Location Knowledge: None"}
        - Role: Intermediary connecting leads, owners, and agents.
        - Tone: ${isEmail ? "Professional, clear, polite, human." : "Natural, concise, friendly, human."}
        - Channel: ${channelName}
        - Agent review draft language: ${expectedDraftLanguage}
        - Customer send language after preview/send translation: ${customerLanguageResolution.expectedLanguage || "auto"}
        ${requestedDraftLanguage ? "- IMPORTANT: Generate this draft in the agent review draft language, not the customer send language. The app will prepare the customer-language send version separately." : ""}

        ${communicationContract}

        ${conversationalMessagingContract}

        Greeting Cadence:
        - Greeting decision: ${allowNameGreeting ? "Name greeting is ALLOWED." : "Name greeting is NOT ALLOWED."}
        - Reason: ${greetingDecisionReason}
        ${!allowNameGreeting ? '- Start directly with the message purpose and do NOT open with "Hi {FirstName},".' : ""}

        Formatting:
        ${isEmail
                ? "- Output should be valid lightweight HTML for email body (use <br> line breaks only when useful)."
                : "- Output must be plain text only."}
        - Do NOT use Markdown.
        ${!isEmail ? "- Do NOT use HTML tags." : ""}
        - Never invent URLs, map links, coordinates, addresses, or directions. Only include exact links or exact location details that appear in the context below.
        - If the contact asks for a location and no exact map/location context is provided, explain that you can share the general area only and offer to arrange/accompany a viewing.
        - Output only the message body text, no metadata.`;

        if (contact) {
            const isSeeker = !['Owner', 'Agent', 'Partner', 'Maintenance'].includes(contact.contactType);

            if (isSeeker) {
                runtimeInstruction += `\n\nContact Information:
                - Name: ${contact.name}
                - First Name (preferred for greeting): ${contactFirstName}
                - Phone: ${contact.phone}
                
                ${buildContactRequirementGuide(contact)}
                
                Property Activity:
                - Interested Properties: ${contact.propertyRoles.filter(r => r.role === 'buyer' || r.role === 'tenant' || r.role === 'viewer').map(r => r.property.title).join(", ")}
                - Inspected Properties: ${(contact.propertiesInspected || []).join(", ")}
                - Emailed Properties: ${(contact.propertiesEmailed || []).join(", ")}
                - Matched Properties: ${(contact.propertiesMatched || []).join(", ")}
                - Viewings: ${contact.viewings.map(v => `${v.date.toDateString()} at ${v.propertyId}`).join(", ")}
                `;
            } else {
                // For Owners/Agents/Partners - Focus on their roles
                runtimeInstruction += `\n\nContact Information (Type: ${contact.contactType}):
                - Name: ${contact.name}
                - First Name (preferred for greeting): ${contactFirstName}
                - Phone: ${contact.phone}
                
                Associated Properties (as ${contact.contactType}):
                ${contact.propertyRoles.filter(r => r.role.toLowerCase() === contact.contactType.toLowerCase()).map(r => `- ${r.property.title} (Role: ${r.role})`).join("\n")}
                
                Note: This contact is an ${contact.contactType}, not a lead looking to buy/rent. Focus on their associated properties.
                `;
            }
        }

        let conversationText = "";
        messages.forEach(m => {
            const sender = m.direction === 'outbound' ? 'Agent' : 'Contact';
            const timestampPrefix = m.createdAt ? `[${m.createdAt.toISOString()}] ` : "";
            conversationText += `${timestampPrefix}${sender}: ${m.body || ""}\n`;
        });
        const threadConversationText = conversationText.trim() || "[No recent thread messages found]";

        const fullPrompt = `${runtimeInstruction}

        Selected Thread Messages (for cadence/language behavior):
        ${threadConversationText}

        Timeline Context Scope:
        ${timelineScopeLabel}

        Older Timeline Summary:
        ${timelineOlderSummary}

        Recent Timeline Events (raw):
        ${timelineRecentText}

        Task:
        Draft a suggested reply for the Agent to send back to the Contact via ${channelName}.
        Prioritize the immediate reply need from the latest inbound message.
        Use the client requirement guide, Property Activity, and timeline details only when needed for relevance, factual correctness, or disambiguation.
        Treat client requirements as guidance for deciding what to mention, not as mandatory content to include in every message.
        If they are asking about a property, answer directly when status/details are present in context.
        If the property is unavailable, explain briefly and offer help finding alternatives.
        Avoid adding extra strategy, fallback scenarios, or motivational filler unless explicitly requested.
        ${isEmail ? 'Include a subject line suggestion only if a new topic is started and it reads naturally.' : 'Keep it naturally concise and direct; add detail only when required for understanding or a next action.'}
        
        Output Format:
        Just the draft message text the agent should send next.
        ${requestedDraftLanguage ? `Write the draft in ${expectedDraftLanguage}. Ignore thread-history language for output language unless the agent explicitly asks otherwise.` : ""}
        `;

        // Add current composer draft and specific user instruction if provided.
        let finalPrompt = fullPrompt;
        if (normalizedBaseDraft) {
            finalPrompt += `\n\nCURRENT COMPOSER DRAFT TO REVISE:\n${normalizedBaseDraft}\n\nRevision rules:\n1. Revise this draft; do not write a separate unrelated reply.\n2. Preserve the opening/intro, paragraph structure, factual meaning, commitments, property details, dates, times, and links unless the user instruction explicitly changes them.\n3. Do not summarize, shorten, or remove details merely because the general task says to be concise.\n4. Return only the revised send-ready message body.`;
        }
        if (normalizedInstruction) {
            if (!normalizedBaseDraft && instructionLooksSendReady) {
                finalPrompt += `\n\nOPERATOR SEND-READY DRAFT TO PRESERVE:\n${normalizedInstruction}\n\nPreservation rules:\n1. Treat the operator text above as the draft message, not as loose topic guidance.\n2. Preserve the opening/intro, paragraph structure, factual details, dates, times, property references, qualification questions, and links unless they are unsupported by context or unsafe.\n3. Do not summarize, shorten, or remove details merely because the general task says to be concise.\n4. Only make minimal grammar, clarity, and channel-fit edits.\n5. Return only the final send-ready message body.`;
            } else {
                finalPrompt += `\n\nSPECIFIC USER INSTRUCTION:\nThe user provided: "${normalizedInstruction}"\n\nYour draft MUST:\n1. Follow this instruction precisely.\n2. Treat this instruction as the primary scope for what to include.\n3. Produce a send-ready channel-appropriate message using only the wording needed.\n4. If the instruction is already close to send-ready, keep its opening, structure, and all factual details; only refine clarity/grammar.\n5. Do not add new scenarios, commitments, pressure, or side notes unless explicitly requested.\n6. Do not repeat the instruction; write the actual message the agent should send.`;
            }
        } else if (normalizedBaseDraft) {
            finalPrompt += `\n\nSPECIFIC USER INSTRUCTION:\nImprove the current composer draft for clarity, concision, and channel-appropriate tone without changing its factual meaning.`;
        }

        telemetry.prompt.chars = finalPrompt.length;
        telemetry.prompt.threadMessageCount = messages.length;
        telemetry.prompt.timelineIncludedEvents = timelineCompaction.stats.includedEvents;
        telemetry.prompt.timelineOmittedEvents = timelineCompaction.stats.omittedEvents;
        telemetry.model.actual = actualModelName;
        telemetry.stageMs.contextAssemblyMs = Date.now() - contextAssemblyStartedAt;

        console.log("[AI Draft] Prompt stats:", JSON.stringify({
            conversationId: context.conversationId,
            mode: requestedTimelineMode,
            requestedModel: requestedModelName,
            resolvedModel: actualModelName,
            contextAssemblyMs: telemetry.stageMs.contextAssemblyMs,
            promptChars: telemetry.prompt.chars,
            threadMessages: telemetry.prompt.threadMessageCount,
            timelineIncludedEvents: telemetry.prompt.timelineIncludedEvents,
            timelineOmittedEvents: telemetry.prompt.timelineOmittedEvents,
            isComplexDraft,
            latencyMode: isFastDraft ? "fast" : "full",
            maxOutputTokens,
            thinkingBudget,
            instruction: normalizedInstruction
                ? {
                    ...summarizeDraftInstructionForLog(normalizedInstruction),
                    sendReady: instructionLooksSendReady,
                    hasExplicitOpeningGreeting: hasExplicitOpeningGreeting(normalizedInstruction),
                }
                : null,
            baseDraft: normalizedBaseDraft
                ? {
                    ...summarizeDraftInstructionForLog(normalizedBaseDraft),
                    hasExplicitOpeningGreeting: hasExplicitOpeningGreeting(normalizedBaseDraft),
                }
                : null,
            operatorGreetingOverride: hasOperatorGreeting,
            requestedDraftLanguage,
            expectedDraftLanguage,
            customerSendLanguage: customerLanguageResolution.expectedLanguage,
        }));

        const cachedStaticContext = `${DRAFT_STATIC_CONTEXT_PROMPT}

${conversationalMessagingContract}

Business Profile:
- Agent Name: ${agentName || "Unknown"}
- Business Name: ${businessName}
${websiteDomain ? `- Website: https://${websiteDomain}` : "- Website: Unknown"}
${brandVoice ? `- Brand Voice: ${brandVoice}` : "- Brand Voice: Not provided"}
- Channel: ${channelName}
- Tone style: ${isEmail ? "Professional Email" : "Conversational Messaging"}
- Static context version: ${DRAFT_STATIC_CONTEXT_VERSION}`;

        // 4. Call Gemini (with one-time model fallback and 429 backoff).
        const generateWithModel = async (candidateModel: string) => {
            const cacheModel = await getDraftModelWithCachedContext({
                apiKey,
                modelName: candidateModel,
                generationConfig,
                cacheKey: [
                    DRAFT_STATIC_CONTEXT_VERSION,
                    context.locationId,
                    isEmail ? "email" : "chat",
                    businessName.toLowerCase(),
                ].join(":"),
                staticContextText: cachedStaticContext,
                ttlSeconds: 45 * 60,
            });
            telemetry.cache.state = cacheModel.cacheState;
            telemetry.cache.name = cacheModel.cacheName || null;

            let attempt = 0;
            while (true) {
                try {
                    if (context.stream && typeof context.onToken === "function") {
                        telemetry.model.streamed = true;
                        const streamStartedAt = Date.now();
                        const streamResult = await cacheModel.model.generateContentStream(finalPrompt);
                        let rawText = "";
                        let firstTokenSeen = false;

                        for await (const chunk of streamResult.stream) {
                            const delta = chunk.text();
                            if (!delta) continue;
                            rawText = appendAiStreamText(rawText, delta);
                            if (!firstTokenSeen) {
                                firstTokenSeen = true;
                                telemetry.stageMs.firstTokenMs = Date.now() - streamStartedAt;
                                console.info("[AI Draft Timing]", JSON.stringify({
                                    event: "generateDraft_first_token",
                                    ts: new Date().toISOString(),
                                    conversationId: context.conversationId,
                                    firstTokenMs: telemetry.stageMs.firstTokenMs,
                                }));
                            }
                            context.onToken(delta);
                        }

                        const response = await streamResult.response;
                        const responseText = response.text();

                        return { response, rawText: responseText || rawText };
                    }

                    const result = await cacheModel.model.generateContent(finalPrompt);
                    return { response: result.response, rawText: result.response.text() };
                } catch (error) {
                    const shouldRetry = isRateLimitError(error) && attempt < DRAFT_MAX_RETRIES_ON_429;
                    if (!shouldRetry) throw error;

                    const jitterMs = Math.floor(Math.random() * 90);
                    const delayMs = DRAFT_RETRY_BASE_DELAY_MS * (2 ** attempt) + jitterMs;
                    await wait(delayMs);
                    attempt += 1;
                }
            }
        };

        const geminiStartedAt = Date.now();
        let generationResult: { response: any; rawText: string };
        try {
            generationResult = await generateWithModel(actualModelName);
        } catch (error) {
            const canRetryWithPinnedFlash =
                (actualModelName === GEMINI_FLASH_LATEST_ALIAS || actualModelName === GEMINI_DRAFT_FAST_DEFAULT) &&
                isModelUnavailableError(error);

            if (!canRetryWithPinnedFlash) {
                throw error;
            }

            actualModelName = GEMINI_FLASH_STABLE_FALLBACK;
            telemetry.model.actual = actualModelName;
            telemetry.model.fallbackUsed = true;
            console.warn(`[AI Draft] Requested model ${requestedModelName} unavailable; retrying with ${actualModelName}.`);
            generationResult = await generateWithModel(actualModelName);
        }
        telemetry.stageMs.geminiMs = Date.now() - geminiStartedAt;

        const postProcessingStartedAt = Date.now();

        const response = generationResult.response;
        const rawText = generationResult.rawText;

        // Detect truncation via finishReason
        const finishReason = response?.candidates?.[0]?.finishReason;
        const wasTruncated = finishReason === "MAX_TOKENS";
        if (wasTruncated) {
            console.warn(`[AI Draft] Output was truncated (finishReason=MAX_TOKENS). Model: ${actualModelName}, maxOutputTokens: ${maxOutputTokens}.`);
        }
        const withoutRepeatedGreeting = stripLeadingNameGreeting(rawText, contactFirstName, allowNameGreeting);
        if (withoutRepeatedGreeting !== rawText) {
            console.log("[AI Draft] Removed leading name greeting based on timing rule.");
        }
        const withoutSignature = stripManualSignatureBlock(withoutRepeatedGreeting);
        if (withoutSignature !== withoutRepeatedGreeting) {
            console.log("[AI Draft] Removed manual signature block from draft output.");
        }
        const instructionEnforced = enforceMapSharingInstruction(withoutSignature, normalizedInstruction);
        if (instructionEnforced !== withoutSignature) {
            console.warn("[AI Draft] Removed map URL due to user map-sharing instruction.");
        }
        const text = stripUngroundedMapUrls(instructionEnforced, finalPrompt);
        if (text !== instructionEnforced) {
            console.warn("[AI Draft] Removed ungrounded map URL from draft output.");
        }
        const draftLanguage = detectLanguageFromText(text);
        const policyEvidence = inferCommunicationEvidenceFromText(`${conversationText}\n${timelineRecentText}\n${context.instruction || ""}`);
        const policyResult = await validateAction({
            intent: "DRAFT_REPLY",
            risk: "medium",
            actions: [],
            draftReply: text,
            expectedLanguage: expectedDraftLanguage,
            latestInboundLanguage: customerLanguageResolution.latestInboundLanguage,
            draftLanguage,
            hasConfirmedReservation: policyEvidence.hasConfirmedReservation,
            hasConfirmedDeposit: policyEvidence.hasConfirmedDeposit,
            hasCompetingOfferEvidence: policyEvidence.hasCompetingOfferEvidence,
            authoritySource: policyEvidence.authoritySource,
        });
        const requiresHumanApproval = !policyResult.approved || policyResult.reviewRequired;
        const policySummary = requiresHumanApproval
            ? ` Policy check: ${policyResult.reason}.`
            : "";

        // 5. Track Costs & Usage
        if (response.usageMetadata) {
            const usageMeta = (response.usageMetadata || {}) as Record<string, unknown>;
            promptTokens = getUsageInt(usageMeta, "promptTokenCount");
            completionTokens = getUsageInt(usageMeta, "candidatesTokenCount");
            telemetry.usage.totalTokens = getUsageInt(usageMeta, "totalTokenCount");
            telemetry.usage.thoughtsTokens = getUsageInt(usageMeta, "thoughtsTokenCount");
            telemetry.usage.cachedContentTokens = getUsageInt(usageMeta, "cachedContentTokenCount");
            telemetry.usage.toolUsePromptTokens = getUsageInt(usageMeta, "toolUsePromptTokenCount");
        } else {
            // Fallback estimate if API doesn't return usage
            promptTokens = Math.ceil(finalPrompt.length / 4);
            completionTokens = Math.ceil(text.length / 4);
            telemetry.usage.totalTokens = promptTokens + completionTokens;
        }
        telemetry.usage.promptTokens = promptTokens;
        telemetry.usage.completionTokens = completionTokens;
        if (!telemetry.usage.totalTokens) {
            telemetry.usage.totalTokens = promptTokens + completionTokens;
        }

        const cost = calculateRunCost(actualModelName, promptTokens, completionTokens);
        const modelAuditNote = requestedModelName === actualModelName
            ? `Model: ${actualModelName}`
            : `Requested model: ${requestedModelName}; actual model used: ${actualModelName}`;

        // 6. Persist to DB
        // Determine DB conversation ID (internal) — try both ghlConversationId and local id
        let dbConversation = await db.conversation.findFirst({
            where: buildConversationReferenceWhere(context.locationId, context.conversationId),
            select: { id: true }
        });

        let agentExecutionId: string | null = null;
        if (dbConversation) {
            // Log Execution
            const agentExecution = await db.agentExecution.create({
                data: {
                    conversationId: dbConversation.id,
                    locationId: context.locationId,
                    taskId: "quick-draft",
                    taskTitle: "Quick AI Draft",
                    taskStatus: "done",
                    thoughtSummary: `Generated draft reply based on conversation context. ${modelAuditNote}.${policySummary}`,
                    latencyMs: Math.max(1, Date.now() - overallStartedAt),
                    status: "done",
                    toolCalls: [{
                        tool: "gemini.generateContent",
                        arguments: {
                            model: actualModelName,
                            streamed: telemetry.model.streamed,
                            maxOutputTokens,
                            thinkingBudget,
                            cacheState: telemetry.cache.state,
                        },
                        result: {
                            usage: telemetry.usage,
                            latencyMs: telemetry.stageMs.geminiMs,
                            firstTokenMs: telemetry.stageMs.firstTokenMs,
                            cacheName: telemetry.cache.name,
                        }
                    }] as any,
                    draftReply: text,
                    promptTokens,
                    completionTokens,
                    totalTokens: promptTokens + completionTokens,
                    model: actualModelName,
                    cost
                },
                select: { id: true }
            });
            agentExecutionId = agentExecution.id;

            // Update Conversation Totals
            await db.conversation.update({
                where: { id: dbConversation.id },
                data: {
                    promptTokens: { increment: promptTokens },
                    completionTokens: { increment: completionTokens },
                    totalTokens: { increment: promptTokens + completionTokens },
                    totalCost: { increment: cost }
                }
            });

            await securelyRecordAiUsage({
                locationId: context.locationId,
                resourceType: "conversation",
                resourceId: dbConversation.id,
                featureArea: "conversational_ai",
                action: "generate_draft",
                provider: "google_gemini",
                model: actualModelName,
                inputTokens: promptTokens,
                outputTokens: completionTokens,
            });
        }

        telemetry.stageMs.postProcessingMs = Date.now() - postProcessingStartedAt;
        telemetry.stageMs.totalMs = Date.now() - overallStartedAt;
        console.info("[AI Draft Timing]", JSON.stringify({
            event: "generateDraft_complete",
            ts: new Date().toISOString(),
            conversationId: context.conversationId,
            stageMs: telemetry.stageMs,
            model: telemetry.model,
            prompt: telemetry.prompt,
        }));

        return {
            draft: text,
            generationId: agentExecutionId,
            agentExecutionId,
            traceId: null,
            model: actualModelName,
            reasoning: requestedModelName === actualModelName
                ? `Generated based on conversation history and contact interest.${policySummary}`
                : `Generated based on conversation history and contact interest. Fallback used: ${actualModelName} (requested ${requestedModelName}).${policySummary}`,
            requiresHumanApproval,
            policyResult,
            expectedLanguage: expectedDraftLanguage,
            draftLanguage,
            truncated: wasTruncated,
            telemetry,
        };

    } catch (error: any) {
        console.error("AI Coordinator Error:", error);

        // Return clearer error message to UI
        let message = "Error generating draft.";
        if (error.message?.includes("API key")) message = "Invalid or missing API Key.";
        if (error.message?.includes("429")) message = "AI Rate limit exceeded. Try again later.";
        telemetry.stageMs.totalMs = Date.now() - overallStartedAt;
        console.info("[AI Draft Timing]", JSON.stringify({
            event: "generateDraft_failed",
            ts: new Date().toISOString(),
            conversationId: context.conversationId,
            stageMs: telemetry.stageMs,
            model: telemetry.model,
            reason: error?.message || String(error),
        }));

        // Persist error to AgentExecution so it shows in Thinking Trace & Usage Dashboard
        try {
            let errorDbConversation = await db.conversation.findFirst({
                where: buildConversationReferenceWhere(context.locationId, context.conversationId),
                select: { id: true }
            });
            if (errorDbConversation) {
                const errorCost = calculateRunCost(
                    telemetry.model.actual,
                    telemetry.usage.promptTokens,
                    telemetry.usage.completionTokens
                );
                await db.agentExecution.create({
                    data: {
                        conversationId: errorDbConversation.id,
                        locationId: context.locationId,
                        taskId: "quick-draft",
                        taskTitle: "Quick AI Draft",
                        taskStatus: "error",
                        thoughtSummary: `Draft generation failed: ${error.message || "Unknown error"}`,
                        latencyMs: Math.max(1, Date.now() - overallStartedAt),
                        status: "error",
                        errorMessage: String(error.message || "Unknown error").slice(0, 1000),
                        toolCalls: [{
                            tool: "gemini.generateContent",
                            arguments: {
                                model: telemetry.model.actual,
                                streamed: telemetry.model.streamed,
                                maxOutputTokens: telemetry.model.maxOutputTokens,
                                thinkingBudget: telemetry.model.thinkingBudget,
                                cacheState: telemetry.cache.state,
                            },
                            result: { error: message },
                        }] as any,
                        promptTokens: telemetry.usage.promptTokens,
                        completionTokens: telemetry.usage.completionTokens,
                        totalTokens: telemetry.usage.promptTokens + telemetry.usage.completionTokens,
                        model: telemetry.model.actual,
                        cost: errorCost,
                    }
                });
                if (telemetry.usage.promptTokens > 0 || telemetry.usage.completionTokens > 0) {
                    await db.conversation.update({
                        where: { id: errorDbConversation.id },
                        data: {
                            promptTokens: { increment: telemetry.usage.promptTokens },
                            completionTokens: { increment: telemetry.usage.completionTokens },
                            totalTokens: { increment: telemetry.usage.promptTokens + telemetry.usage.completionTokens },
                            totalCost: { increment: errorCost },
                        }
                    });

                    await securelyRecordAiUsage({
                        locationId: context.locationId,
                        resourceType: "conversation",
                        resourceId: errorDbConversation.id,
                        featureArea: "conversational_ai",
                        action: "generate_draft_error",
                        provider: "google_gemini",
                        model: telemetry.model.actual,
                        inputTokens: telemetry.usage.promptTokens,
                        outputTokens: telemetry.usage.completionTokens,
                    });
                }
            }
        } catch (dbError) {
            console.error("[AI Draft] Failed to persist error execution:", dbError);
        }

        return {
            draft: message,
            reasoning: `Technical Error: ${error.message || "Unknown error"}`,
            telemetry,
        };
    }
}
