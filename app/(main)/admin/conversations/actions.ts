'use server';

import { getLocationContext } from "@/lib/auth/location-context";
import { getConversations, getMessages, getConversation, sendMessage, getMessage, Conversation, Message } from "@/lib/ghl/conversations";
import { generateDraft } from "@/lib/ai/coordinator";
import { refreshGhlAccessToken } from "@/lib/location";
import db from "@/lib/db";
import { updateConversationLastMessage } from "@/lib/conversations/update";
import { seedConversationFromContactLeadText } from "@/lib/conversations/bootstrap";
import { generateMultiContextDraft } from "@/lib/ai/context-builder";
import { ensureLocalContactSynced } from "@/lib/crm/contact-sync";
import { ensureConversationHistory, syncMessageFromWebhook } from "@/lib/ghl/sync";
import { checkGHLSMSStatus } from "@/lib/ghl/sms";
import { calculateRunCost, calculateRunCostFromUsage } from "@/lib/ai/pricing";
import { securelyRecordAiUsage } from "@/lib/ai/usage-metering";
import { DEFAULT_REPLY_LANGUAGE, normalizeReplyLanguage } from "@/lib/ai/reply-language-options";
import { getLocationDefaultReplyLanguage } from "@/lib/ai/location-reply-language";
import { z } from "zod";
import { getModelForTask } from "@/lib/ai/model-router";
import { callLLM, callLLMWithMetadata } from "@/lib/ai/llm";
import { GEMINI_DRAFT_FAST_DEFAULT } from "@/lib/ai/models";
import { auth } from "@clerk/nextjs/server";
import { Prisma } from "@prisma/client";
import { revalidatePath, revalidateTag, unstable_cache } from "next/cache";
import { createHash } from "crypto";
import { runGoogleAutoSyncForContact } from "@/lib/google/automation";
import { createContactTask } from "@/app/(main)/admin/tasks/actions";
import { isLocalDateTimeWithoutZone } from "@/lib/tasks/datetime-local";
import { createTraceId, withServerTiming } from "@/lib/observability/performance";
import { getConversationFeatureFlags } from "@/lib/feature-flags";
import { publishConversationRealtimeEvent } from "@/lib/realtime/conversation-events";
import { withResilience } from "@/lib/external/resilience";
import { assembleTimelineEvents } from "@/lib/conversations/timeline-events";
import { buildMessageCursorFromMessage } from "@/lib/conversations/thread-hydration";
import { buildMessageTranslationState, getResolvedConversationTranslationLanguage } from "@/lib/conversations/translation-view";
import { settingsService } from "@/lib/settings/service";
import { SETTINGS_DOMAINS } from "@/lib/settings/constants";
import {
    AiAutomationConfigSchema,
    cadenceToDays,
} from "@/lib/ai/automation/config";
import {
    AiSkillPolicySchema,
} from "@/lib/ai/runtime/config";
import {
    runAiRuntimeCron,
    runAiSkillDecision,
    simulateSkillDecision as simulateSkillDecisionRuntime,
} from "@/lib/ai/runtime/engine";
import {
    buildWhatsAppOutboundUploadKey,
    createWhatsAppMediaUploadUrl as createWhatsAppMediaUploadSignedUrl,
    deleteWhatsAppMediaObject,
    headWhatsAppMediaObject,
    parseR2Uri,
} from "@/lib/whatsapp/media-r2";
import { ingestEvolutionMediaAttachment, parseEvolutionMessageContent } from "@/lib/whatsapp/evolution-media";
import { enqueueWhatsAppOutbound } from "@/lib/whatsapp/outbound-enqueue";
import {
    canOpenDirectChatForParticipant,
    formatGroupParticipantIdentitySummary,
} from "@/lib/whatsapp/group-participants";
import {
    enqueueWhatsAppAudioTranscription,
    initWhatsAppAudioTranscriptionWorker,
} from "@/lib/queue/whatsapp-audio-transcription";
import {
    enqueueWhatsAppAudioExtraction,
    initWhatsAppAudioExtractionWorker,
} from "@/lib/queue/whatsapp-audio-extraction";
import type { ViewingSyncProviderDecision } from "@/lib/viewings/sync-engine";
import {
    extractClockTimeFromText,
    extractPropertyRefsFromText,
    extractPropertySlugCandidatesFromText,
    extractPropertySlugsFromUrls,
    formatIsoDateInTimeZone,
    normalizeIanaTimeZone,
    normalizeViewingDate,
    normalizeViewingTime,
    resolveRelativeViewingDateFromText,
    shiftIsoDate,
} from "@/lib/viewings/suggestion-parsing";
import { normalizeInternationalPhone } from "@/lib/utils/phone";

const MAX_SELECTION_TEXT_LENGTH = 12000;
const MAX_CUSTOM_OUTPUT_LENGTH = 2200;
const CRM_LOG_DEDUPE_RECENT_LIMIT = 30;
const LEAD_PARSE_MAX_INPUT_LENGTH = 8000;
const LEAD_PARSE_MAX_OUTPUT_TOKENS = 350;
const LEAD_PARSE_THINKING_BUDGET = 0;
const WHATSAPP_TRANSCRIPT_BULK_DEFAULT_WINDOW_DAYS = 30;
const MAX_TASK_SUGGESTIONS = 6;
const MAX_TASK_SUGGESTION_TITLE_LENGTH = 180;
const MAX_TASK_SUGGESTION_DESCRIPTION_LENGTH = 3000;
const TASK_SUGGESTION_FUNNEL_EVENT_TYPES = {
    generateRequested: "task_suggestion.generate.requested",
    generateSucceeded: "task_suggestion.generate.succeeded",
    generateFailed: "task_suggestion.generate.failed",
    applyRequested: "task_suggestion.apply.requested",
    applyCompleted: "task_suggestion.apply.completed",
    applyFailed: "task_suggestion.apply.failed",
} as const;
const TASK_SUGGESTION_FUNNEL_EVENT_TYPE_VALUES = Object.values(TASK_SUGGESTION_FUNNEL_EVENT_TYPES);

type TaskSuggestionFunnelEventType = typeof TASK_SUGGESTION_FUNNEL_EVENT_TYPES[keyof typeof TASK_SUGGESTION_FUNNEL_EVENT_TYPES];
const TRANSCRIPT_VISIBILITY_POLICIES = {
    team: "team",
    adminOnly: "admin_only",
} as const;
const TRANSCRIPT_MANUAL_AUDIT_EVENT_TYPES = {
    request: "audio_transcript.manual.requested",
    retry: "audio_transcript.manual.retried",
    bulkRequest: "audio_transcript.manual.bulk_requested",
    extract: "audio_transcript.manual.extraction_requested",
} as const;

type TranscriptVisibilityPolicy = typeof TRANSCRIPT_VISIBILITY_POLICIES[keyof typeof TRANSCRIPT_VISIBILITY_POLICIES];
type TranscriptManualAuditEventType = typeof TRANSCRIPT_MANUAL_AUDIT_EVENT_TYPES[keyof typeof TRANSCRIPT_MANUAL_AUDIT_EVENT_TYPES];

const TaskSuggestionPrioritySchema = z.enum(["low", "medium", "high"]);
const ImproveNoteTypeSchema = z.enum(["activity", "viewing"]);
const ImproveNoteInputSchema = z.object({
    text: z.string().trim().min(3),
    noteType: ImproveNoteTypeSchema,
    conversationId: z.string().trim().optional(),
    contactId: z.string().trim().optional(),
    modelOverride: z.string().trim().optional(),
    context: z.object({
        propertyReference: z.string().trim().max(140).optional(),
        scheduledAtIso: z.string().trim().max(80).optional(),
        scheduledLocal: z.string().trim().max(80).optional(),
    }).optional(),
});

const SelectionTaskSuggestionSchema = z.object({
    title: z.string().min(1).max(MAX_TASK_SUGGESTION_TITLE_LENGTH),
    description: z.string().max(MAX_TASK_SUGGESTION_DESCRIPTION_LENGTH).optional().nullable(),
    priority: TaskSuggestionPrioritySchema.optional().nullable(),
    dueAt: z.string().optional().nullable(),
    confidence: z.number().min(0).max(1).optional().nullable(),
    reason: z.string().max(500).optional().nullable(),
});

const SelectionTaskSuggestionEnvelopeSchema = z.object({
    suggestions: z.array(SelectionTaskSuggestionSchema).max(MAX_TASK_SUGGESTIONS),
});

const ApplySelectionTaskSuggestionSchema = z.object({
    title: z.string().trim().min(1).max(MAX_TASK_SUGGESTION_TITLE_LENGTH),
    description: z.string().trim().max(MAX_TASK_SUGGESTION_DESCRIPTION_LENGTH).optional().nullable(),
    priority: TaskSuggestionPrioritySchema.optional().nullable(),
    dueAt: z.string().optional().nullable(),
    confidence: z.number().min(0).max(1).optional().nullable(),
    reason: z.string().max(500).optional().nullable(),
});

const ApplySelectionTaskSuggestionBatchSchema = z.array(ApplySelectionTaskSuggestionSchema)
    .min(1)
    .max(MAX_TASK_SUGGESTIONS);

const TaskSuggestionFunnelMetricsInputSchema = z.object({
    days: z.number().int().min(1).max(180).optional(),
    scope: z.enum(["location", "conversation"]).default("location"),
    conversationId: z.string().trim().optional(),
}).optional();

export type SelectionTaskSuggestion = {
    title: string;
    description: string | null;
    priority: z.infer<typeof TaskSuggestionPrioritySchema>;
    dueAt: string | null;
    confidence: number;
    reason: string | null;
};

function trimSelectionText(text: string, maxLength: number = MAX_SELECTION_TEXT_LENGTH): string {
    const normalized = String(text || "").replace(/\u00a0/g, " ").trim();
    if (!normalized) return "";
    if (normalized.length <= maxLength) return normalized;
    return normalized.slice(0, maxLength);
}

function normalizeLeadParseInput(text: string, maxLength: number = LEAD_PARSE_MAX_INPUT_LENGTH): string {
    const normalized = String(text || "")
        .replace(/\u00a0/g, " ")
        .replace(/\r\n/g, "\n")
        .trim();
    if (!normalized) return "";
    if (normalized.length <= maxLength) return normalized;
    return normalized.slice(0, maxLength);
}

/**
 * Enterprise-grade JSON normalizer for LLM outputs.
 * 
 * LLMs often produce invalid JSON when asked to output heavily line-wrapped or formatted
 * natural language text (e.g. email bodies) inside JSON string values. They frequently
 * output literal newlines (\n) instead of escaped newlines (\\n).
 * 
 * This state machine fixes malformed JSON by escaping unescaped control characters 
 * strictly within JSON string literals.
 */
function sanitizeLlmJson(input: string): string {
    let inString = false;
    let isEscaped = false;
    let sanitized = '';

    for (let i = 0; i < input.length; i++) {
        const char = input[i];

        if (char === '\\' && !isEscaped) {
            isEscaped = true;
            sanitized += char;
            continue;
        }

        if (char === '"' && !isEscaped) {
            inString = !inString;
            sanitized += char;
        } else if (inString) {
            // Escape common unescaped control characters inside string literals
            if (char === '\n') {
                sanitized += '\\n';
            } else if (char === '\r') {
                sanitized += '\\r';
            } else if (char === '\t') {
                sanitized += '\\t';
            } else if (char === '\f') {
                sanitized += '\\f';
            } else if (char === '\b') {
                sanitized += '\\b';
            } else {
                sanitized += char;
            }
        } else {
            sanitized += char;
        }

        isEscaped = false;
    }

    return sanitized;
}

function parseJsonObjectFromModelOutput(rawText: string): any {
    const cleanJson = String(rawText || "")
        .replace(/```json/gi, "")
        .replace(/```/g, "")
        .trim();

    const sanitizedJson = sanitizeLlmJson(cleanJson);

    try {
        return JSON.parse(sanitizedJson);
    } catch {
        const firstBrace = sanitizedJson.indexOf("{");
        const lastBrace = sanitizedJson.lastIndexOf("}");
        if (firstBrace >= 0 && lastBrace > firstBrace) {
            try {
                return JSON.parse(sanitizedJson.slice(firstBrace, lastBrace + 1));
            } catch (innerError) {
                // Fall back to original cleanJson slicing on the rare chance 
                // sanitization altered meaning, though this is a final resort
            }
        }
        throw new Error("Model did not return a valid JSON object");
    }
}

function runDetachedTask(taskName: string, task: () => Promise<void>) {
    void task().catch((error) => {
        console.error(`[DetachedTask:${taskName}] Failed:`, error);
    });
}

const DEFAULT_TRANSLATION_TARGET_LANGUAGE = "en";
const MESSAGE_TRANSLATION_STATUS = {
    completed: "completed",
    failed: "failed",
} as const;

function stripHtmlToText(input: string): string {
    return String(input || "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
        .replace(/<[^>]*>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/\s+/g, " ")
        .trim();
}

function normalizeTranslationTargetLanguage(
    input: string | null | undefined,
    fallback: string = DEFAULT_TRANSLATION_TARGET_LANGUAGE
): string {
    return normalizeReplyLanguage(input) || fallback;
}

function buildTranslationSourceHash(sourceText: string): string {
    return createHash("sha256").update(String(sourceText || "").trim(), "utf8").digest("hex");
}

async function runMessageTranslationLLM(args: {
    sourceText: string;
    targetLanguage: string;
    modelOverride?: string;
}) {
    const modelId = String(args.modelOverride || "").trim() || getModelForTask("simple_generation");
    const systemPrompt = [
        "You are a translation assistant for enterprise SaaS conversation inboxes.",
        "Translate the source text to the requested target language while preserving meaning, tone, and business intent.",
        "Do not add or remove factual content.",
        "Return strict JSON: {\"translatedText\": string, \"detectedSourceLanguage\": string, \"confidence\": number}.",
        "Confidence must be a number between 0 and 1.",
    ].join("\n");
    const userPrompt = [
        `Target language (BCP-47): ${args.targetLanguage}`,
        "Source text:",
        String(args.sourceText || ""),
    ].join("\n\n");

    const { text, usage } = await callLLMWithMetadata(
        modelId,
        systemPrompt,
        userPrompt,
        { jsonMode: true, temperature: 0.1, maxOutputTokens: 1200, thinkingBudget: 0 }
    );
    const parsed = parseJsonObjectFromModelOutput(text);
    const translatedText = String((parsed as any)?.translatedText || "").trim();
    if (!translatedText) {
        throw new Error("Translation model returned empty output.");
    }

    const detectedSourceLanguage = normalizeReplyLanguage(String((parsed as any)?.detectedSourceLanguage || "").trim()) || null;
    const confidenceRaw = Number((parsed as any)?.confidence);
    const confidence = Number.isFinite(confidenceRaw)
        ? Math.min(1, Math.max(0, confidenceRaw))
        : null;

    return {
        translatedText,
        detectedSourceLanguage,
        confidence,
        provider: "google",
        model: modelId,
        usage,
    };
}

function normalizeSingleLine(text: string, fallback: string): string {
    const cleaned = String(text || "")
        .replace(/```[\s\S]*?```/g, " ")
        .replace(/[\r\n]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    if (!cleaned) return fallback;
    return cleaned;
}

function normalizeSuggestionPriority(value: unknown): z.infer<typeof TaskSuggestionPrioritySchema> {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized === "low" || normalized === "high") return normalized;
    return "medium";
}

function normalizeSuggestionDueAt(value: unknown): string | null {
    const raw = String(value || "").trim();
    if (!raw) return null;
    if (isLocalDateTimeWithoutZone(raw)) return raw;
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString();
}

function normalizeSuggestionConfidence(value: unknown): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0.5;
    if (numeric < 0) return 0;
    if (numeric > 1) return 1;
    return Math.round(numeric * 100) / 100;
}

function getPayloadObject(payload: unknown): Record<string, unknown> {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
    return payload as Record<string, unknown>;
}

function getPayloadNumber(payload: unknown, key: string): number {
    const numeric = Number(getPayloadObject(payload)[key]);
    if (!Number.isFinite(numeric)) return 0;
    return numeric;
}

function toIsoDayKey(date: Date): string {
    return date.toISOString().slice(0, 10);
}

function safeRatio(numerator: number, denominator: number): number {
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0;
    return numerator / denominator;
}

function formatLogDate(date: Date): string {
    const dd = String(date.getDate()).padStart(2, "0");
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const yy = String(date.getFullYear()).slice(-2);
    return `${dd}.${mm}.${yy}`;
}

function normalizeFirstNameToken(value: string | null | undefined): string {
    const cleaned = String(value || "")
        .trim()
        .replace(/^[^\p{L}]+/u, "")
        .replace(/[^\p{L}'-]+$/gu, "");

    if (!cleaned) return "";
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function deriveFirstNameFromEmail(email: string | null | undefined): string {
    const rawEmail = String(email || "").trim().toLowerCase();
    if (!rawEmail || !rawEmail.includes("@")) return "";

    const [rawLocal, rawDomain] = rawEmail.split("@");
    let local = String(rawLocal || "").split("+")[0].trim();
    const domain = String(rawDomain || "").trim();

    if (!local) return "";

    // If local-part ends with a domain stem (e.g. "martindowntowncyprus@mg.downtowncyprus.com"),
    // strip it so the remaining prefix can be used as first name.
    const labels = domain.split(".").map((l) => l.trim()).filter(Boolean);
    const domainStems = Array.from(new Set([
        labels.length >= 2 ? labels[labels.length - 2] : "",
        ...labels.filter((l) => l.length >= 4),
    ]))
        .filter(Boolean)
        .sort((a, b) => b.length - a.length);

    for (const stem of domainStems) {
        if (local.endsWith(stem) && local.length > stem.length + 1) {
            local = local.slice(0, -stem.length);
            break;
        }
    }

    const token = local
        .replace(/[._-]+/g, " ")
        .trim()
        .split(/\s+/)[0] || "";

    return normalizeFirstNameToken(token);
}

function deriveOptionalFirstName(
    firstName: string | null | undefined,
    name: string | null | undefined,
    email: string | null | undefined
): string {
    const normalizedFirstName = normalizeFirstNameToken(firstName);
    if (normalizedFirstName) return normalizedFirstName;

    const rawName = String(name || "").trim();
    if (rawName) {
        const fromName = normalizeFirstNameToken(rawName.split(/\s+/)[0]);
        if (fromName) return fromName;
    }

    const fromEmail = deriveFirstNameFromEmail(email);
    if (fromEmail) return fromEmail;

    return "";
}

function deriveFirstName(
    firstName: string | null | undefined,
    name: string | null | undefined,
    email: string | null | undefined
): string {
    const preferred = deriveOptionalFirstName(firstName, name, email);
    if (preferred) return preferred;

    return "User";
}

function normalizePhoneDigits(value: string | null | undefined): string {
    return String(value || "").replace(/\D/g, "");
}

function phoneDigitsLikelyMatch(a: string, b: string): boolean {
    const left = String(a || "").trim();
    const right = String(b || "").trim();
    if (!left || !right) return false;
    if (left === right) return true;
    if (left.length < 7 || right.length < 7) return false;
    return left.endsWith(right) || right.endsWith(left);
}

function escapeRegExp(value: string): string {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeParticipantDisplayName(value: string | null | undefined): string {
    return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeContactPhoneForStorage(value: string | null | undefined): string | null {
    const raw = String(value || "").trim();
    if (!raw) return null;
    if (raw.startsWith("+")) return raw;
    const digits = normalizePhoneDigits(raw);
    return digits ? `+${digits}` : null;
}

function buildGroupParticipantDraftName(participant: {
    displayName?: string | null;
    phoneDigits?: string | null;
    lidJid?: string | null;
    participantJid?: string | null;
}) {
    const displayName = normalizeParticipantDisplayName(participant.displayName);
    if (displayName) return displayName;
    if (participant.phoneDigits) return `WhatsApp ${participant.phoneDigits}`;
    if (participant.lidJid) return `WhatsApp ${participant.lidJid}`;
    if (participant.participantJid) return `WhatsApp ${participant.participantJid}`;
    return "WhatsApp Contact";
}

async function getScopedConversationParticipant(locationId: string, participantId: string) {
    return db.conversationParticipant.findFirst({
        where: {
            id: participantId,
            conversation: { locationId },
        },
        include: {
            contact: {
                select: {
                    id: true,
                    name: true,
                    phone: true,
                    email: true,
                    contactType: true,
                },
            },
            conversation: {
                select: {
                    id: true,
                    ghlConversationId: true,
                    locationId: true,
                    contactId: true,
                    contact: {
                        select: {
                            id: true,
                            name: true,
                            phone: true,
                            contactType: true,
                        },
                    },
                },
            },
        },
    });
}

async function findLikelyContactsForGroupParticipant(locationId: string, participant: {
    id: string;
    phoneDigits?: string | null;
    lidJid?: string | null;
    displayName?: string | null;
    contactId?: string | null;
}) {
    const phoneDigits = normalizePhoneDigits(participant.phoneDigits);
    const lidRaw = String(participant.lidJid || "").replace("@lid", "").trim();
    const displayName = normalizeParticipantDisplayName(participant.displayName);
    const nameTokens = displayName.split(/\s+/).filter(Boolean);

    const candidates = await db.contact.findMany({
        where: {
            locationId,
            ...(participant.contactId ? { id: { not: participant.contactId } } : {}),
            OR: [
                ...(phoneDigits && phoneDigits.length >= 7 ? [{ phone: { contains: phoneDigits.slice(-7) } }] : []),
                ...(lidRaw ? [{ lid: { contains: lidRaw } }] : []),
                ...(displayName && displayName.length >= 3
                    ? [{ name: { contains: displayName, mode: "insensitive" as const } }]
                    : []),
                ...(nameTokens.length >= 2
                    ? [{ name: { contains: nameTokens[0], mode: "insensitive" as const } }]
                    : []),
            ],
        },
        select: {
            id: true,
            name: true,
            phone: true,
            email: true,
            contactType: true,
            lid: true,
        },
        take: 12,
    });

    const seen = new Set<string>();
    const ranked = candidates
        .map((contact) => {
            const contactDigits = normalizePhoneDigits(contact.phone);
            const contactLidRaw = String(contact.lid || "").replace("@lid", "").trim();
            const phoneMatch = !!(phoneDigits && contactDigits && phoneDigitsLikelyMatch(phoneDigits, contactDigits));
            const lidMatch = !!(lidRaw && contactLidRaw && lidRaw === contactLidRaw);
            const exactNameMatch = !!(displayName && contact.name && displayName.toLowerCase() === String(contact.name).trim().toLowerCase());
            const looseNameMatch = !!(displayName && contact.name && String(contact.name).toLowerCase().includes(displayName.toLowerCase()));

            let rank = 0;
            let matchReason = "Name suggestion";
            if (phoneMatch) {
                rank = 1;
                matchReason = "Phone match";
            } else if (lidMatch) {
                rank = 2;
                matchReason = "LID match";
            } else if (exactNameMatch) {
                rank = 3;
                matchReason = "Exact name";
            } else if (looseNameMatch) {
                rank = 4;
                matchReason = "Name suggestion";
            } else {
                rank = 5;
            }

            return {
                ...contact,
                matchReason,
                rank,
            };
        })
        .sort((left, right) => left.rank - right.rank || String(left.name || "").localeCompare(String(right.name || "")))
        .filter((contact) => {
            if (seen.has(contact.id)) return false;
            seen.add(contact.id);
            return contact.rank <= 4;
        });

    return ranked;
}

async function linkConversationParticipantToContact(
    participantId: string,
    contactId: string
) {
    return db.conversationParticipant.update({
        where: { id: participantId },
        data: { contactId },
    });
}

async function ensureRealContactForGroupParticipant(params: {
    locationId: string;
    participant: Awaited<ReturnType<typeof getScopedConversationParticipant>>;
    contactId?: string | null;
    name?: string | null;
    phone?: string | null;
}) {
    const participant = params.participant;
    if (!participant) throw new Error("Participant not found");

    const requestedContactId = String(params.contactId || "").trim() || null;
    const draftName = normalizeParticipantDisplayName(params.name) || buildGroupParticipantDraftName(participant);
    const trustedPhone = canOpenDirectChatForParticipant(participant)
        ? normalizeContactPhoneForStorage(params.phone || participant.phoneDigits)
        : normalizeContactPhoneForStorage(params.phone);
    const participantLidRaw = String(participant.lidJid || "").replace("@lid", "").trim();

    if (requestedContactId) {
        const existing = await db.contact.findFirst({
            where: { id: requestedContactId, locationId: params.locationId },
            select: { id: true, phone: true, lid: true, name: true },
        });
        if (!existing) {
            throw new Error("Selected contact not found");
        }

        await db.contact.update({
            where: { id: existing.id },
            data: {
                ...(participant.lidJid && !existing.lid ? { lid: participant.lidJid } : {}),
                ...(trustedPhone && !existing.phone ? { phone: trustedPhone } : {}),
            },
        });

        await linkConversationParticipantToContact(participant.id, existing.id);
        return existing.id;
    }

    if (participant.contactId) {
        const existing = await db.contact.findFirst({
            where: { id: participant.contactId, locationId: params.locationId },
            select: { id: true, phone: true, lid: true, name: true },
        });
        if (existing) {
            await db.contact.update({
                where: { id: existing.id },
                data: {
                    ...(participant.lidJid && !existing.lid ? { lid: participant.lidJid } : {}),
                    ...(trustedPhone && !existing.phone ? { phone: trustedPhone } : {}),
                    ...(!existing.name && draftName ? { name: draftName } : {}),
                },
            });
            return existing.id;
        }
    }

    if (trustedPhone || participantLidRaw) {
        const existingExact = await db.contact.findFirst({
            where: {
                locationId: params.locationId,
                OR: [
                    ...(trustedPhone ? [{ phone: trustedPhone }] : []),
                    ...(participantLidRaw ? [{ lid: { contains: participantLidRaw } }] : []),
                ],
            },
            select: { id: true, phone: true, lid: true, name: true },
        });
        if (existingExact) {
            await db.contact.update({
                where: { id: existingExact.id },
                data: {
                    ...(participant.lidJid && !existingExact.lid ? { lid: participant.lidJid } : {}),
                    ...(trustedPhone && !existingExact.phone ? { phone: trustedPhone } : {}),
                    ...(!existingExact.name && draftName ? { name: draftName } : {}),
                },
            });
            await linkConversationParticipantToContact(participant.id, existingExact.id);
            return existingExact.id;
        }
    }

    const created = await db.contact.create({
        data: {
            locationId: params.locationId,
            name: draftName,
            phone: trustedPhone,
            lid: participant.lidJid || undefined,
            status: "New",
            contactType: "Lead",
        },
        select: { id: true },
    });

    await linkConversationParticipantToContact(participant.id, created.id);
    return created.id;
}

function replaceContactIdentityMentionsWithFirstName(
    summary: string,
    contact: {
        firstName?: string | null;
        name?: string | null;
        email?: string | null;
        phone?: string | null;
    } | null | undefined
): string {
    const firstName = deriveOptionalFirstName(
        contact?.firstName,
        contact?.name,
        contact?.email
    ) || "Contact";

    const contactDigits = normalizePhoneDigits(contact?.phone);
    const contactEmail = String(contact?.email || "").trim();
    const contactName = String(contact?.name || "").trim();

    let rewritten = String(summary || "");

    if (contactDigits) {
        rewritten = rewritten.replace(/\+?\d[\d\s().-]{5,}\d/g, (token) => {
            const tokenDigits = normalizePhoneDigits(token);
            if (!tokenDigits) return token;
            return phoneDigitsLikelyMatch(tokenDigits, contactDigits) ? firstName : token;
        });
    }

    if (contactEmail) {
        const contactEmailPattern = new RegExp(escapeRegExp(contactEmail), "gi");
        rewritten = rewritten.replace(contactEmailPattern, firstName);
    }

    if (contactName && contactName.toLowerCase() !== firstName.toLowerCase()) {
        const contactNamePattern = new RegExp(`\\b${escapeRegExp(contactName)}\\b`, "gi");
        rewritten = rewritten.replace(contactNamePattern, firstName);
    }

    const roleBeforeName = new RegExp(`\\b(?:lead|contact|client)\\s+${escapeRegExp(firstName)}\\b`, "gi");
    rewritten = rewritten.replace(roleBeforeName, firstName);

    const roleBeforeEmailOrPhone = /\b(?:lead|contact|client)\s+(?:named\s+)?(?:[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\+?\d[\d\s().-]{5,}\d)\b/gi;
    rewritten = rewritten.replace(roleBeforeEmailOrPhone, firstName);

    return rewritten;
}

function normalizeImprovedNoteOutput(rawOutput: string, originalText: string): string {
    return normalizeSingleLine(
        rawOutput,
        normalizeSingleLine(originalText, "Captured lead update and next step.")
    ).replace(/\s*\|\s*/g, " | ");
}

function buildImproveNotePrompt(args: {
    noteType: z.infer<typeof ImproveNoteTypeSchema>;
    text: string;
    contactFirstName?: string;
    context?: {
        propertyReference?: string;
        scheduledAtIso?: string;
        scheduledLocal?: string;
    };
}) {
    const contextHints = [
        args.context?.propertyReference ? `Property reference: ${args.context.propertyReference}` : null,
        args.context?.scheduledLocal ? `Scheduled local datetime: ${args.context.scheduledLocal}` : null,
        args.context?.scheduledAtIso ? `Scheduled UTC datetime: ${args.context.scheduledAtIso}` : null,
    ].filter(Boolean);

    if (args.noteType === "viewing") {
        return [
            "You improve internal real-estate viewing notes for fast owner and agent handoff.",
            "Return exactly one plain-text line using this exact format:",
            "Prospect: <short phrase> | Fit: <short phrase> | Concerns: <short phrase> | Next step: <short phrase>",
            "Rules:",
            "- Keep each segment 3-8 words and factual.",
            "- Preserve only facts present in the source note.",
            "- Use the optional context to resolve likely transcription mistakes in names, place names, property references, dates, or similar proper nouns when the context clearly supports the correction.",
            "- Do not invent details, promises, numbers, dates, or outcomes.",
            "- Fix grammar and structure, remove fluff, keep concise.",
            "- Keep the full line compact and easy to scan quickly.",
            "- Use n/a for missing segments.",
            "- Do not include markdown, bullets, emojis, quotes, or extra labels.",
            args.contactFirstName
                ? `- If the prospect is named, prefer first name only (${args.contactFirstName}).`
                : "- If a prospect name appears, use first name only.",
            "",
            contextHints.length > 0 ? "Optional context:" : null,
            ...contextHints,
            contextHints.length > 0 ? "" : null,
            "Source note:",
            '"""',
            args.text,
            '"""',
        ].filter(Boolean).join("\n");
    }

    return [
        "You improve internal CRM timeline notes for real-estate teams.",
        "Return exactly one plain-text line that reads like a polished internal note.",
        "Rules:",
        "- Keep it factual, readable, and useful for future agent handoff, search, and follow-up.",
        "- Fix grammar and clarity while preserving original meaning.",
        "- Preserve only facts from the source; do not invent details.",
        "- Use the optional context to resolve likely transcription mistakes in names, area names, property references, dates, and similar proper nouns when the context clearly supports the correction.",
        "- Preserve essential specifics when present: property type and size, preferred and excluded areas, must-have and must-avoid features, legal or price conditions, household details, pets, mobility or travel constraints, and next steps.",
        "- Keep important negatives and conditions such as exclusions, refusals, preferences, compromises, and 'would consider if...' details.",
        "- If a detail could affect search, qualification, property matching, follow-up, negotiation, or future contact context, keep it.",
        "- Compress wording, not substance.",
        "- Remove fluff and repetition, but do not collapse multiple concrete requirements into a vague summary.",
        "- Prefer grouping related details in a natural order: search criteria, exclusions, conditions, then personal/context notes.",
        "- You may use commas, semicolons, or short clauses to keep multiple requirements clear in one line.",
        "- Include next step only if present in source.",
        "- No markdown, bullets, emojis, quotes, date prefixes, or agent signature.",
        args.contactFirstName
            ? `- If mentioning the contact, use first name only (${args.contactFirstName}).`
            : "- If a name appears, use first name only.",
        "- Never include phone or email.",
        "- Prefer a skimmable note, but keep enough detail to be operationally useful later.",
        "- Do not shorten aggressively just to sound neat.",
        "",
        contextHints.length > 0 ? "Optional context:" : null,
        ...contextHints,
        contextHints.length > 0 ? "" : null,
        "Source note:",
        '"""',
        args.text,
        '"""',
    ].filter(Boolean).join("\n");
}

function formatCrmLogEntry(actorFirstName: string, body: string, date: Date = new Date()): string {
    const normalizedBody = normalizeSingleLine(body, "Updated conversation notes.");
    return `${formatLogDate(date)} ${actorFirstName}: ${normalizedBody}`;
}

function stripCrmLogPrefix(entry: string): string {
    const raw = String(entry || "").trim();
    if (!raw) return "";
    return raw.replace(/^\d{2}\.\d{2}\.\d{2}\s+[^:]{1,64}:\s*/, "").trim();
}

function normalizeForLogDedupe(text: string): string {
    return String(text || "")
        .toLowerCase()
        .replace(/[\r\n]+/g, " ")
        .replace(/[^a-z0-9\s€$£%.,:/-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function tokenizeForLogDedupe(text: string): string[] {
    return normalizeForLogDedupe(text)
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 3);
}

function computeTokenOverlapScore(a: string, b: string): number {
    const left = new Set(tokenizeForLogDedupe(a));
    const right = new Set(tokenizeForLogDedupe(b));
    if (!left.size || !right.size) return 0;

    let common = 0;
    for (const token of left) {
        if (right.has(token)) common += 1;
    }
    return common / Math.min(left.size, right.size);
}

function extractManualEntryTextFromChanges(changes: any): string {
    if (!changes) return "";
    if (typeof changes === "string") {
        try {
            return extractManualEntryTextFromChanges(JSON.parse(changes));
        } catch {
            return "";
        }
    }
    if (Array.isArray(changes)) {
        const entryItem = changes.find((item: any) => item?.field === "entry");
        if (entryItem && typeof entryItem.new === "string") return entryItem.new;
        return "";
    }
    if (typeof changes === "object") {
        if (typeof changes.entry === "string") return changes.entry;
        if (changes.entry && typeof changes.entry.new === "string") return changes.entry.new;
    }
    return "";
}

function isLikelyDuplicateManualEntry(candidateBody: string, existingEntry: string): boolean {
    const candidate = normalizeForLogDedupe(stripCrmLogPrefix(candidateBody));
    const existing = normalizeForLogDedupe(stripCrmLogPrefix(existingEntry));
    if (!candidate || !existing) return false;

    if (candidate === existing) return true;
    if (candidate.length >= 28 && existing.includes(candidate)) return true;
    if (existing.length >= 28 && candidate.includes(existing)) return true;

    const overlap = computeTokenOverlapScore(candidate, existing);
    return overlap >= 0.9;
}

async function findRecentDuplicateManualEntry(contactId: string, candidateBody: string) {
    const recent = await db.contactHistory.findMany({
        where: {
            contactId,
            action: "MANUAL_ENTRY",
        },
        orderBy: { createdAt: "desc" },
        take: CRM_LOG_DEDUPE_RECENT_LIMIT,
        select: {
            id: true,
            createdAt: true,
            changes: true,
        },
    });

    for (const item of recent) {
        const existingEntry = extractManualEntryTextFromChanges(item.changes);
        if (!existingEntry) continue;
        if (isLikelyDuplicateManualEntry(candidateBody, existingEntry)) {
            return {
                id: item.id,
                entry: existingEntry,
                createdAt: item.createdAt,
            };
        }
    }

    return null;
}

async function resolveConversationForCrmLog(locationId: string, conversationId: string) {
    return db.conversation.findFirst({
        where: {
            locationId,
            OR: [
                { id: conversationId },
                { ghlConversationId: conversationId },
            ]
        },
        select: {
            id: true,
            ghlConversationId: true,
            contactId: true,
            contact: {
                select: {
                    firstName: true,
                    name: true,
                    email: true,
                    phone: true,
                }
            }
        }
    });
}

async function persistSelectionLogEntry(args: {
    conversationId: string;
    entryBody: string;
}) {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
        return { success: false, error: "Unauthorized" as const };
    }

    const location = await getAuthenticatedLocation();
    const user = await db.user.findUnique({
        where: { clerkId: clerkUserId },
        select: { id: true, firstName: true, name: true, email: true },
    });

    if (!user) {
        return { success: false, error: "User not found" as const };
    }

    const conversation = await resolveConversationForCrmLog(location.id, String(args.conversationId || "").trim());
    if (!conversation) {
        return { success: false, error: "Conversation not found" as const };
    }

    const normalizedEntryBody = normalizeSingleLine(args.entryBody, "");
    if (!normalizedEntryBody) {
        return { success: false, error: "Entry is empty" as const };
    }

    const duplicate = await findRecentDuplicateManualEntry(conversation.contactId, normalizedEntryBody);
    if (duplicate) {
        return {
            success: true as const,
            skipped: true as const,
            duplicateHistoryId: duplicate.id,
            entry: duplicate.entry,
            conversation: {
                id: conversation.id,
                ghlConversationId: conversation.ghlConversationId,
                contactId: conversation.contactId,
            },
        };
    }

    const now = new Date();
    const actorFirstName = deriveFirstName(user.firstName, user.name, user.email);
    const entry = formatCrmLogEntry(actorFirstName, normalizedEntryBody, now);

    await db.contactHistory.create({
        data: {
            contactId: conversation.contactId,
            userId: user.id,
            action: "MANUAL_ENTRY",
            changes: {
                date: now.toISOString(),
                entry,
            },
        },
    });

    revalidatePath(`/admin/contacts/${conversation.contactId}/view`);
    revalidatePath(`/admin/conversations?id=${encodeURIComponent(conversation.ghlConversationId)}`);
    invalidateConversationReadCaches(conversation.ghlConversationId);

    return {
        success: true as const,
        skipped: false as const,
        entry,
        conversation: {
            id: conversation.id,
            ghlConversationId: conversation.ghlConversationId,
            contactId: conversation.contactId,
        },
    };
}

type SelectionUsage = {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    thoughtsTokens?: number;
    toolUsePromptTokens?: number;
};

async function persistSelectionAiExecution(args: {
    conversationInternalId: string;
    taskTitle: string;
    intent: string;
    modelId: string;
    promptText: string;
    rawOutput: string;
    normalizedOutput: string;
    usage: SelectionUsage;
    latencyMs?: number | null;
}) {
    const location = await getAuthenticatedLocationReadOnly();
    
    const estimatedCost = calculateRunCostFromUsage(args.modelId, {
        promptTokens: args.usage.promptTokens || 0,
        completionTokens: args.usage.completionTokens || 0,
        totalTokens: args.usage.totalTokens || 0,
        thoughtsTokens: args.usage.thoughtsTokens || 0,
        toolUsePromptTokens: args.usage.toolUsePromptTokens || 0,
    });

    const normalizedLatency = typeof args.latencyMs === "number" && Number.isFinite(args.latencyMs)
        ? Math.max(1, Math.round(args.latencyMs))
        : undefined;

    await db.agentExecution.create({
        data: {
            conversationId: args.conversationInternalId,
            locationId: location.id,
            taskTitle: args.taskTitle,
            taskStatus: "done",
            status: "success",
            skillName: "selection_toolbar",
            intent: args.intent,
            model: args.modelId,
            thoughtSummary: `Selection action "${args.taskTitle}" completed and usage recorded.`,
            thoughtSteps: [
                {
                    step: 1,
                    description: "LLM request payload",
                    conclusion: "Captured full request prompt",
                    data: { model: args.modelId, prompt: args.promptText },
                },
                {
                    step: 2,
                    description: "LLM response payload",
                    conclusion: "Captured normalized output and usage metadata",
                    data: {
                        rawOutput: args.rawOutput,
                        normalizedOutput: args.normalizedOutput,
                        usage: args.usage,
                    },
                },
                {
                    step: 3,
                    description: "Usage & cost estimate",
                    conclusion: `Estimated run cost (${estimatedCost.confidence} confidence)`,
                    data: {
                        usd: estimatedCost.amount,
                        method: estimatedCost.method,
                        confidence: estimatedCost.confidence,
                        breakdown: estimatedCost.breakdown,
                    },
                },
            ],
            toolCalls: [
                {
                    tool: "gemini.generateContent",
                    arguments: {
                        model: args.modelId,
                        prompt: args.promptText,
                    },
                    result: {
                        rawOutput: args.rawOutput,
                        normalizedOutput: args.normalizedOutput,
                        usage: args.usage,
                    },
                    error: null,
                },
            ],
            promptTokens: args.usage.promptTokens || 0,
            completionTokens: args.usage.completionTokens || 0,
            totalTokens: args.usage.totalTokens || 0,
            cost: estimatedCost.amount,
            latencyMs: normalizedLatency,
        },
    });

    await db.conversation.update({
        where: { id: args.conversationInternalId },
        data: {
            promptTokens: { increment: args.usage.promptTokens || 0 },
            completionTokens: { increment: args.usage.completionTokens || 0 },
            totalTokens: { increment: args.usage.totalTokens || 0 },
            totalCost: { increment: estimatedCost.amount },
        },
    });

    await securelyRecordAiUsage({
        locationId: location.id,
        resourceType: "conversation",
        resourceId: args.conversationInternalId,
        featureArea: "conversational_ai",
        action: args.intent || "selection_tool",
        provider: "google_gemini",
        model: args.modelId,
        inputTokens: args.usage.promptTokens || 0,
        outputTokens: args.usage.completionTokens || 0,
    });

    return estimatedCost.amount;
}

async function persistTaskSuggestionFunnelEvent(args: {
    type: TaskSuggestionFunnelEventType;
    conversationInternalId: string;
    contactId: string;
    payload: Record<string, unknown>;
    status?: "processed" | "error";
    error?: string | null;
}) {
    try {
        await db.agentEvent.create({
            data: {
                type: args.type,
                payload: args.payload as any,
                conversationId: args.conversationInternalId,
                contactId: args.contactId,
                status: args.status || "processed",
                error: args.error || null,
            },
        });
    } catch (eventError) {
        console.warn("[taskSuggestionFunnel] Failed to persist event:", args.type, eventError);
    }
}

function normalizeTranscriptVisibilityPolicy(value: unknown): TranscriptVisibilityPolicy {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized === TRANSCRIPT_VISIBILITY_POLICIES.adminOnly) {
        return TRANSCRIPT_VISIBILITY_POLICIES.adminOnly;
    }
    return TRANSCRIPT_VISIBILITY_POLICIES.team;
}

async function getTranscriptVisibilityPolicyForLocation(locationId: string): Promise<TranscriptVisibilityPolicy> {
    const config = await db.siteConfig.findUnique({
        where: { locationId },
        select: {
            whatsappTranscriptVisibility: true,
        } as any,
    });
    return normalizeTranscriptVisibilityPolicy((config as any)?.whatsappTranscriptVisibility);
}

type LocationActorContext = {
    clerkUserId: string | null;
    userId: string | null;
    isAdmin: boolean;
    hasAccess: boolean;
    roleSource: "location_role" | "legacy_fallback" | "unknown";
};

async function resolveLocationActorContext(locationId: string): Promise<LocationActorContext> {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
        return {
            clerkUserId: null,
            userId: null,
            isAdmin: false,
            hasAccess: false,
            roleSource: "unknown",
        };
    }

    const user = await db.user.findUnique({
        where: { clerkId: clerkUserId },
        select: {
            id: true,
            locations: {
                where: { id: locationId },
                select: { id: true },
            },
        },
    });

    if (!user) {
        return {
            clerkUserId,
            userId: null,
            isAdmin: false,
            hasAccess: false,
            roleSource: "unknown",
        };
    }

    if (!user.locations?.length) {
        return {
            clerkUserId,
            userId: user.id,
            isAdmin: false,
            hasAccess: false,
            roleSource: "unknown",
        };
    }

    try {
        const [membership, locationRoleCount] = await Promise.all([
            db.userLocationRole.findUnique({
                where: {
                    userId_locationId: {
                        userId: user.id,
                        locationId,
                    },
                },
                select: { role: true },
            }),
            db.userLocationRole.count({
                where: { locationId },
            }),
        ]);

        if (membership?.role === "ADMIN") {
            return {
                clerkUserId,
                userId: user.id,
                isAdmin: true,
                hasAccess: true,
                roleSource: "location_role",
            };
        }

        // Legacy fallback for locations that haven't migrated roles yet.
        if (locationRoleCount === 0) {
            return {
                clerkUserId,
                userId: user.id,
                isAdmin: true,
                hasAccess: true,
                roleSource: "legacy_fallback",
            };
        }
    } catch {
        return {
            clerkUserId,
            userId: user.id,
            isAdmin: true,
            hasAccess: true,
            roleSource: "legacy_fallback",
        };
    }

    return {
        clerkUserId,
        userId: user.id,
        isAdmin: false,
        hasAccess: true,
        roleSource: "location_role",
    };
}

async function resolveTranscriptVisibilityAccess(locationId: string): Promise<{
    policy: TranscriptVisibilityPolicy;
    actor: LocationActorContext;
    restrictContent: boolean;
}> {
    const policy = await getTranscriptVisibilityPolicyForLocation(locationId);
    if (policy !== TRANSCRIPT_VISIBILITY_POLICIES.adminOnly) {
        return {
            policy,
            actor: {
                clerkUserId: null,
                userId: null,
                isAdmin: true,
                hasAccess: true,
                roleSource: "unknown",
            },
            restrictContent: false,
        };
    }

    const actor = await resolveLocationActorContext(locationId);
    return {
        policy,
        actor,
        restrictContent: !actor.isAdmin,
    };
}

function getTranscriptVisibilityRestrictionMessage(): string {
    return "Transcript content is restricted to admins for this location.";
}

function getTranscriptManualActionRestrictionMessage(): string {
    return "Transcript actions are restricted to admins for this location.";
}

async function resolveTranscriptManualActionAccess(locationId: string): Promise<{
    policy: TranscriptVisibilityPolicy;
    actor: LocationActorContext;
    blocked: boolean;
}> {
    const [policy, actor] = await Promise.all([
        getTranscriptVisibilityPolicyForLocation(locationId),
        resolveLocationActorContext(locationId),
    ]);

    return {
        policy,
        actor,
        blocked: policy === TRANSCRIPT_VISIBILITY_POLICIES.adminOnly && !actor.isAdmin,
    };
}

async function persistTranscriptManualAuditEvent(args: {
    type: TranscriptManualAuditEventType;
    locationId: string;
    conversationId?: string | null;
    contactId?: string | null;
    payload: Record<string, unknown>;
    actor?: LocationActorContext | null;
    status?: "processed" | "error";
    error?: string | null;
}) {
    try {
        const actor = args.actor || await resolveLocationActorContext(args.locationId);
        await db.agentEvent.create({
            data: {
                type: args.type,
                conversationId: args.conversationId || null,
                contactId: args.contactId || null,
                status: args.status || "processed",
                error: args.error || null,
                payload: {
                    ...args.payload,
                    locationId: args.locationId,
                    actor: {
                        clerkUserId: actor.clerkUserId,
                        userId: actor.userId,
                        isAdmin: actor.isAdmin,
                        hasAccess: actor.hasAccess,
                        roleSource: actor.roleSource,
                    },
                } as any,
            },
        });
    } catch (eventError) {
        console.warn("[audioTranscriptManualAudit] Failed to persist event:", args.type, eventError);
    }
}

async function getAuthenticatedLocationReadOnly(options?: { requireGhlToken?: boolean }) {
    const requireGhlToken = options?.requireGhlToken !== false;
    const location = await getLocationContext();
    if (!location) {
        throw new Error("Unauthorized");
    }
    if (requireGhlToken && !location.ghlAccessToken) {
        throw new Error("Unauthorized or GHL not connected");
    }
    return location;
}

async function getAuthenticatedLocationExternal() {
    const location = await getAuthenticatedLocationReadOnly({ requireGhlToken: true });
    try {
        return await refreshGhlAccessToken(location);
    } catch (e) {
        console.error("Failed to refresh token:", e);
        return location;
    }
}

// Backward compatibility for existing action implementations.
async function getAuthenticatedLocation() {
    return getAuthenticatedLocationExternal();
}

function mapConversationRowToUi(
    c: any,
    location: { ghlLocationId?: string | null },
    dealMap?: Map<string, { id: string; title: string }>,
    locationDefaultReplyLanguage?: string | null,
) {
    return {
        id: c.ghlConversationId,
        contactId: c.contact?.ghlContactId || c.contactId,
        contactName: c.contact?.name || "Unknown",
        contactPhone: c.contact?.phone || undefined,
        contactEmail: c.contact?.email || undefined,
        contactPreferredLanguage: c.contact?.preferredLang || null,
        replyLanguageOverride: c.replyLanguageOverride || null,
        locationDefaultReplyLanguage: locationDefaultReplyLanguage || DEFAULT_REPLY_LANGUAGE,
        detectedThreadLanguage: c.detectedThreadLanguage || null,
        detectedThreadLanguageConfidence: Number.isFinite(Number(c.detectedThreadLanguageConfidence))
            ? Number(c.detectedThreadLanguageConfidence)
            : null,
        lastMessageBody: c.lastMessageBody || "",
        lastMessageDate: Math.floor(new Date(c.lastMessageAt).getTime() / 1000),
        unreadCount: c.unreadCount,
        status: c.status as any,
        type: c.lastMessageType || 'TYPE_SMS',
        lastMessageType: c.lastMessageType || undefined,
        locationId: location.ghlLocationId || "",
        activeDealId: dealMap?.get(c.ghlConversationId)?.id,
        activeDealTitle: dealMap?.get(c.ghlConversationId)?.title,
        suggestedActions: c.suggestedActions || [],
    } satisfies Conversation;
}

function buildConversationStatusWhere(status: 'active' | 'archived' | 'trash' | 'tasks' | 'all', locationId: string) {
    const where: any = { locationId };
    if (status === 'active') {
        where.deletedAt = null;
        where.archivedAt = null;
    } else if (status === 'archived') {
        where.deletedAt = null;
        where.archivedAt = { not: null };
    } else if (status === 'trash') {
        where.deletedAt = { not: null };
    }
    return where;
}

function doesConversationMatchStatus(
    status: 'active' | 'archived' | 'trash' | 'tasks' | 'all',
    row: { deletedAt: Date | null; archivedAt: Date | null }
) {
    if (status === "active") return !row.deletedAt && !row.archivedAt;
    if (status === "archived") return !row.deletedAt && !!row.archivedAt;
    if (status === "trash") return !!row.deletedAt;
    return true;
}

type ConversationCursor = { id: string; lastMessageAtMs: number };
type ConversationDeltaCursor = { id: string; updatedAtMs: number };

function encodeConversationDeltaCursor(input: ConversationDeltaCursor) {
    return Buffer.from(JSON.stringify({
        id: input.id,
        updatedAtMs: input.updatedAtMs,
    }), "utf8").toString("base64");
}

function decodeConversationDeltaCursor(raw?: string | null): ConversationDeltaCursor | null {
    if (!raw) return null;
    try {
        const parsed = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
        const id = String(parsed?.id || "");
        const updatedAtMs = Number(parsed?.updatedAtMs);
        if (!Number.isFinite(updatedAtMs)) return null;
        return { id, updatedAtMs };
    } catch {
        return null;
    }
}

function decodeConversationCursor(raw?: string | null): ConversationCursor | null {
    if (!raw) return null;
    try {
        const parsed = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
        const id = String(parsed?.id || "");
        const lastMessageAtMs = Number(parsed?.lastMessageAtMs);
        if (!id || !Number.isFinite(lastMessageAtMs)) return null;
        return { id, lastMessageAtMs };
    } catch {
        return null;
    }
}

function encodeConversationCursor(input: { id: string; lastMessageAt: Date }) {
    return Buffer.from(JSON.stringify({
        id: input.id,
        lastMessageAtMs: input.lastMessageAt.getTime(),
    }), "utf8").toString("base64");
}

function buildConversationDeltaCursorFromRows(rows: Array<{ id: string; updatedAt: Date }>): string {
    if (rows.length === 0) {
        return encodeConversationDeltaCursor({
            id: "",
            updatedAtMs: Date.now(),
        });
    }

    let latest: ConversationDeltaCursor = {
        id: "",
        updatedAtMs: Number.NEGATIVE_INFINITY,
    };

    for (const row of rows) {
        const updatedAtMs = new Date(row.updatedAt).getTime();
        if (
            updatedAtMs > latest.updatedAtMs
            || (updatedAtMs === latest.updatedAtMs && String(row.id) > String(latest.id || ""))
        ) {
            latest = { id: String(row.id), updatedAtMs };
        }
    }

    return encodeConversationDeltaCursor(latest);
}

function invalidateConversationReadCaches(conversationGhlId?: string | null) {
    revalidateTag("conversations:list");
    revalidateTag("conversations:workspace");
    revalidateTag("conversations:workspace:core");
    revalidateTag("conversations:workspace:sidebar");
    revalidateTag("conversations:transcript-eligibility");
    if (conversationGhlId) {
        revalidatePath(`/admin/conversations?id=${encodeURIComponent(conversationGhlId)}`);
    }
}

function emitConversationRealtimeEvent(args: {
    locationId: string;
    conversationId?: string | null;
    type: string;
    payload?: Record<string, unknown>;
}) {
    void publishConversationRealtimeEvent({
        locationId: args.locationId,
        conversationId: args.conversationId || null,
        type: args.type,
        payload: args.payload || {},
    });
}

async function queryConversationListSnapshot(args: {
    locationId: string;
    status: "active" | "archived" | "trash" | "tasks" | "all";
    cursor: ConversationCursor | null;
    pageSize: number;
    selectedConversationId?: string | null;
}) {
    const where = buildConversationStatusWhere(args.status, args.locationId);
    const paginatedWhere: any = args.cursor
        ? {
            ...where,
            OR: [
                { lastMessageAt: { lt: new Date(args.cursor.lastMessageAtMs) } },
                {
                    AND: [
                        { lastMessageAt: { equals: new Date(args.cursor.lastMessageAtMs) } },
                        { id: { lt: args.cursor.id } },
                    ],
                },
            ],
        }
        : where;

    const fetchedRows = await db.conversation.findMany({
        where: paginatedWhere,
        orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
        take: args.pageSize + 1,
        include: { contact: { select: { name: true, email: true, phone: true, ghlContactId: true, preferredLang: true } } },
    });

    const hasMore = fetchedRows.length > args.pageSize;
    const pageRows = hasMore ? fetchedRows.slice(0, args.pageSize) : fetchedRows;
    const lastRowForCursor = pageRows.length > 0 ? pageRows[pageRows.length - 1] : null;
    const nextCursor = hasMore && lastRowForCursor
        ? encodeConversationCursor({ id: lastRowForCursor.id, lastMessageAt: lastRowForCursor.lastMessageAt })
        : null;

    let rows = pageRows;
    if (
        !args.cursor &&
        args.selectedConversationId &&
        !rows.some((item: any) => item.ghlConversationId === args.selectedConversationId)
    ) {
        const selectedConversation = await db.conversation.findFirst({
            where: {
                locationId: args.locationId,
                ghlConversationId: args.selectedConversationId,
            },
            include: { contact: { select: { name: true, email: true, phone: true, ghlContactId: true, preferredLang: true } } },
        });
        if (selectedConversation) {
            rows = [selectedConversation, ...rows];
        }
    }

    const activeDeals = await db.dealContext.findMany({
        where: {
            locationId: args.locationId,
            stage: "ACTIVE",
            conversationIds: { hasSome: rows.map((item: any) => item.ghlConversationId) },
        },
        select: { id: true, title: true, conversationIds: true },
    });

    const dealMap = new Map<string, { id: string; title: string }>();
    for (const deal of activeDeals) {
        for (const conversationId of deal.conversationIds) {
            dealMap.set(conversationId, { id: deal.id, title: deal.title });
        }
    }

    return {
        rows,
        hasMore,
        nextCursor,
        dealMapEntries: Array.from(dealMap.entries()),
    };
}

const getCachedConversationListSnapshot = unstable_cache(
    async (
        locationId: string,
        status: "active" | "archived" | "trash" | "tasks" | "all",
        cursor: ConversationCursor | null,
        pageSize: number,
        selectedConversationId?: string | null
    ) => queryConversationListSnapshot({ locationId, status, cursor, pageSize, selectedConversationId }),
    ["conversations:list:snapshot:v2"],
    {
        revalidate: 8,
        tags: ["conversations:list"],
    }
);

export async function fetchConversations(
    status: 'active' | 'archived' | 'trash' | 'tasks' | 'all' = 'active',
    selectedConversationId?: string | null,
    options?: { cursor?: string | null; limit?: number | null }
) {
    const traceId = createTraceId();
    try {
        const DEFAULT_PAGE_SIZE = 50;
        const MAX_PAGE_SIZE = 200;
        const pageSize = Math.min(
            Math.max(Number(options?.limit || DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE, 1),
            MAX_PAGE_SIZE
        );
        const cursor = decodeConversationCursor(options?.cursor);
        const location = await getAuthenticatedLocationReadOnly();
        const flags = getConversationFeatureFlags(location.id);

        return await withServerTiming("conversations.fetch_list", {
            traceId,
            locationId: location.id,
            status,
            pageSize,
            hasCursor: !!cursor,
            selectedConversationId: selectedConversationId || null,
            cached: flags.workspaceV2,
        }, async () => {
            const snapshot = flags.workspaceV2
                ? await getCachedConversationListSnapshot(location.id, status, cursor, pageSize, selectedConversationId || null)
                : await queryConversationListSnapshot({
                    locationId: location.id,
                    status,
                    cursor,
                    pageSize,
                    selectedConversationId,
                });

            const dealMap = new Map<string, { id: string; title: string }>(snapshot.dealMapEntries);
            const locationDefaultReplyLanguage = await getLocationDefaultReplyLanguage(location.id);
            const conversations = snapshot.rows.map((row: any) => mapConversationRowToUi(row, location, dealMap, locationDefaultReplyLanguage));
            return {
                traceId,
                conversations,
                total: conversations.length,
                hasMore: snapshot.hasMore,
                nextCursor: snapshot.nextCursor,
                pageSize,
                deltaCursor: buildConversationDeltaCursorFromRows(snapshot.rows),
            };
        });
    } catch (error: any) {
        console.error("fetchConversations error:", error);
        return { traceId, conversations: [], total: 0, hasMore: false, nextCursor: null, pageSize: 0, deltaCursor: null };
    }
}

type MessagePaginationCursor = {
    createdAtMs: number;
    id: string;
};

function decodeMessagePaginationCursor(cursor?: string | null): MessagePaginationCursor | null {
    const value = String(cursor || "").trim();
    if (!value) return null;
    const [createdAtPart, idPart] = value.split("::");
    const createdAtMs = Number(createdAtPart);
    if (!Number.isFinite(createdAtMs) || createdAtMs <= 0 || !idPart) return null;
    return {
        createdAtMs,
        id: idPart,
    };
}

function resolveWhatsAppSendState(status: string | null | undefined, outboxStatus: string | null | undefined): string | undefined {
    const normalizedStatus = String(status || "").toLowerCase();
    const normalizedOutbox = String(outboxStatus || "").toLowerCase();

    if (normalizedOutbox === "pending") return "queued";
    if (normalizedOutbox === "processing") return "sending";
    if (normalizedOutbox === "failed") return "retrying";
    if (normalizedOutbox === "dead") return "failed";
    if (normalizedOutbox === "completed") return "sent";

    if (normalizedStatus === "sending") return "sending";
    if (normalizedStatus === "failed") return "failed";
    if (["sent", "delivered", "read", "played"].includes(normalizedStatus)) return "sent";
    return undefined;
}

export async function fetchMessages(
    conversationId: string,
    options?: {
        ensureHistory?: boolean;
        take?: number | null;
        beforeCursor?: string | null;
        includeLegacyEmailMeta?: boolean;
    }
) {
    const ensureHistory = !!options?.ensureHistory;
    const requestedTake = Number(options?.take);
    const boundedTake = Number.isFinite(requestedTake) && requestedTake > 0
        ? Math.min(Math.max(Math.floor(requestedTake), 1), 500)
        : null;
    const includeLegacyEmailMeta = options?.includeLegacyEmailMeta !== false;
    const paginationCursor = decodeMessagePaginationCursor(options?.beforeCursor);
    const location = ensureHistory
        ? await getAuthenticatedLocationExternal()
        : await getAuthenticatedLocationReadOnly();

    const conversation = await db.conversation.findFirst({
        where: {
            ghlConversationId: conversationId,
            locationId: location.id,
        },
        include: { contact: true }
    });

    if (!conversation) {
        return [];
    }

    if (ensureHistory && conversation.contactId && location.ghlAccessToken) {
        await ensureConversationHistory(conversation.contactId, location.id, location.ghlAccessToken!);
    }

    const messageWhere: any = { conversationId: conversation.id };
    if (paginationCursor) {
        const cursorDate = new Date(paginationCursor.createdAtMs);
        messageWhere.OR = [
            { createdAt: { lt: cursorDate } },
            {
                AND: [
                    { createdAt: { equals: cursorDate } },
                    { id: { lt: paginationCursor.id } },
                ],
            },
        ];
    }

    const readDescending = !!boundedTake || !!paginationCursor;
    const messageRows = await (db as any).message.findMany({
        where: messageWhere,
        orderBy: readDescending
            ? [{ createdAt: "desc" }, { id: "desc" }]
            : [{ createdAt: "asc" }, { id: "asc" }],
        ...(boundedTake ? { take: boundedTake } : {}),
        include: {
            attachments: {
                include: {
                    transcript: {
                        include: {
                            extractions: {
                                orderBy: { createdAt: "desc" },
                                take: 1,
                            },
                        },
                    },
                },
            },
            outboundWhatsAppOutbox: {
                select: {
                    id: true,
                    status: true,
                    scheduledAt: true,
                    attemptCount: true,
                    lastError: true,
                    processedAt: true,
                    lockedAt: true,
                },
            },
            translationCaches: {
                orderBy: [{ updatedAt: "desc" }],
                take: 12,
                select: {
                    id: true,
                    targetLanguage: true,
                    sourceText: true,
                    translatedText: true,
                    detectedSourceLanguage: true,
                    detectionConfidence: true,
                    status: true,
                    provider: true,
                    model: true,
                    updatedAt: true,
                },
            },
            ...(includeLegacyEmailMeta ? {
                legacyCrmLeadEmailProcessing: {
                    select: {
                        status: true,
                        classification: true,
                        senderEmail: true,
                        legacyLeadUrl: true,
                        legacyLeadId: true,
                        error: true,
                        attempts: true,
                        processedAt: true,
                        processedContactId: true,
                        processedConversationId: true,
                        extracted: true,
                        processResult: true,
                    }
                }
            } : {}),
        }
    });

    const messages = readDescending ? [...messageRows].reverse() : messageRows;
    console.log(`[DB Read] Fetched ${messages.length} messages from local database for conversation ${conversation.ghlConversationId}`);

    const hasEmailMessages = includeLegacyEmailMeta
        ? messages.some((m: any) => String(m.type || '').toUpperCase().includes('EMAIL'))
        : false;
    const legacyCrmSettings = hasEmailMessages
        ? await db.location.findUnique({
            where: { id: location.id },
            select: {
                legacyCrmLeadEmailEnabled: true,
                legacyCrmLeadEmailSenders: true,
                legacyCrmLeadEmailSenderDomains: true,
                legacyCrmLeadEmailSubjectPatterns: true,
            } as any
        })
        : null;

    const legacyCrmDetectionEnabled = !!(legacyCrmSettings as any)?.legacyCrmLeadEmailEnabled;
    const legacyCrmConfiguredSenders = (((legacyCrmSettings as any)?.legacyCrmLeadEmailSenders || []) as string[]);
    const legacyCrmConfiguredDomains = (((legacyCrmSettings as any)?.legacyCrmLeadEmailSenderDomains || []) as string[]);
    const legacyCrmSubjectPatterns = (((legacyCrmSettings as any)?.legacyCrmLeadEmailSubjectPatterns || []) as string[]);
    const transcriptVisibility = await resolveTranscriptVisibilityAccess(location.id);
    const redactTranscriptContent = transcriptVisibility.restrictContent;
    const resolvedTranslationTargetLanguage = getResolvedConversationTranslationLanguage({
        replyLanguageOverride: conversation.replyLanguageOverride || null,
        locationDefaultReplyLanguage: await getLocationDefaultReplyLanguage(location.id, DEFAULT_TRANSLATION_TARGET_LANGUAGE),
    });

    return messages.map((m: any) => {
        const translationEntries = (m.translationCaches || []).map((entry: any) => ({
            id: entry.id,
            targetLanguage: entry.targetLanguage,
            sourceLanguage: entry.detectedSourceLanguage || null,
            sourceText: entry.sourceText || "",
            translatedText: entry.translatedText || "",
            status: String(entry.status || MESSAGE_TRANSLATION_STATUS.completed).toLowerCase() === MESSAGE_TRANSLATION_STATUS.failed
                ? MESSAGE_TRANSLATION_STATUS.failed
                : MESSAGE_TRANSLATION_STATUS.completed,
            provider: entry.provider || null,
            model: entry.model || null,
            updatedAt: entry.updatedAt ? new Date(entry.updatedAt).toISOString() : null,
        }));
        const detectedLanguage = (m.translationCaches?.[0]?.detectedSourceLanguage || null) || null;
        const detectedLanguageConfidence = Number.isFinite(Number(m.translationCaches?.[0]?.detectionConfidence))
            ? Number(m.translationCaches?.[0]?.detectionConfidence)
            : null;

        return {
        ...(() => {
            if (!includeLegacyEmailMeta) return {};
            const isEmail = String(m.type || '').toUpperCase().includes('EMAIL');
            if (!isEmail) return {};

            const processing = m.legacyCrmLeadEmailProcessing;
            const parsed = parseLegacyCrmLeadNotificationEmail({
                subject: m.subject,
                emailFrom: m.emailFrom,
                body: m.body,
                configuredSenders: legacyCrmConfiguredSenders,
                configuredDomains: legacyCrmConfiguredDomains,
                configuredSubjectPatterns: legacyCrmSubjectPatterns,
            });

            const extracted = processing?.extracted && typeof processing.extracted === 'object'
                ? (processing.extracted as any)
                : null;
            const extractedReason = extracted?.reason ? String(extracted.reason) : null;
            const sourceUpper = String(m.source || '').toUpperCase();
            const isOutlookSyncedEmail = sourceUpper.includes('OUTLOOK');
            // Manual processing should be available on Outlook-synced emails even before the parser
            // positively detects a legacy CRM lead format. This lets users trigger processing on
            // truncated/edge-case emails and inspect ignored reasons directly from the UI.
            const showLegacyCrmUi = !!processing || isOutlookSyncedEmail;

            if (!showLegacyCrmUi) return {};

            return {
                legacyCrmLead: {
                    status: processing?.status || undefined,
                    matched: processing ? !!extracted?.matched : parsed.matched,
                    classification: processing?.classification || parsed.classification || null,
                    senderMatchMode: processing
                        ? (extracted?.senderMatchMode ? String(extracted.senderMatchMode) : null)
                        : parsed.senderMatchMode,
                    reason: processing ? extractedReason : (parsed.reason || null),
                    error: processing?.error || null,
                    attempts: processing?.attempts || 0,
                    processedAt: processing?.processedAt ? new Date(processing.processedAt).toISOString() : null,
                    processedContactId: processing?.processedContactId || null,
                    processedConversationId: processing?.processedConversationId || null,
                    legacyLeadUrl: processing?.legacyLeadUrl || parsed.leadUrl || null,
                    canProcess: !processing || ['pending', 'failed', 'ignored'].includes(String(processing.status || '').toLowerCase()),
                    canReprocess: !!processing && ['processed', 'failed', 'ignored'].includes(String(processing.status || '').toLowerCase()),
                    detectionEnabled: legacyCrmDetectionEnabled,
                }
            };
        })(),
        id: m.id, // Use internal CUID
        ghlMessageId: m.ghlMessageId, // Optional
        clientMessageId: (m as any).clientMessageId || undefined,
        wamId: m.wamId || undefined,
        conversationId: m.conversationId,
        contactId: conversation.contact.ghlContactId || '',
        body: m.body || '',
        type: m.type,
        direction: m.direction as 'inbound' | 'outbound',
        status: m.status,
        sendState: resolveWhatsAppSendState(m.status, (m as any).outboundWhatsAppOutbox?.status),
        outboxState: (m as any).outboundWhatsAppOutbox
            ? {
                id: String((m as any).outboundWhatsAppOutbox.id),
                status: String((m as any).outboundWhatsAppOutbox.status || ""),
                scheduledAt: (m as any).outboundWhatsAppOutbox.scheduledAt
                    ? new Date((m as any).outboundWhatsAppOutbox.scheduledAt).toISOString()
                    : null,
                attemptCount: Number((m as any).outboundWhatsAppOutbox.attemptCount || 0),
                lastError: (m as any).outboundWhatsAppOutbox.lastError || null,
                processedAt: (m as any).outboundWhatsAppOutbox.processedAt
                    ? new Date((m as any).outboundWhatsAppOutbox.processedAt).toISOString()
                    : null,
                lockedAt: (m as any).outboundWhatsAppOutbox.lockedAt
                    ? new Date((m as any).outboundWhatsAppOutbox.lockedAt).toISOString()
                    : null,
            }
            : undefined,
        dateAdded: m.createdAt.toISOString(),
        subject: m.subject || undefined,
        emailFrom: m.emailFrom || undefined,
        emailTo: m.emailTo || undefined,
        source: m.source || undefined,
        detectedLanguage,
        detectedLanguageConfidence,
        translation: buildMessageTranslationState({
            direction: m.direction as "inbound" | "outbound",
            detectedLanguage,
            detectedLanguageConfidence,
        }, translationEntries, resolvedTranslationTargetLanguage),
        translations: translationEntries,
        attachments: (m.attachments || []).map((a: any) => ({
            id: a.id,
            url: String(a.url || "").startsWith("r2://")
                ? `/api/media/attachments/${a.id}`
                : a.url,
            mimeType: a.contentType || null,
            fileName: a.fileName || null,
            transcript: a.transcript ? {
                ...(a.transcript.extractions?.[0] ? {
                    extraction: {
                        status: a.transcript.extractions[0].status,
                        payload: redactTranscriptContent ? null : (a.transcript.extractions[0].payload || null),
                        error: redactTranscriptContent ? null : (a.transcript.extractions[0].error || null),
                        model: a.transcript.extractions[0].model || null,
                        provider: a.transcript.extractions[0].provider || null,
                        updatedAt: a.transcript.extractions[0].updatedAt
                            ? new Date(a.transcript.extractions[0].updatedAt).toISOString()
                            : null,
                        restricted: redactTranscriptContent,
                    },
                } : {}),
                status: a.transcript.status,
                text: redactTranscriptContent ? null : (a.transcript.text || null),
                error: redactTranscriptContent ? null : (a.transcript.error || null),
                model: a.transcript.model || null,
                provider: a.transcript.provider || null,
                updatedAt: a.transcript.updatedAt ? new Date(a.transcript.updatedAt).toISOString() : null,
                restricted: redactTranscriptContent,
            } : null,
        })),
        // Hydrated fields for UI
        html: m.body?.includes('<') ? m.body : undefined // Simple check
    };
    });
}

type ConversationWorkspaceTaskSummary = {
    total: number;
    open: number;
    completed: number;
    highPriorityOpen: number;
    nextDueAt: string | null;
    latestUpdatedAt: string | null;
};

type ConversationWorkspaceViewingSummary = {
    total: number;
    upcoming: number;
    completed: number;
    nextViewingAt: string | null;
    latestUpdatedAt: string | null;
};

type ConversationWorkspaceAgentSummary = {
    hasPlan: boolean;
    totalPlanSteps: number;
    completedPlanSteps: number;
    latestExecutionAt: string | null;
    latestExecutionStatus: string | null;
};

type ConversationWorkspaceMetadata = {
    conversationHeader: Conversation;
    contactContext: any;
    taskSummary: ConversationWorkspaceTaskSummary;
    viewingSummary: ConversationWorkspaceViewingSummary;
    agentSummary: ConversationWorkspaceAgentSummary;
    freshness: {
        generatedAt: string;
        conversationUpdatedAt: string | null;
        latestMessageAt: string | null;
        latestMessageUpdatedAt: string | null;
        latestActivityAt: string | null;
        threadStale: boolean;
    };
};

type ConversationWorkspaceCoreMetadata = {
    conversationHeader: Conversation;
    freshness: {
        generatedAt: string;
        conversationUpdatedAt: string | null;
        latestMessageAt: string | null;
        latestMessageUpdatedAt: string | null;
        latestActivityAt: string | null;
        threadStale: boolean;
    };
};

type ConversationWorkspaceMessageWindow = {
    oldestCursor: string | null;
    newestCursor: string | null;
    count: number;
    requestedLimit: number;
};

type ConversationWorkspaceOptions = {
    includeMessages?: boolean;
    includeActivity?: boolean;
    includeContactContext?: boolean;
    includeTaskSummary?: boolean;
    includeViewingSummary?: boolean;
    includeAgentSummary?: boolean;
    messageLimit?: number;
    activityLimit?: number;
};

const DEFAULT_WORKSPACE_MESSAGE_LIMIT = 200;
const MAX_WORKSPACE_MESSAGE_LIMIT = 500;
const DEFAULT_WORKSPACE_ACTIVITY_LIMIT = 120;
const MAX_WORKSPACE_ACTIVITY_LIMIT = 400;
const DEFAULT_LIST_DELTA_LIMIT = 150;
const MAX_LIST_DELTA_LIMIT = 400;

function normalizeContactContextRole(value: unknown): string {
    return String(value || "").trim().toLowerCase();
}

function getContactContextInclude() {
    return {
        propertyRoles: {
            include: {
                property: {
                    select: {
                        id: true,
                        title: true,
                        reference: true,
                        price: true,
                    },
                },
            },
        },
        companyRoles: {
            include: {
                company: {
                    select: {
                        id: true,
                        name: true,
                        type: true,
                    },
                },
            },
        },
        viewings: {
            take: 5,
            orderBy: { date: "desc" as const },
            include: {
                property: {
                    select: {
                        id: true,
                        title: true,
                        reference: true,
                    },
                },
            },
        },
    };
}

async function enrichContactContextContact(contact: any, locationId: string) {
    if (!contact) return null;

    const interestedPropertyIds: string[] = Array.from(new Set<string>(
        (Array.isArray(contact.propertiesInterested) ? contact.propertiesInterested : [])
            .map((id: any) => String(id || "").trim())
            .filter(Boolean)
    ));

    const [interestedPropertiesRaw, inspectedViewingRows] = await Promise.all([
        interestedPropertyIds.length > 0
            ? db.property.findMany({
                where: {
                    id: { in: interestedPropertyIds },
                    locationId,
                },
                select: {
                    id: true,
                    title: true,
                    reference: true,
                    price: true,
                },
            })
            : Promise.resolve([]),
        db.viewing.findMany({
            where: { contactId: contact.id },
            orderBy: [{ date: "desc" }, { updatedAt: "desc" }, { id: "desc" }],
            select: {
                propertyId: true,
                date: true,
                property: {
                    select: {
                        id: true,
                        title: true,
                        reference: true,
                        price: true,
                    },
                },
            },
        }),
    ]);

    const interestedPropertyMap = new Map(
        interestedPropertiesRaw.map((property: any) => [property.id, property])
    );
    const interestedProperties = interestedPropertyIds
        .map((propertyId) => interestedPropertyMap.get(propertyId))
        .filter(Boolean);

    const inspectedByPropertyId = new Map<string, any>();
    for (const viewing of inspectedViewingRows) {
        const propertyId = String(viewing?.propertyId || "");
        if (!propertyId || inspectedByPropertyId.has(propertyId) || !viewing?.property) continue;
        inspectedByPropertyId.set(propertyId, {
            ...viewing.property,
            lastViewedAt: viewing.date ? new Date(viewing.date).toISOString() : null,
        });
    }

    const propertyRoles = (Array.isArray(contact.propertyRoles) ? contact.propertyRoles : []).map((role: any) => ({
        ...role,
        normalizedRole: normalizeContactContextRole(role?.role),
    }));
    const companyRoles = (Array.isArray(contact.companyRoles) ? contact.companyRoles : []).map((role: any) => ({
        ...role,
        normalizedRole: normalizeContactContextRole(role?.role),
    }));

    return {
        ...contact,
        propertyRoles,
        companyRoles,
        interestedProperties,
        inspectedProperties: Array.from(inspectedByPropertyId.values()),
        normalizedContactType: String(contact.contactType || "").trim().toLowerCase(),
        // TODO(whatsapp-groups): add relatedWhatsAppGroups once contact<->group relation support is implemented.
    };
}

async function getConversationContactContextSnapshot(locationId: string, contactId: string) {
    const [contact, leadSources] = await Promise.all([
        db.contact.findFirst({
            where: {
                id: contactId,
                locationId,
            },
            include: getContactContextInclude(),
        }),
        db.leadSource.findMany({
            where: { locationId, isActive: true },
            select: { name: true },
            orderBy: { name: "asc" },
        }),
    ]);

    const hydratedContact = await enrichContactContextContact(contact, locationId);

    return {
        contact: hydratedContact,
        leadSources: leadSources.map((source) => source.name),
    };
}

function parsePlanSteps(plan: unknown) {
    const steps = Array.isArray(plan) ? plan : [];
    let completed = 0;
    for (const step of steps) {
        const status = String((step as any)?.status || "").toLowerCase();
        if (status === "done" || status === "completed" || status === "success") completed += 1;
    }
    return {
        total: steps.length,
        completed,
    };
}

async function queryConversationWorkspaceCoreMetadata(args: {
    locationId: string;
    locationGhlId?: string | null;
    conversationId: string;
}) {
    const conversation = await db.conversation.findFirst({
        where: {
            locationId: args.locationId,
            ghlConversationId: args.conversationId,
        },
        include: {
            contact: {
                select: {
                    id: true,
                    name: true,
                    email: true,
                    phone: true,
                    ghlContactId: true,
                    preferredLang: true,
                },
            },
        },
    });

    if (!conversation) return null;

    const [activeDealRows, latestMessage, latestActivity] = await Promise.all([
        db.dealContext.findMany({
            where: {
                locationId: args.locationId,
                stage: "ACTIVE",
                conversationIds: { has: conversation.ghlConversationId },
            },
            select: { id: true, title: true },
            take: 1,
        }),
        db.message.findFirst({
            where: { conversationId: conversation.id },
            select: { createdAt: true, updatedAt: true },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        }),
        db.contactHistory.findFirst({
            where: { contactId: conversation.contactId },
            select: { createdAt: true },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        }),
    ]);

    const dealMap = new Map<string, { id: string; title: string }>();
    for (const row of activeDealRows) {
        dealMap.set(conversation.ghlConversationId, { id: row.id, title: row.title });
    }
    const locationDefaultReplyLanguage = await getLocationDefaultReplyLanguage(args.locationId);

    const latestMessageAtIso = conversation.lastMessageAt ? new Date(conversation.lastMessageAt).toISOString() : null;
    const nowMs = Date.now();
    const threadStale = isLikelyWhatsAppConversation(conversation.lastMessageType)
        && (!!latestMessageAtIso && (nowMs - new Date(latestMessageAtIso).getTime()) > 5 * 60 * 1000);

    return {
        conversationHeader: mapConversationRowToUi(
            conversation,
            { ghlLocationId: args.locationGhlId || null },
            dealMap,
            locationDefaultReplyLanguage,
        ),
        freshness: {
            generatedAt: new Date().toISOString(),
            conversationUpdatedAt: conversation.updatedAt ? new Date(conversation.updatedAt).toISOString() : null,
            latestMessageAt: latestMessageAtIso,
            latestMessageUpdatedAt: latestMessage?.updatedAt ? new Date(latestMessage.updatedAt).toISOString() : null,
            latestActivityAt: latestActivity?.createdAt ? new Date(latestActivity.createdAt).toISOString() : null,
            threadStale,
        },
    } satisfies ConversationWorkspaceCoreMetadata;
}

async function queryConversationWorkspaceMetadata(args: {
    locationId: string;
    locationGhlId?: string | null;
    conversationId: string;
}) {
    const conversation = await db.conversation.findFirst({
        where: {
            locationId: args.locationId,
            ghlConversationId: args.conversationId,
        },
        include: {
            contact: {
                select: {
                    id: true,
                    name: true,
                    email: true,
                    phone: true,
                    ghlContactId: true,
                    preferredLang: true,
                },
            },
        },
    });

    if (!conversation) return null;

    const [activeDealRows, contactContext, taskMetrics, viewingMetrics, latestExecution, latestMessage, latestActivity] = await Promise.all([
        db.dealContext.findMany({
            where: {
                locationId: args.locationId,
                stage: "ACTIVE",
                conversationIds: { has: conversation.ghlConversationId },
            },
            select: { id: true, title: true },
            take: 1,
        }),
        getConversationContactContextSnapshot(args.locationId, conversation.contactId),
        (async () => {
            const [total, open, completed, highPriorityOpen, nextDueTask, latestTask] = await Promise.all([
                db.contactTask.count({
                    where: {
                        locationId: args.locationId,
                        conversationId: conversation.id,
                        deletedAt: null,
                    },
                }),
                db.contactTask.count({
                    where: {
                        locationId: args.locationId,
                        conversationId: conversation.id,
                        deletedAt: null,
                        status: { in: ["open", "pending", "in_progress"] },
                    },
                }),
                db.contactTask.count({
                    where: {
                        locationId: args.locationId,
                        conversationId: conversation.id,
                        deletedAt: null,
                        status: { in: ["completed", "done"] },
                    },
                }),
                db.contactTask.count({
                    where: {
                        locationId: args.locationId,
                        conversationId: conversation.id,
                        deletedAt: null,
                        status: { in: ["open", "pending", "in_progress"] },
                        priority: "high",
                    },
                }),
                db.contactTask.findFirst({
                    where: {
                        locationId: args.locationId,
                        conversationId: conversation.id,
                        deletedAt: null,
                        status: { in: ["open", "pending", "in_progress"] },
                        dueAt: { not: null },
                    },
                    select: { dueAt: true },
                    orderBy: [{ dueAt: "asc" }],
                }),
                db.contactTask.findFirst({
                    where: {
                        locationId: args.locationId,
                        conversationId: conversation.id,
                        deletedAt: null,
                    },
                    select: { updatedAt: true },
                    orderBy: [{ updatedAt: "desc" }],
                }),
            ]);

            return {
                total,
                open,
                completed,
                highPriorityOpen,
                nextDueAt: nextDueTask?.dueAt ? new Date(nextDueTask.dueAt).toISOString() : null,
                latestUpdatedAt: latestTask?.updatedAt ? new Date(latestTask.updatedAt).toISOString() : null,
            } satisfies ConversationWorkspaceTaskSummary;
        })(),
        (async () => {
            const [total, upcoming, completed, nextViewing, latestViewing] = await Promise.all([
                db.viewing.count({
                    where: { contactId: conversation.contactId },
                }),
                db.viewing.count({
                    where: {
                        contactId: conversation.contactId,
                        date: { gte: new Date() },
                    },
                }),
                db.viewing.count({
                    where: {
                        contactId: conversation.contactId,
                        status: { in: ["completed", "done"] },
                    },
                }),
                db.viewing.findFirst({
                    where: {
                        contactId: conversation.contactId,
                        date: { gte: new Date() },
                    },
                    select: { date: true },
                    orderBy: [{ date: "asc" }],
                }),
                db.viewing.findFirst({
                    where: {
                        contactId: conversation.contactId,
                    },
                    select: { updatedAt: true },
                    orderBy: [{ updatedAt: "desc" }],
                }),
            ]);

            return {
                total,
                upcoming,
                completed,
                nextViewingAt: nextViewing?.date ? new Date(nextViewing.date).toISOString() : null,
                latestUpdatedAt: latestViewing?.updatedAt ? new Date(latestViewing.updatedAt).toISOString() : null,
            } satisfies ConversationWorkspaceViewingSummary;
        })(),
        db.agentExecution.findFirst({
            where: { conversationId: conversation.id },
            select: {
                createdAt: true,
                status: true,
            },
            orderBy: { createdAt: "desc" },
        }),
        db.message.findFirst({
            where: { conversationId: conversation.id },
            select: { createdAt: true, updatedAt: true },
            orderBy: { createdAt: "desc" },
        }),
        db.contactHistory.findFirst({
            where: { contactId: conversation.contactId },
            select: { createdAt: true },
            orderBy: { createdAt: "desc" },
        }),
    ]);

    const dealMap = new Map<string, { id: string; title: string }>();
    for (const row of activeDealRows) {
        dealMap.set(conversation.ghlConversationId, { id: row.id, title: row.title });
    }
    const locationDefaultReplyLanguage = await getLocationDefaultReplyLanguage(args.locationId);

    const parsedPlan = parsePlanSteps(conversation.agentPlan);
    const latestMessageAtIso = conversation.lastMessageAt ? new Date(conversation.lastMessageAt).toISOString() : null;
    const nowMs = Date.now();
    const threadStale = isLikelyWhatsAppConversation(conversation.lastMessageType)
        && (!!latestMessageAtIso && (nowMs - new Date(latestMessageAtIso).getTime()) > 5 * 60 * 1000);

    return {
        conversationHeader: mapConversationRowToUi(
            conversation,
            { ghlLocationId: args.locationGhlId || null },
            dealMap,
            locationDefaultReplyLanguage,
        ),
        contactContext,
        taskSummary: taskMetrics,
        viewingSummary: viewingMetrics,
        agentSummary: {
            hasPlan: parsedPlan.total > 0,
            totalPlanSteps: parsedPlan.total,
            completedPlanSteps: parsedPlan.completed,
            latestExecutionAt: latestExecution?.createdAt ? new Date(latestExecution.createdAt).toISOString() : null,
            latestExecutionStatus: latestExecution?.status || null,
        },
        freshness: {
            generatedAt: new Date().toISOString(),
            conversationUpdatedAt: conversation.updatedAt ? new Date(conversation.updatedAt).toISOString() : null,
            latestMessageAt: latestMessageAtIso,
            latestMessageUpdatedAt: latestMessage?.updatedAt ? new Date(latestMessage.updatedAt).toISOString() : null,
            latestActivityAt: latestActivity?.createdAt ? new Date(latestActivity.createdAt).toISOString() : null,
            threadStale,
        },
    } satisfies ConversationWorkspaceMetadata;
}

const getCachedConversationWorkspaceCoreMetadata = unstable_cache(
    async (locationId: string, locationGhlId: string | null, conversationId: string) =>
        queryConversationWorkspaceCoreMetadata({ locationId, locationGhlId, conversationId }),
    ["conversations:workspace:core:metadata:v1"],
    {
        revalidate: 8,
        tags: ["conversations:workspace", "conversations:workspace:core"],
    }
);

const getCachedConversationWorkspaceSidebarMetadata = unstable_cache(
    async (locationId: string, locationGhlId: string | null, conversationId: string) =>
        queryConversationWorkspaceMetadata({ locationId, locationGhlId, conversationId }),
    ["conversations:workspace:sidebar:metadata:v1"],
    {
        revalidate: 15,
        tags: ["conversations:workspace", "conversations:workspace:sidebar"],
    }
);

type ConversationWorkspaceCoreOptions = Pick<ConversationWorkspaceOptions, "includeMessages" | "includeActivity" | "messageLimit" | "activityLimit"> & {
    activityBeforeCursor?: string | null;
};

export async function getConversationWorkspaceCore(
    conversationId: string,
    options?: ConversationWorkspaceCoreOptions
) {
    const traceId = createTraceId();
    const trimmedConversationId = String(conversationId || "").trim();

    if (!trimmedConversationId) {
        return {
            success: false as const,
            traceId,
            error: "Missing conversation ID.",
        };
    }

    try {
        const location = await getAuthenticatedLocationReadOnly();
        const flags = getConversationFeatureFlags(location.id);

        const includeMessages = options?.includeMessages !== false;
        const includeActivity = options?.includeActivity !== false;
        const messageLimit = Math.min(
            Math.max(Number(options?.messageLimit || DEFAULT_WORKSPACE_MESSAGE_LIMIT), 1),
            MAX_WORKSPACE_MESSAGE_LIMIT
        );
        const activityLimit = Math.min(
            Math.max(Number(options?.activityLimit || DEFAULT_WORKSPACE_ACTIVITY_LIMIT), 1),
            MAX_WORKSPACE_ACTIVITY_LIMIT
        );

        return await withServerTiming("conversations.workspace_core", {
            traceId,
            locationId: location.id,
            conversationId: trimmedConversationId,
            includeMessages,
            includeActivity,
            messageLimit,
            activityLimit,
            workspaceV2: flags.workspaceV2,
        }, async () => {
            const metadata = flags.workspaceV2
                ? await getCachedConversationWorkspaceCoreMetadata(location.id, location.ghlLocationId || null, trimmedConversationId)
                : await queryConversationWorkspaceCoreMetadata({
                    locationId: location.id,
                    locationGhlId: location.ghlLocationId || null,
                    conversationId: trimmedConversationId,
                });

            if (!metadata) {
                return {
                    success: false as const,
                    traceId,
                    error: "Conversation not found.",
                };
            }

            const [messages, activityTimeline, transcriptEligibility] = await Promise.all([
                includeMessages
                    ? fetchMessages(trimmedConversationId, { take: messageLimit })
                    : Promise.resolve([] as Message[]),
                includeActivity
                    ? assembleTimelineEvents({
                        mode: "chat",
                        locationId: location.id,
                        conversationId: trimmedConversationId,
                        includeMessages: false,
                        includeActivities: true,
                        take: activityLimit,
                        beforeCursor: options?.activityBeforeCursor || null,
                    }).then((timeline) => {
                        const activityEvents = timeline.events.filter((event) => event.kind === "activity");
                        return activityEvents.map((entry) => ({
                            id: entry.id,
                            type: "activity",
                            createdAt: entry.createdAt,
                            action: entry.action,
                            changes: entry.changes,
                            user: entry.user || null,
                        }));
                    })
                    : Promise.resolve([] as any[]),
                getWhatsAppTranscriptOnDemandEligibility(trimmedConversationId)
                    .catch(() => ({
                        success: false as const,
                        enabled: false as const,
                        reason: "Failed to resolve eligibility.",
                    })),
            ]);

            const messageWindow: ConversationWorkspaceMessageWindow = {
                oldestCursor: includeMessages ? (buildMessageCursorFromMessage(messages[0]) || null) : null,
                newestCursor: includeMessages ? (buildMessageCursorFromMessage(messages[messages.length - 1]) || null) : null,
                count: includeMessages ? messages.length : 0,
                requestedLimit: messageLimit,
            };

            console.log("[perf:conversations.workspace_core_window]", JSON.stringify({
                traceId,
                conversationId: trimmedConversationId,
                includeMessages,
                includeActivity,
                messageLimit,
                activityLimit,
                message_count: messageWindow.count,
                activity_count: Array.isArray(activityTimeline) ? activityTimeline.length : 0,
            }));

            return {
                success: true as const,
                traceId,
                conversationHeader: metadata.conversationHeader,
                messages,
                activityTimeline,
                transcriptEligibility,
                freshness: metadata.freshness,
                messageWindow,
            };
        });
    } catch (error: any) {
        console.error("[getConversationWorkspaceCore] Error:", error);
        return {
            success: false as const,
            traceId,
            error: error?.message || "Failed to load workspace core.",
        };
    }
}

export async function getConversationWorkspaceSidebar(conversationId: string) {
    const traceId = createTraceId();
    const trimmedConversationId = String(conversationId || "").trim();

    if (!trimmedConversationId) {
        return {
            success: false as const,
            traceId,
            error: "Missing conversation ID.",
        };
    }

    try {
        const location = await getAuthenticatedLocationReadOnly();
        const flags = getConversationFeatureFlags(location.id);

        return await withServerTiming("conversations.workspace_sidebar", {
            traceId,
            locationId: location.id,
            conversationId: trimmedConversationId,
            workspaceV2: flags.workspaceV2,
        }, async () => {
            const metadata = flags.workspaceV2
                ? await getCachedConversationWorkspaceSidebarMetadata(location.id, location.ghlLocationId || null, trimmedConversationId)
                : await queryConversationWorkspaceMetadata({
                    locationId: location.id,
                    locationGhlId: location.ghlLocationId || null,
                    conversationId: trimmedConversationId,
                });

            if (!metadata) {
                return {
                    success: false as const,
                    traceId,
                    error: "Conversation not found.",
                };
            }

            return {
                success: true as const,
                traceId,
                contactContext: metadata.contactContext,
                taskSummary: metadata.taskSummary,
                viewingSummary: metadata.viewingSummary,
                agentSummary: metadata.agentSummary,
            };
        });
    } catch (error: any) {
        console.error("[getConversationWorkspaceSidebar] Error:", error);
        return {
            success: false as const,
            traceId,
            error: error?.message || "Failed to load workspace sidebar.",
        };
    }
}

export async function getConversationWorkspace(
    conversationId: string,
    options?: ConversationWorkspaceOptions
) {
    const traceId = createTraceId();
    const includeMessages = options?.includeMessages !== false;
    const includeActivity = options?.includeActivity !== false;
    const includeContactContext = options?.includeContactContext !== false;
    const includeTaskSummary = options?.includeTaskSummary !== false;
    const includeViewingSummary = options?.includeViewingSummary !== false;
    const includeAgentSummary = options?.includeAgentSummary !== false;

    const core = await getConversationWorkspaceCore(conversationId, {
        includeMessages,
        includeActivity,
        messageLimit: options?.messageLimit,
        activityLimit: options?.activityLimit,
    });

    if (!core?.success) {
        return {
            success: false as const,
            traceId,
            error: core?.error || "Failed to load workspace core.",
        };
    }

    const shouldLoadSidebar = includeContactContext || includeTaskSummary || includeViewingSummary || includeAgentSummary;
    const sidebar = shouldLoadSidebar
        ? await getConversationWorkspaceSidebar(conversationId)
        : null;

    if (shouldLoadSidebar && !sidebar?.success) {
        return {
            success: false as const,
            traceId,
            error: sidebar?.error || "Failed to load workspace sidebar.",
        };
    }

    const sidebarData = shouldLoadSidebar && sidebar && sidebar.success ? sidebar : null;

    return {
        success: true as const,
        traceId,
        conversationHeader: core.conversationHeader,
        messages: core.messages,
        activityTimeline: core.activityTimeline,
        contactContext: includeContactContext ? sidebarData?.contactContext || null : null,
        taskSummary: includeTaskSummary ? sidebarData?.taskSummary || null : null,
        viewingSummary: includeViewingSummary ? sidebarData?.viewingSummary || null : null,
        agentSummary: includeAgentSummary ? sidebarData?.agentSummary || null : null,
        transcriptEligibility: core.transcriptEligibility,
        freshness: core.freshness,
        messageWindow: core.messageWindow,
    };
}

export async function getConversationListDelta(
    status: 'active' | 'archived' | 'trash' | 'tasks' | 'all' = 'active',
    sinceCursor?: string | null,
    activeConversationId?: string | null,
    options?: { limit?: number }
) {
    const traceId = createTraceId();

    try {
        const normalizedStatus = status === "tasks" ? "active" : status;
        const location = await getAuthenticatedLocationReadOnly();
        const parsedCursor = decodeConversationDeltaCursor(sinceCursor);
        const limit = Math.min(
            Math.max(Number(options?.limit || DEFAULT_LIST_DELTA_LIMIT), 1),
            MAX_LIST_DELTA_LIMIT
        );

        if (!parsedCursor) {
            return {
                success: true as const,
                traceId,
                status: normalizedStatus,
                deltas: [],
                cursor: encodeConversationDeltaCursor({ id: "", updatedAtMs: Date.now() }),
                changedCount: 0,
                activeConversationChanged: false,
            };
        }

        return await withServerTiming("conversations.list_delta", {
            traceId,
            locationId: location.id,
            status: normalizedStatus,
            hasCursor: !!parsedCursor,
            limit,
            activeConversationId: activeConversationId || null,
        }, async () => {
            const rows = await db.conversation.findMany({
                where: {
                    locationId: location.id,
                    OR: [
                        { updatedAt: { gt: new Date(parsedCursor.updatedAtMs) } },
                        {
                            AND: [
                                { updatedAt: { equals: new Date(parsedCursor.updatedAtMs) } },
                                { id: { gt: parsedCursor.id || "" } },
                            ],
                        },
                    ],
                },
                orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
                take: limit,
                include: {
                    contact: { select: { name: true, email: true, phone: true, ghlContactId: true, preferredLang: true } },
                },
            });

            if (rows.length === 0) {
                return {
                    success: true as const,
                    traceId,
                    status: normalizedStatus,
                    deltas: [],
                    cursor: encodeConversationDeltaCursor(parsedCursor),
                    changedCount: 0,
                    activeConversationChanged: false,
                };
            }

            const activeDeals = await db.dealContext.findMany({
                where: {
                    locationId: location.id,
                    stage: "ACTIVE",
                    conversationIds: {
                        hasSome: rows.map((item) => item.ghlConversationId),
                    },
                },
                select: { id: true, title: true, conversationIds: true },
            });

            const dealMap = new Map<string, { id: string; title: string }>();
            for (const deal of activeDeals) {
                for (const conversationId of deal.conversationIds) {
                    dealMap.set(conversationId, { id: deal.id, title: deal.title });
                }
            }
            const locationDefaultReplyLanguage = await getLocationDefaultReplyLanguage(location.id);

            const deltas = rows.map((row) => {
                const matchesFilter = doesConversationMatchStatus(normalizedStatus, row);
                return {
                    id: row.ghlConversationId,
                    matchesFilter,
                    unreadCount: row.unreadCount,
                    lastMessageBody: row.lastMessageBody || "",
                    lastMessageDate: Math.floor(new Date(row.lastMessageAt).getTime() / 1000),
                    conversation: matchesFilter ? mapConversationRowToUi(row, location, dealMap, locationDefaultReplyLanguage) : null,
                };
            });

            const lastRow = rows[rows.length - 1];
            const nextCursor = encodeConversationDeltaCursor({
                id: lastRow.id,
                updatedAtMs: new Date(lastRow.updatedAt).getTime(),
            });
            const activeConversationChanged = !!activeConversationId && deltas.some((item) => item.id === activeConversationId);

            return {
                success: true as const,
                traceId,
                status: normalizedStatus,
                deltas,
                cursor: nextCursor,
                changedCount: deltas.length,
                activeConversationChanged,
            };
        });
    } catch (error: any) {
        console.error("[getConversationListDelta] Error:", error);
        return {
            success: false as const,
            traceId,
            status,
            deltas: [],
            cursor: sinceCursor || null,
            changedCount: 0,
            activeConversationChanged: false,
            error: error?.message || "Failed to load conversation delta.",
        };
    }
}

export async function refreshConversationOnDemand(
    conversationId: string,
    mode: "metadata_only" | "full_sync" = "metadata_only"
) {
    const traceId = createTraceId();
    const trimmedConversationId = String(conversationId || "").trim();
    if (!trimmedConversationId) {
        return {
            success: false as const,
            traceId,
            mode,
            error: "Missing conversation ID.",
        };
    }

    try {
        const location = await getAuthenticatedLocationReadOnly({ requireGhlToken: mode === "full_sync" });
        const conversation = await db.conversation.findFirst({
            where: {
                locationId: location.id,
                ghlConversationId: trimmedConversationId,
            },
            select: {
                id: true,
                ghlConversationId: true,
                contactId: true,
            },
        });

        if (!conversation) {
            return {
                success: false as const,
                traceId,
                mode,
                error: "Conversation not found.",
            };
        }

        if (mode === "metadata_only") {
            const refreshed = await refreshConversation(trimmedConversationId);
            invalidateConversationReadCaches(trimmedConversationId);
            emitConversationRealtimeEvent({
                locationId: location.id,
                conversationId: trimmedConversationId,
                type: "conversation.refreshed",
                payload: { mode },
            });
            return {
                success: true as const,
                traceId,
                mode,
                conversation: refreshed,
            };
        }

        const syncResult = await syncWhatsAppHistory(trimmedConversationId, 50, false, 0);
        invalidateConversationReadCaches(trimmedConversationId);
        emitConversationRealtimeEvent({
            locationId: location.id,
            conversationId: trimmedConversationId,
            type: "conversation.refreshed",
            payload: { mode, syncedCount: Number(syncResult?.count || 0) },
        });

        return {
            success: !!syncResult?.success,
            traceId,
            mode,
            syncedCount: Number(syncResult?.count || 0),
            skippedCount: Number(syncResult?.skipped || 0),
            error: syncResult?.success ? null : String(syncResult?.error || "Sync failed."),
        };
    } catch (error: any) {
        console.error("[refreshConversationOnDemand] Error:", error);
        return {
            success: false as const,
            traceId,
            mode,
            error: error?.message || "Failed to refresh conversation.",
        };
    }
}

const MAX_TRANSCRIPT_SEARCH_QUERY_LENGTH = 180;
const DEFAULT_TRANSCRIPT_SEARCH_LIMIT = 20;
const MAX_TRANSCRIPT_SEARCH_LIMIT = 60;
const MAX_TRANSCRIPT_FAILURE_EXAMPLES = 5;
const DEFAULT_TRANSCRIPT_REPORT_MONTH_OFFSET = 0;
const MAX_TRANSCRIPT_REPORT_MONTH_OFFSET = 11;

const TranscriptSearchInputSchema = z.object({
    query: z.string().trim().min(1).max(MAX_TRANSCRIPT_SEARCH_QUERY_LENGTH),
    limit: z.number().int().min(1).max(MAX_TRANSCRIPT_SEARCH_LIMIT).optional(),
}).optional();

const TranscriptMonthlyReportInputSchema = z.object({
    monthOffset: z.number().int().min(0).max(MAX_TRANSCRIPT_REPORT_MONTH_OFFSET).optional(),
    includeExtractions: z.boolean().optional(),
}).optional();

function clampTranscriptSearchLimit(limit?: number): number {
    const numeric = Number(limit);
    if (!Number.isFinite(numeric)) return DEFAULT_TRANSCRIPT_SEARCH_LIMIT;
    return Math.min(Math.max(Math.floor(numeric), 1), MAX_TRANSCRIPT_SEARCH_LIMIT);
}

function buildTranscriptSearchSnippet(text: string, query: string): string {
    const source = String(text || "").replace(/\s+/g, " ").trim();
    if (!source) return "";

    const needle = String(query || "").trim().toLowerCase();
    if (!needle) return source.slice(0, 200);

    const haystack = source.toLowerCase();
    const index = haystack.indexOf(needle);
    if (index < 0) return source.slice(0, 200);

    const before = 70;
    const after = 140;
    const start = Math.max(0, index - before);
    const end = Math.min(source.length, index + needle.length + after);
    const snippet = source.slice(start, end);

    return `${start > 0 ? "..." : ""}${snippet}${end < source.length ? "..." : ""}`;
}

function categorizeTranscriptFailure(error: unknown): string {
    const normalized = String(error || "").trim().toLowerCase();
    if (!normalized) return "unknown";
    if (
        normalized.includes("api key")
        || normalized.includes("unauthorized")
        || normalized.includes("forbidden")
        || normalized.includes("permission")
        || normalized.includes("403")
    ) {
        return "auth_or_api_key";
    }
    if (normalized.includes("rate limit") || normalized.includes("429")) {
        return "rate_limited";
    }
    if (
        normalized.includes("timeout")
        || normalized.includes("timed out")
        || normalized.includes("deadline")
        || normalized.includes("aborted")
    ) {
        return "timeout";
    }
    if (
        normalized.includes("queue")
        || normalized.includes("redis")
        || normalized.includes("enqueue")
    ) {
        return "queue_or_enqueue";
    }
    if (
        normalized.includes("attachment")
        || normalized.includes("r2")
        || normalized.includes("not found")
        || normalized.includes("empty")
    ) {
        return "media_or_storage";
    }
    if (
        normalized.includes("json")
        || normalized.includes("parse")
        || normalized.includes("schema")
    ) {
        return "invalid_model_output";
    }
    if (
        normalized.includes("network")
        || normalized.includes("socket")
        || normalized.includes("econn")
        || normalized.includes("fetch")
    ) {
        return "network";
    }
    if (
        normalized.includes("model")
        || normalized.includes("provider")
        || normalized.includes("gemini")
    ) {
        return "provider";
    }
    return "other";
}

function formatMonthLabel(date: Date): string {
    return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export async function searchConversationTranscriptMatches(
    conversationId: string,
    input?: z.input<typeof TranscriptSearchInputSchema>
) {
    const parsed = TranscriptSearchInputSchema.safeParse(input || {});
    if (!parsed.success) {
        return { success: false as const, error: "Invalid search query." };
    }

    const query = String(parsed.data?.query || "").trim();
    if (!query) {
        return { success: false as const, error: "Search query is required." };
    }

    const limit = clampTranscriptSearchLimit(parsed.data?.limit);

    try {
        const location = await getAuthenticatedLocation();
        const conversation = await db.conversation.findUnique({
            where: { ghlConversationId: String(conversationId || "").trim() },
            select: { id: true, locationId: true },
        });

        if (!conversation || conversation.locationId !== location.id) {
            return { success: false as const, error: "Conversation not found." };
        }

        // --- Search transcripts (existing behaviour) ---
        const transcriptWhere: any = {
            message: { conversationId: conversation.id },
            text: {
                not: null,
                contains: query,
                mode: "insensitive",
            },
        };

        // --- Search regular message bodies ---
        const messageWhere: any = {
            conversationId: conversation.id,
            body: {
                not: null,
                contains: query,
                mode: "insensitive",
            },
        };

        const [transcriptTotal, transcriptItems, messageTotal, messageItems] = await Promise.all([
            db.messageTranscript.count({ where: transcriptWhere }),
            db.messageTranscript.findMany({
                where: transcriptWhere,
                orderBy: { updatedAt: "desc" },
                take: limit,
                select: {
                    id: true,
                    status: true,
                    text: true,
                    model: true,
                    provider: true,
                    updatedAt: true,
                    createdAt: true,
                    message: {
                        select: {
                            id: true,
                            type: true,
                            direction: true,
                            createdAt: true,
                        },
                    },
                    attachment: {
                        select: {
                            id: true,
                            fileName: true,
                            contentType: true,
                        },
                    },
                },
            }),
            db.message.count({ where: messageWhere }),
            db.message.findMany({
                where: messageWhere,
                orderBy: { createdAt: "desc" },
                take: limit,
                select: {
                    id: true,
                    type: true,
                    direction: true,
                    body: true,
                    createdAt: true,
                },
            }),
        ]);

        // Build transcript results
        const transcriptResults = transcriptItems.map((item) => ({
            source: "transcript" as const,
            transcriptId: item.id,
            messageId: item.message.id,
            attachmentId: item.attachment.id,
            messageType: item.message.type,
            direction: item.message.direction,
            messageDate: item.message.createdAt.toISOString(),
            transcriptStatus: item.status,
            model: item.model || null,
            provider: item.provider || null,
            updatedAt: item.updatedAt.toISOString(),
            fileName: item.attachment.fileName || null,
            contentType: item.attachment.contentType || null,
            snippet: buildTranscriptSearchSnippet(String(item.text || ""), query),
        }));

        // Collect messageIds already covered by transcript matches to avoid duplicates
        const transcriptMessageIds = new Set(transcriptResults.map((r) => r.messageId));

        // Build message body results (skip if messageId already in transcript results)
        const messageResults = messageItems
            .filter((msg) => !transcriptMessageIds.has(msg.id))
            .map((msg) => ({
                source: "message" as const,
                transcriptId: null as string | null,
                messageId: msg.id,
                attachmentId: null as string | null,
                messageType: msg.type,
                direction: msg.direction,
                messageDate: msg.createdAt.toISOString(),
                transcriptStatus: null as string | null,
                model: null as string | null,
                provider: null as string | null,
                updatedAt: msg.createdAt.toISOString(),
                fileName: null as string | null,
                contentType: null as string | null,
                snippet: buildTranscriptSearchSnippet(String(msg.body || ""), query),
            }));

        // Merge, sort by messageDate desc, and cap at limit
        const merged = [...transcriptResults, ...messageResults]
            .sort((a, b) => new Date(b.messageDate).getTime() - new Date(a.messageDate).getTime())
            .slice(0, limit)
            .map((item, index) => ({ ...item, rank: index + 1 }));

        const totalMatches = transcriptTotal + messageTotal;

        return {
            success: true as const,
            query,
            limit,
            totalMatches,
            returned: merged.length,
            results: merged,
        };
    } catch (error: any) {
        console.error("[searchConversationTranscriptMatches] Error:", error);
        return {
            success: false as const,
            error: error?.message || "Failed to search conversation.",
        };
    }
}

export async function getAudioTranscriptMonthlyReport(
    input?: z.input<typeof TranscriptMonthlyReportInputSchema>
) {
    const parsed = TranscriptMonthlyReportInputSchema.safeParse(input || {});
    if (!parsed.success) {
        return { success: false as const, error: "Invalid report query." };
    }

    const monthOffset = parsed.data?.monthOffset ?? DEFAULT_TRANSCRIPT_REPORT_MONTH_OFFSET;
    const includeExtractions = parsed.data?.includeExtractions !== false;

    try {
        const location = await getAuthenticatedLocation();
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth() - monthOffset, 1);
        const monthEnd = new Date(now.getFullYear(), now.getMonth() - monthOffset + 1, 1);

        const transcriptWhere: any = {
            createdAt: { gte: monthStart, lt: monthEnd },
            message: {
                conversation: {
                    locationId: location.id,
                },
            },
        };
        const extractionWhere: any = {
            createdAt: { gte: monthStart, lt: monthEnd },
            transcript: {
                message: {
                    conversation: {
                        locationId: location.id,
                    },
                },
            },
        };

        const [
            transcriptTotalCount,
            transcriptStatusRows,
            transcriptModelStatusRows,
            transcriptFailureRows,
            transcriptDailyRows,
            extractionTotalCount,
            extractionStatusRows,
            extractionModelStatusRows,
            extractionFailureRows,
            extractionDailyRows,
        ] = await Promise.all([
            db.messageTranscript.count({ where: transcriptWhere }),
            db.messageTranscript.groupBy({
                by: ["status"],
                where: transcriptWhere,
                _count: { _all: true },
            }),
            db.messageTranscript.groupBy({
                by: ["model", "provider", "status"],
                where: transcriptWhere,
                _count: { _all: true },
                _sum: {
                    promptTokens: true,
                    completionTokens: true,
                    totalTokens: true,
                    estimatedCostUsd: true,
                },
            }),
            db.messageTranscript.findMany({
                where: {
                    ...transcriptWhere,
                    status: "failed",
                    error: { not: null },
                },
                select: { error: true },
                take: 500,
            }),
            db.messageTranscript.findMany({
                where: transcriptWhere,
                select: {
                    createdAt: true,
                    status: true,
                    totalTokens: true,
                    estimatedCostUsd: true,
                },
            }),
            includeExtractions ? db.messageTranscriptExtraction.count({ where: extractionWhere }) : Promise.resolve(0),
            includeExtractions
                ? db.messageTranscriptExtraction.groupBy({
                    by: ["status"],
                    where: extractionWhere,
                    _count: { _all: true },
                })
                : Promise.resolve([] as any[]),
            includeExtractions
                ? db.messageTranscriptExtraction.groupBy({
                    by: ["model", "provider", "status"],
                    where: extractionWhere,
                    _count: { _all: true },
                    _sum: {
                        promptTokens: true,
                        completionTokens: true,
                        totalTokens: true,
                        estimatedCostUsd: true,
                    },
                })
                : Promise.resolve([] as any[]),
            includeExtractions
                ? db.messageTranscriptExtraction.findMany({
                    where: {
                        ...extractionWhere,
                        status: "failed",
                        error: { not: null },
                    },
                    select: { error: true },
                    take: 500,
                })
                : Promise.resolve([] as any[]),
            includeExtractions
                ? db.messageTranscriptExtraction.findMany({
                    where: extractionWhere,
                    select: {
                        createdAt: true,
                        status: true,
                        totalTokens: true,
                        estimatedCostUsd: true,
                    },
                })
                : Promise.resolve([] as any[]),
        ]);

        const transcriptStatusCounts: Record<string, number> = {
            pending: 0,
            processing: 0,
            completed: 0,
            failed: 0,
        };
        for (const row of transcriptStatusRows) {
            const key = String(row.status || "").toLowerCase();
            if (!key) continue;
            transcriptStatusCounts[key] = row._count._all;
        }

        const extractionStatusCounts: Record<string, number> = {
            pending: 0,
            processing: 0,
            completed: 0,
            failed: 0,
        };
        for (const row of extractionStatusRows || []) {
            const key = String(row.status || "").toLowerCase();
            if (!key) continue;
            extractionStatusCounts[key] = row._count._all;
        }

        type ModelBucket = {
            model: string;
            provider: string;
            kind: "transcript" | "extraction";
            runs: number;
            completedRuns: number;
            failedRuns: number;
            promptTokens: number;
            completionTokens: number;
            totalTokens: number;
            estimatedCostUsd: number;
        };

        const modelMap = new Map<string, ModelBucket>();
        const consumeModelRows = (
            rows: Array<{
                model: string;
                provider: string;
                status: string;
                _count: { _all: number };
                _sum: {
                    promptTokens: number | null;
                    completionTokens: number | null;
                    totalTokens: number | null;
                    estimatedCostUsd: number | null;
                };
            }>,
            kind: "transcript" | "extraction"
        ) => {
            for (const row of rows) {
                const model = String(row.model || "").trim() || "unknown";
                const provider = String(row.provider || "").trim() || "unknown";
                const key = `${kind}:${provider}:${model}`;
                const existing = modelMap.get(key) || {
                    model,
                    provider,
                    kind,
                    runs: 0,
                    completedRuns: 0,
                    failedRuns: 0,
                    promptTokens: 0,
                    completionTokens: 0,
                    totalTokens: 0,
                    estimatedCostUsd: 0,
                };

                const rowCount = Number(row._count?._all || 0);
                const status = String(row.status || "").toLowerCase();
                existing.runs += rowCount;
                if (status === "completed") existing.completedRuns += rowCount;
                if (status === "failed") existing.failedRuns += rowCount;
                existing.promptTokens += Number(row._sum?.promptTokens || 0);
                existing.completionTokens += Number(row._sum?.completionTokens || 0);
                existing.totalTokens += Number(row._sum?.totalTokens || 0);
                existing.estimatedCostUsd += Number(row._sum?.estimatedCostUsd || 0);

                modelMap.set(key, existing);
            }
        };

        consumeModelRows(transcriptModelStatusRows as any, "transcript");
        consumeModelRows((extractionModelStatusRows || []) as any, "extraction");

        const byModel = Array.from(modelMap.values()).sort((a, b) => {
            const costDiff = b.estimatedCostUsd - a.estimatedCostUsd;
            if (Math.abs(costDiff) > 1e-9) return costDiff;
            return b.totalTokens - a.totalTokens;
        });

        const failureCategoryMap = new Map<string, { category: string; count: number; examples: string[] }>();
        const collectFailures = (rows: Array<{ error: string | null }>) => {
            for (const row of rows) {
                const raw = String(row.error || "").trim();
                if (!raw) continue;
                const category = categorizeTranscriptFailure(raw);
                const existing = failureCategoryMap.get(category) || { category, count: 0, examples: [] };
                existing.count += 1;
                if (existing.examples.length < MAX_TRANSCRIPT_FAILURE_EXAMPLES && !existing.examples.includes(raw)) {
                    existing.examples.push(raw);
                }
                failureCategoryMap.set(category, existing);
            }
        };
        collectFailures(transcriptFailureRows as any);
        collectFailures((extractionFailureRows || []) as any);

        const failureCategories = Array.from(failureCategoryMap.values())
            .sort((a, b) => b.count - a.count)
            .map((item) => ({
                category: item.category,
                count: item.count,
                examples: item.examples,
            }));

        type DailyPoint = {
            date: string;
            transcriptsCompleted: number;
            transcriptsFailed: number;
            extractionsCompleted: number;
            extractionsFailed: number;
            totalTokens: number;
            estimatedCostUsd: number;
        };

        const dailyMap = new Map<string, DailyPoint>();
        const ensureDaily = (date: string): DailyPoint => {
            const existing = dailyMap.get(date);
            if (existing) return existing;
            const created: DailyPoint = {
                date,
                transcriptsCompleted: 0,
                transcriptsFailed: 0,
                extractionsCompleted: 0,
                extractionsFailed: 0,
                totalTokens: 0,
                estimatedCostUsd: 0,
            };
            dailyMap.set(date, created);
            return created;
        };

        for (const row of transcriptDailyRows) {
            const key = row.createdAt.toISOString().slice(0, 10);
            const point = ensureDaily(key);
            const status = String(row.status || "").toLowerCase();
            if (status === "completed") point.transcriptsCompleted += 1;
            if (status === "failed") point.transcriptsFailed += 1;
            point.totalTokens += Number(row.totalTokens || 0);
            point.estimatedCostUsd += Number(row.estimatedCostUsd || 0);
        }

        for (const row of extractionDailyRows || []) {
            const key = row.createdAt.toISOString().slice(0, 10);
            const point = ensureDaily(key);
            const status = String(row.status || "").toLowerCase();
            if (status === "completed") point.extractionsCompleted += 1;
            if (status === "failed") point.extractionsFailed += 1;
            point.totalTokens += Number(row.totalTokens || 0);
            point.estimatedCostUsd += Number(row.estimatedCostUsd || 0);
        }

        const daily = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));

        const totalTokens = byModel.reduce((sum, row) => sum + row.totalTokens, 0);
        const estimatedCostUsd = byModel.reduce((sum, row) => sum + row.estimatedCostUsd, 0);

        return {
            success: true as const,
            window: {
                monthOffset,
                start: monthStart.toISOString(),
                end: monthEnd.toISOString(),
                label: formatMonthLabel(monthStart),
            },
            totals: {
                transcripts: transcriptTotalCount,
                extractions: extractionTotalCount,
                failed: transcriptStatusCounts.failed + extractionStatusCounts.failed,
                completed: transcriptStatusCounts.completed + extractionStatusCounts.completed,
                totalTokens,
                estimatedCostUsd,
            },
            status: {
                transcripts: transcriptStatusCounts,
                extractions: extractionStatusCounts,
            },
            byModel,
            failureCategories,
            daily,
        };
    } catch (error: any) {
        console.error("[getAudioTranscriptMonthlyReport] Error:", error);
        return {
            success: false as const,
            error: error?.message || "Failed to load audio transcript monthly report.",
        };
    }
}

function normalizeWhatsAppDigits(value: string | null | undefined): string {
    return String(value || "").replace(/\D/g, "");
}

function normalizeStoredLidJid(value: string | null | undefined): string | null {
    const raw = String(value || "").trim();
    if (!raw) return null;
    if (raw.endsWith("@lid")) return raw;
    if (raw.includes("@")) return null;
    return `${raw}@lid`;
}

function normalizeKnownChatJid(value: string | null | undefined): string | null {
    const raw = String(value || "").trim();
    if (!raw) return null;
    if (raw.endsWith("@s.whatsapp.net") || raw.endsWith("@g.us") || raw.endsWith("@lid")) {
        return raw;
    }
    return null;
}

function dedupeStrings(values: Array<string | null | undefined>): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const value of values) {
        const v = String(value || "").trim();
        if (!v || seen.has(v)) continue;
        seen.add(v);
        out.push(v);
    }
    return out;
}

function extractEvolutionLidJid(key: any): string | undefined {
    const remoteJid = typeof key?.remoteJid === "string" ? key.remoteJid : null;
    if (remoteJid?.endsWith("@lid")) return remoteJid;

    const participantJid = typeof key?.participant === "string" ? key.participant : null;
    if (participantJid?.endsWith("@lid")) return participantJid;

    return undefined;
}

async function resolveWhatsAppHistoryRemoteJids(
    evolutionClient: any,
    evolutionInstanceId: string,
    contact: { phone?: string | null; lid?: string | null; contactType?: string | null }
): Promise<{ candidates: string[]; isGroup: boolean; phoneDigits: string }> {
    const rawPhone = String(contact.phone || "").trim();
    const phoneDigits = normalizeWhatsAppDigits(rawPhone);
    const explicitPhoneJid = normalizeKnownChatJid(rawPhone);
    const explicitLidJid = normalizeStoredLidJid(contact.lid);
    const isGroup = contact.contactType === "WhatsAppGroup" || rawPhone.includes("@g.us");

    if (isGroup) {
        const groupJid =
            (explicitPhoneJid && explicitPhoneJid.endsWith("@g.us") ? explicitPhoneJid : null) ||
            (phoneDigits ? `${phoneDigits}@g.us` : null);
        return { candidates: dedupeStrings([groupJid]), isGroup: true, phoneDigits };
    }

    const candidates: Array<string | null> = [explicitLidJid];

    if (explicitPhoneJid && (explicitPhoneJid.endsWith("@s.whatsapp.net") || explicitPhoneJid.endsWith("@lid"))) {
        candidates.push(explicitPhoneJid);
    }

    if (phoneDigits.length >= 7) {
        try {
            const lookup = await evolutionClient.checkWhatsAppNumber(evolutionInstanceId, phoneDigits);
            if (lookup?.exists && typeof lookup.jid === "string" && lookup.jid) {
                candidates.push(lookup.jid);
            }
        } catch (err) {
            console.warn("[WhatsApp History] Failed to resolve phone to WhatsApp JID:", err);
        }

        candidates.push(`${phoneDigits}@s.whatsapp.net`);
    }

    return { candidates: dedupeStrings(candidates), isGroup: false, phoneDigits };
}

async function fetchEvolutionMessagesForContactHistory(params: {
    evolutionClient: any;
    evolutionInstanceId: string;
    contact: { phone?: string | null; lid?: string | null; contactType?: string | null };
    limit: number;
    offset?: number;
    logPrefix: string;
}): Promise<{
    messages: any[];
    remoteJid: string | null;
    candidates: string[];
    fetchedFrom: string[];
    isGroup: boolean;
    phoneDigits: string;
}> {
    const { evolutionClient, evolutionInstanceId, contact, limit, offset = 0, logPrefix } = params;
    const { candidates, isGroup, phoneDigits } = await resolveWhatsAppHistoryRemoteJids(
        evolutionClient,
        evolutionInstanceId,
        contact
    );

    if (candidates.length === 0) {
        return { messages: [], remoteJid: null, candidates, fetchedFrom: [], isGroup, phoneDigits };
    }

    const aggregated: any[] = [];
    const fetchedFrom: string[] = [];
    let lastTried: string | null = null;

    for (const candidate of candidates) {
        lastTried = candidate;
        console.log(`${logPrefix} Fetching messages for ${candidate} (Limit: ${limit}, Offset: ${offset})...`);
        const messages = await evolutionClient.fetchMessages(evolutionInstanceId, candidate, limit, offset);
        if (Array.isArray(messages) && messages.length > 0) {
            fetchedFrom.push(candidate);
            aggregated.push(...messages);
        }
    }

    if (aggregated.length === 0) {
        return { messages: [], remoteJid: lastTried, candidates, fetchedFrom: [], isGroup, phoneDigits };
    }

    const seen = new Set<string>();
    const deduped: any[] = [];

    for (const message of aggregated) {
        const keyId = String(message?.key?.id || message?.keyId || message?.messageId || "").trim();
        const remoteJid = String(message?.key?.remoteJid || "").trim();
        const timestamp = Number(message?.messageTimestamp || message?.timestamp || 0);
        const fallback = String(
            message?.message?.conversation ||
            message?.message?.extendedTextMessage?.text ||
            message?.body ||
            ""
        ).trim();
        const dedupeKey = keyId
            ? `id:${keyId}`
            : `fallback:${remoteJid}:${timestamp}:${fallback}`;

        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        deduped.push(message);
    }

    deduped.sort((a, b) => {
        const ta = Number(a?.messageTimestamp || a?.timestamp || 0);
        const tb = Number(b?.messageTimestamp || b?.timestamp || 0);
        return tb - ta;
    });

    return {
        messages: deduped,
        remoteJid: fetchedFrom[0] || lastTried,
        candidates,
        fetchedFrom,
        isGroup,
        phoneDigits
    };
}

const WHATSAPP_MEDIA_REFETCH_BATCH_SIZE = 50;
const WHATSAPP_MEDIA_REFETCH_MAX_SCAN = 2500;

function formatMediaRefetchFailureReason(reason: string | undefined) {
    switch (reason) {
        case "missing_input":
            return "missing input";
        case "unsupported_media_type":
            return "unsupported media type";
        case "message_not_found":
            return "message row missing";
        case "attachment_exists":
            return "attachment already exists";
        case "missing_base64":
            return "WhatsApp/Evolution no longer provides media payload for this message";
        default:
            return reason || "unknown reason";
    }
}

async function findEvolutionMessageByWamId(params: {
    evolutionClient: any;
    evolutionInstanceId: string;
    contact: { phone?: string | null; lid?: string | null; contactType?: string | null };
    wamId: string;
    maxScan?: number;
    batchSize?: number;
}) {
    const maxScan = Number(params.maxScan || WHATSAPP_MEDIA_REFETCH_MAX_SCAN);
    const batchSize = Number(params.batchSize || WHATSAPP_MEDIA_REFETCH_BATCH_SIZE);
    const safeMaxScan = Number.isFinite(maxScan) && maxScan > 0 ? Math.min(Math.floor(maxScan), 20000) : WHATSAPP_MEDIA_REFETCH_MAX_SCAN;
    const safeBatchSize = Number.isFinite(batchSize) && batchSize > 0 ? Math.min(Math.floor(batchSize), 250) : WHATSAPP_MEDIA_REFETCH_BATCH_SIZE;

    const { candidates } = await resolveWhatsAppHistoryRemoteJids(
        params.evolutionClient,
        params.evolutionInstanceId,
        params.contact
    );

    let scannedTotal = 0;

    for (const candidate of candidates) {
        let offset = 0;
        let scannedForCandidate = 0;

        while (scannedForCandidate < safeMaxScan) {
            const remaining = safeMaxScan - scannedForCandidate;
            const limit = Math.min(safeBatchSize, remaining);
            if (limit <= 0) break;

            const batch = await params.evolutionClient.fetchMessages(
                params.evolutionInstanceId,
                candidate,
                limit,
                offset
            );

            const records = Array.isArray(batch) ? batch : [];
            if (records.length === 0) break;

            scannedForCandidate += records.length;
            scannedTotal += records.length;
            const matched = records.find((item: any) => String(item?.key?.id || "") === params.wamId);
            if (matched) {
                return {
                    message: matched,
                    remoteJid: candidate,
                    scanned: scannedTotal,
                    candidates,
                };
            }

            offset += records.length;
            if (records.length < limit) break;
        }
    }

    return {
        message: null as any,
        remoteJid: null as string | null,
        scanned: scannedTotal,
        candidates,
    };
}

export async function refetchWhatsAppMediaAttachment(
    conversationId: string,
    messageId: string,
    options?: {
        deleteStoredObject?: boolean;
        maxScan?: number;
        batchSize?: number;
    }
) {
    const location = await getAuthenticatedLocation();

    if (!location?.evolutionInstanceId) {
        return { success: false as const, error: "WhatsApp (Evolution) is not connected." };
    }

    const conversation = await db.conversation.findUnique({
        where: { ghlConversationId: conversationId },
        include: {
            contact: {
                select: {
                    phone: true,
                    lid: true,
                    contactType: true,
                },
            },
        },
    });

    if (!conversation || conversation.locationId !== location.id) {
        return { success: false as const, error: "Conversation not found." };
    }

    const message = await db.message.findUnique({
        where: { id: messageId },
        include: { attachments: true },
    });

    if (!message || message.conversationId !== conversation.id) {
        return { success: false as const, error: "Message not found for this conversation." };
    }
    if (!message.wamId) {
        return { success: false as const, error: "Message is missing WhatsApp message id (wamId)." };
    }

    const { evolutionClient } = await import("@/lib/evolution/client");
    const lookup = await findEvolutionMessageByWamId({
        evolutionClient,
        evolutionInstanceId: location.evolutionInstanceId,
        contact: {
            phone: conversation.contact?.phone || null,
            lid: (conversation.contact as any)?.lid || null,
            contactType: (conversation.contact as any)?.contactType || null,
        },
        wamId: message.wamId,
        maxScan: options?.maxScan,
        batchSize: options?.batchSize,
    });

    if (!lookup.message) {
        return {
            success: false as const,
            error: `Could not locate this message in WhatsApp history. Tried JIDs: ${(lookup.candidates || []).join(", ") || "(none)"}; scanned ${lookup.scanned} messages.`,
        };
    }

    const parsedContent = parseEvolutionMessageContent(lookup.message?.message);
    if (parsedContent.type !== "image" && parsedContent.type !== "audio") {
        return {
            success: false as const,
            error: `Target message is not an image/audio media message (detected: ${parsedContent.type}).`,
        };
    }

    const snapshot = message.attachments.map((attachment) => ({
        fileName: attachment.fileName,
        contentType: attachment.contentType,
        size: attachment.size,
        url: attachment.url,
    }));

    if (snapshot.length > 0) {
        await db.messageAttachment.deleteMany({
            where: { messageId: message.id },
        });
    }

    let ingestResult: any;
    try {
        ingestResult = await ingestEvolutionMediaAttachment({
            instanceName: location.evolutionInstanceId,
            evolutionMessageData: lookup.message,
            wamId: message.wamId,
        });
    } catch (error: any) {
        if (snapshot.length > 0) {
            await db.messageAttachment.createMany({
                data: snapshot.map((attachment) => ({
                    messageId: message.id,
                    fileName: attachment.fileName,
                    contentType: attachment.contentType,
                    size: attachment.size,
                    url: attachment.url,
                })),
            }).catch((restoreErr) => {
                console.error("[refetchWhatsAppMediaAttachment] Failed to restore attachment rows after ingest error:", restoreErr);
            });
        }

        return {
            success: false as const,
            error: `Failed to fetch media from WhatsApp: ${error?.message || "Unknown error"}`,
        };
    }

    if (ingestResult?.status !== "stored") {
        if (snapshot.length > 0) {
            await db.messageAttachment.createMany({
                data: snapshot.map((attachment) => ({
                    messageId: message.id,
                    fileName: attachment.fileName,
                    contentType: attachment.contentType,
                    size: attachment.size,
                    url: attachment.url,
                })),
            }).catch((restoreErr) => {
                console.error("[refetchWhatsAppMediaAttachment] Failed to restore attachment rows after skipped ingest:", restoreErr);
            });
        }

        return {
            success: false as const,
            error: `WhatsApp media re-fetch did not store a new attachment (${formatMediaRefetchFailureReason(ingestResult?.reason)}).`,
        };
    }

    const deleteStoredObject = options?.deleteStoredObject !== false;
    const storageWarnings: string[] = [];
    let removedStorageObjects = 0;

    if (deleteStoredObject && snapshot.length > 0) {
        for (const attachment of snapshot) {
            const r2 = parseR2Uri(String(attachment.url || ""));
            if (!r2) continue;

            try {
                const removed = await deleteWhatsAppMediaObject(r2.key);
                if (removed.deleted) {
                    removedStorageObjects += 1;
                }
            } catch (storageErr: any) {
                storageWarnings.push(`Failed to delete old object ${r2.key}: ${storageErr?.message || "Unknown error"}`);
            }
        }
    }

    return {
        success: true as const,
        mediaType: parsedContent.type,
        removedAttachmentRows: snapshot.length,
        removedStorageObjects,
        remoteJid: lookup.remoteJid,
        scannedMessages: lookup.scanned,
        warnings: storageWarnings,
    };
}

async function queryTranscriptOnDemandEligibilityBase(locationId: string, conversationId: string) {
    const [enabled, conversation] = await Promise.all([
        isWhatsAppTranscriptOnDemandEnabledForLocation(locationId),
        db.conversation.findUnique({
            where: { ghlConversationId: conversationId },
            select: {
                id: true,
                locationId: true,
                lastMessageType: true,
            },
        }),
    ]);

    return {
        enabled,
        conversation,
    };
}

const getCachedTranscriptOnDemandEligibilityBase = unstable_cache(
    async (locationId: string, conversationId: string) =>
        queryTranscriptOnDemandEligibilityBase(locationId, conversationId),
    ["conversations:transcript_eligibility:v1"],
    {
        revalidate: 12,
        tags: ["conversations:transcript-eligibility"],
    }
);

export async function getWhatsAppTranscriptOnDemandEligibility(conversationId: string) {
    try {
        const location = await getAuthenticatedLocationReadOnly();
        const trimmedConversationId = String(conversationId || "").trim();
        if (!trimmedConversationId) {
            return {
                success: false as const,
                enabled: false as const,
                reason: "Missing conversation ID.",
            };
        }

        const [base, manualAccess] = await Promise.all([
            getCachedTranscriptOnDemandEligibilityBase(location.id, trimmedConversationId),
            resolveTranscriptManualActionAccess(location.id),
        ]);

        if (!base.enabled) {
            return {
                success: true as const,
                enabled: false as const,
                reason: "Audio transcript on-demand is disabled for this location.",
            };
        }

        if (manualAccess.blocked) {
            return {
                success: true as const,
                enabled: false as const,
                reason: getTranscriptManualActionRestrictionMessage(),
            };
        }

        if (!base.conversation || base.conversation.locationId !== location.id) {
            return {
                success: false as const,
                enabled: false as const,
                reason: "Conversation not found.",
            };
        }

        if (!isLikelyWhatsAppConversation(base.conversation.lastMessageType)) {
            return {
                success: true as const,
                enabled: false as const,
                reason: "This action is currently available only for WhatsApp conversations.",
            };
        }

        return {
            success: true as const,
            enabled: true as const,
            reason: null as string | null,
        };
    } catch (error: any) {
        console.error("[getWhatsAppTranscriptOnDemandEligibility] Error:", error);
        return {
            success: false as const,
            enabled: false as const,
            reason: error?.message || "Failed to resolve transcription eligibility.",
        };
    }
}

export async function requestWhatsAppAudioTranscript(
    conversationId: string,
    messageId: string,
    attachmentId: string,
    options?: {
        force?: boolean;
        priority?: WhatsAppTranscriptOnDemandPriority;
    }
) {
    try {
        const location = await getAuthenticatedLocation();
        const force = !!options?.force;
        const priority = options?.priority || "high";
        const manualAccess = await resolveTranscriptManualActionAccess(location.id);
        const baseAuditPayload: Record<string, unknown> = {
            conversationId,
            messageId,
            attachmentId,
            force,
            priority,
            visibilityPolicy: manualAccess.policy,
        };

        const onDemandEnabled = await isWhatsAppTranscriptOnDemandEnabledForLocation(location.id);
        if (!onDemandEnabled) {
            await persistTranscriptManualAuditEvent({
                type: TRANSCRIPT_MANUAL_AUDIT_EVENT_TYPES.request,
                locationId: location.id,
                actor: manualAccess.actor,
                payload: {
                    ...baseAuditPayload,
                    reason: "on_demand_disabled",
                },
                status: "error",
                error: "Audio transcript on-demand is disabled for this location.",
            });
            return {
                success: false as const,
                error: "Audio transcript on-demand is disabled for this location.",
            };
        }

        if (manualAccess.blocked) {
            await persistTranscriptManualAuditEvent({
                type: TRANSCRIPT_MANUAL_AUDIT_EVENT_TYPES.request,
                locationId: location.id,
                actor: manualAccess.actor,
                payload: {
                    ...baseAuditPayload,
                    reason: "visibility_policy_blocked",
                },
                status: "error",
                error: getTranscriptManualActionRestrictionMessage(),
            });
            return {
                success: false as const,
                error: getTranscriptManualActionRestrictionMessage(),
            };
        }

        const resolved = await resolveOwnedConversationAudioAttachment({
            locationId: location.id,
            conversationId,
            messageId,
            attachmentId,
        });
        if (!resolved.success) {
            await persistTranscriptManualAuditEvent({
                type: TRANSCRIPT_MANUAL_AUDIT_EVENT_TYPES.request,
                locationId: location.id,
                actor: manualAccess.actor,
                payload: {
                    ...baseAuditPayload,
                    reason: "attachment_resolution_failed",
                },
                status: "error",
                error: resolved.error,
            });
            return { success: false as const, error: resolved.error };
        }

        if (!isLikelyWhatsAppConversation(resolved.conversation.lastMessageType)) {
            await persistTranscriptManualAuditEvent({
                type: TRANSCRIPT_MANUAL_AUDIT_EVENT_TYPES.request,
                locationId: location.id,
                actor: manualAccess.actor,
                conversationId: resolved.conversation.id,
                contactId: resolved.conversation.contactId,
                payload: {
                    ...baseAuditPayload,
                    reason: "not_whatsapp",
                },
                status: "error",
                error: "This action is currently available only for WhatsApp conversations.",
            });
            return {
                success: false as const,
                error: "This action is currently available only for WhatsApp conversations.",
            };
        }

        try {
            await initWhatsAppAudioTranscriptionWorker();
        } catch (workerErr) {
            console.warn("[requestWhatsAppAudioTranscript] Worker init failed, continuing with enqueue fallback:", workerErr);
        }

        const enqueueResult = await enqueueWhatsAppAudioTranscription({
            locationId: location.id,
            messageId: resolved.message.id,
            attachmentId: resolved.attachment.id,
            force,
            priority,
        });

        if (!enqueueResult.accepted && enqueueResult.mode === "queue-unavailable") {
            await persistTranscriptManualAuditEvent({
                type: TRANSCRIPT_MANUAL_AUDIT_EVENT_TYPES.request,
                locationId: location.id,
                actor: manualAccess.actor,
                conversationId: resolved.conversation.id,
                contactId: resolved.conversation.contactId,
                payload: {
                    ...baseAuditPayload,
                    mode: enqueueResult.mode,
                    accepted: enqueueResult.accepted,
                    transcriptId: enqueueResult.transcriptId,
                    queueError: enqueueResult.error || null,
                },
                status: "error",
                error: enqueueResult.error || "Queue is unavailable. Please try again.",
            });
            return {
                success: false as const,
                error: enqueueResult.error || "Queue is unavailable. Please try again.",
                mode: enqueueResult.mode,
            };
        }

        if (!enqueueResult.accepted && enqueueResult.mode === "skipped") {
            await persistTranscriptManualAuditEvent({
                type: TRANSCRIPT_MANUAL_AUDIT_EVENT_TYPES.request,
                locationId: location.id,
                actor: manualAccess.actor,
                conversationId: resolved.conversation.id,
                contactId: resolved.conversation.contactId,
                payload: {
                    ...baseAuditPayload,
                    mode: enqueueResult.mode,
                    accepted: enqueueResult.accepted,
                    transcriptId: enqueueResult.transcriptId,
                    skipped: true,
                },
            });
            return {
                success: true as const,
                mode: enqueueResult.mode,
                skipped: true as const,
                message: "Transcript already completed.",
            };
        }

        if (enqueueResult.mode === "already-queued") {
            await persistTranscriptManualAuditEvent({
                type: TRANSCRIPT_MANUAL_AUDIT_EVENT_TYPES.request,
                locationId: location.id,
                actor: manualAccess.actor,
                conversationId: resolved.conversation.id,
                contactId: resolved.conversation.contactId,
                payload: {
                    ...baseAuditPayload,
                    mode: enqueueResult.mode,
                    accepted: enqueueResult.accepted,
                    transcriptId: enqueueResult.transcriptId,
                    skipped: true,
                },
            });
            return {
                success: true as const,
                mode: enqueueResult.mode,
                skipped: true as const,
                message: "Transcript is already queued.",
            };
        }

        await persistTranscriptManualAuditEvent({
            type: TRANSCRIPT_MANUAL_AUDIT_EVENT_TYPES.request,
            locationId: location.id,
            actor: manualAccess.actor,
            conversationId: resolved.conversation.id,
            contactId: resolved.conversation.contactId,
            payload: {
                ...baseAuditPayload,
                mode: enqueueResult.mode,
                accepted: enqueueResult.accepted,
                transcriptId: enqueueResult.transcriptId,
                skipped: false,
            },
        });

        return {
            success: true as const,
            mode: enqueueResult.mode,
            skipped: false as const,
            message: enqueueResult.mode === "inline-fallback"
                ? `${force ? "Regeneration" : "Transcription"} started (inline fallback).`
                : `${force ? "Regeneration" : "Transcription"} queued.`,
        };
    } catch (error: any) {
        console.error("[requestWhatsAppAudioTranscript] Error:", error);
        return { success: false as const, error: error?.message || "Failed to request transcript." };
    }
}

export async function bulkRequestWhatsAppAudioTranscripts(
    conversationId: string,
    options?: {
        window?: WhatsAppTranscriptBulkWindow;
        priority?: WhatsAppTranscriptOnDemandPriority;
    }
) {
    try {
        const location = await getAuthenticatedLocation();
        const window = options?.window === "all" ? "all" : "30d";
        const priority = options?.priority || "normal";
        const manualAccess = await resolveTranscriptManualActionAccess(location.id);
        const baseAuditPayload: Record<string, unknown> = {
            conversationId,
            window,
            priority,
            visibilityPolicy: manualAccess.policy,
        };

        const onDemandEnabled = await isWhatsAppTranscriptOnDemandEnabledForLocation(location.id);
        if (!onDemandEnabled) {
            await persistTranscriptManualAuditEvent({
                type: TRANSCRIPT_MANUAL_AUDIT_EVENT_TYPES.bulkRequest,
                locationId: location.id,
                actor: manualAccess.actor,
                payload: {
                    ...baseAuditPayload,
                    reason: "on_demand_disabled",
                },
                status: "error",
                error: "Audio transcript on-demand is disabled for this location.",
            });
            return {
                success: false as const,
                error: "Audio transcript on-demand is disabled for this location.",
            };
        }

        if (manualAccess.blocked) {
            await persistTranscriptManualAuditEvent({
                type: TRANSCRIPT_MANUAL_AUDIT_EVENT_TYPES.bulkRequest,
                locationId: location.id,
                actor: manualAccess.actor,
                payload: {
                    ...baseAuditPayload,
                    reason: "visibility_policy_blocked",
                },
                status: "error",
                error: getTranscriptManualActionRestrictionMessage(),
            });
            return {
                success: false as const,
                error: getTranscriptManualActionRestrictionMessage(),
            };
        }

        const conversation = await db.conversation.findUnique({
            where: { ghlConversationId: conversationId },
            select: {
                id: true,
                locationId: true,
                contactId: true,
                lastMessageType: true,
            },
        });

        if (!conversation || conversation.locationId !== location.id) {
            await persistTranscriptManualAuditEvent({
                type: TRANSCRIPT_MANUAL_AUDIT_EVENT_TYPES.bulkRequest,
                locationId: location.id,
                actor: manualAccess.actor,
                payload: {
                    ...baseAuditPayload,
                    reason: "conversation_not_found",
                },
                status: "error",
                error: "Conversation not found.",
            });
            return { success: false as const, error: "Conversation not found." };
        }
        if (!isLikelyWhatsAppConversation(conversation.lastMessageType)) {
            await persistTranscriptManualAuditEvent({
                type: TRANSCRIPT_MANUAL_AUDIT_EVENT_TYPES.bulkRequest,
                locationId: location.id,
                actor: manualAccess.actor,
                conversationId: conversation.id,
                contactId: conversation.contactId,
                payload: {
                    ...baseAuditPayload,
                    reason: "not_whatsapp",
                },
                status: "error",
                error: "Bulk transcription is currently available only for WhatsApp conversations.",
            });
            return {
                success: false as const,
                error: "Bulk transcription is currently available only for WhatsApp conversations.",
            };
        }

        const since = window === "all"
            ? null
            : new Date(Date.now() - WHATSAPP_TRANSCRIPT_BULK_DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);

        const messages = await db.message.findMany({
            where: {
                conversationId: conversation.id,
                ...(since ? { createdAt: { gte: since } } : {}),
            },
            select: {
                id: true,
                attachments: {
                    select: {
                        id: true,
                        contentType: true,
                        fileName: true,
                        url: true,
                        transcript: {
                            select: {
                                id: true,
                                status: true,
                            },
                        },
                    },
                },
            },
            orderBy: { createdAt: "desc" },
        });

        try {
            await initWhatsAppAudioTranscriptionWorker();
        } catch (workerErr) {
            console.warn("[bulkRequestWhatsAppAudioTranscripts] Worker init failed, continuing with enqueue fallback:", workerErr);
        }

        let scannedCount = 0;
        let audioCount = 0;
        let queuedCount = 0;
        let skippedCount = 0;
        let failedCount = 0;
        let alreadyQueuedCount = 0;
        let skippedHasTranscriptCount = 0;
        let skippedNonAudioCount = 0;
        const errors: string[] = [];

        for (const message of messages) {
            for (const attachment of message.attachments || []) {
                scannedCount += 1;
                const mediaKind = getWhatsAppMediaKind(attachment.contentType, attachment.fileName || attachment.url);
                if (mediaKind !== "audio") {
                    skippedCount += 1;
                    skippedNonAudioCount += 1;
                    continue;
                }

                audioCount += 1;
                if (attachment.transcript) {
                    skippedCount += 1;
                    skippedHasTranscriptCount += 1;
                    continue;
                }

                const enqueueResult = await enqueueWhatsAppAudioTranscription({
                    locationId: location.id,
                    messageId: message.id,
                    attachmentId: attachment.id,
                    force: false,
                    priority,
                    allowInlineFallback: false,
                });

                if (enqueueResult.mode === "queued" || enqueueResult.mode === "inline-fallback") {
                    queuedCount += 1;
                    continue;
                }
                if (enqueueResult.mode === "already-queued") {
                    skippedCount += 1;
                    alreadyQueuedCount += 1;
                    continue;
                }
                if (enqueueResult.mode === "skipped") {
                    skippedCount += 1;
                    skippedHasTranscriptCount += 1;
                    continue;
                }

                failedCount += 1;
                if (errors.length < 5) {
                    errors.push(enqueueResult.error || `Failed to enqueue attachment ${attachment.id}.`);
                }
            }
        }

        await persistTranscriptManualAuditEvent({
            type: TRANSCRIPT_MANUAL_AUDIT_EVENT_TYPES.bulkRequest,
            locationId: location.id,
            actor: manualAccess.actor,
            conversationId: conversation.id,
            contactId: conversation.contactId,
            payload: {
                ...baseAuditPayload,
                scannedCount,
                audioCount,
                queuedCount,
                skippedCount,
                failedCount,
                skippedNonAudioCount,
                skippedHasTranscriptCount,
                alreadyQueuedCount,
                sampleErrors: errors,
            },
        });

        return {
            success: true as const,
            mode: "bulk" as const,
            window,
            scannedCount,
            audioCount,
            queuedCount,
            skippedCount,
            failedCount,
            breakdown: {
                skippedNonAudioCount,
                skippedHasTranscriptCount,
                alreadyQueuedCount,
            },
            errors,
            message: queuedCount > 0
                ? `Queued ${queuedCount} audio transcript job${queuedCount === 1 ? "" : "s"}.`
                : failedCount > 0
                    ? "No jobs were queued due to queue errors."
                    : "No unprocessed audio attachments were found for this window.",
        };
    } catch (error: any) {
        console.error("[bulkRequestWhatsAppAudioTranscripts] Error:", error);
        return {
            success: false as const,
            error: error?.message || "Failed to request bulk transcription.",
        };
    }
}

export async function extractWhatsAppViewingNotes(
    conversationId: string,
    messageId: string,
    attachmentId: string,
    options?: {
        force?: boolean;
        priority?: WhatsAppTranscriptOnDemandPriority;
        allowInlineFallback?: boolean;
    }
) {
    try {
        const location = await getAuthenticatedLocation();
        const force = !!options?.force;
        const priority = options?.priority || "high";
        const allowInlineFallback = options?.allowInlineFallback;
        const manualAccess = await resolveTranscriptManualActionAccess(location.id);
        const baseAuditPayload: Record<string, unknown> = {
            conversationId,
            messageId,
            attachmentId,
            force,
            priority,
            allowInlineFallback: typeof allowInlineFallback === "boolean" ? allowInlineFallback : null,
            visibilityPolicy: manualAccess.policy,
        };

        const onDemandEnabled = await isWhatsAppTranscriptOnDemandEnabledForLocation(location.id);
        if (!onDemandEnabled) {
            await persistTranscriptManualAuditEvent({
                type: TRANSCRIPT_MANUAL_AUDIT_EVENT_TYPES.extract,
                locationId: location.id,
                actor: manualAccess.actor,
                payload: {
                    ...baseAuditPayload,
                    reason: "on_demand_disabled",
                },
                status: "error",
                error: "Audio transcript on-demand is disabled for this location.",
            });
            return {
                success: false as const,
                error: "Audio transcript on-demand is disabled for this location.",
            };
        }

        if (manualAccess.blocked) {
            await persistTranscriptManualAuditEvent({
                type: TRANSCRIPT_MANUAL_AUDIT_EVENT_TYPES.extract,
                locationId: location.id,
                actor: manualAccess.actor,
                payload: {
                    ...baseAuditPayload,
                    reason: "visibility_policy_blocked",
                },
                status: "error",
                error: getTranscriptManualActionRestrictionMessage(),
            });
            return {
                success: false as const,
                error: getTranscriptManualActionRestrictionMessage(),
            };
        }

        const resolved = await resolveOwnedConversationAudioAttachment({
            locationId: location.id,
            conversationId,
            messageId,
            attachmentId,
        });
        if (!resolved.success) {
            await persistTranscriptManualAuditEvent({
                type: TRANSCRIPT_MANUAL_AUDIT_EVENT_TYPES.extract,
                locationId: location.id,
                actor: manualAccess.actor,
                payload: {
                    ...baseAuditPayload,
                    reason: "attachment_resolution_failed",
                },
                status: "error",
                error: resolved.error,
            });
            return { success: false as const, error: resolved.error };
        }

        if (!isLikelyWhatsAppConversation(resolved.conversation.lastMessageType)) {
            await persistTranscriptManualAuditEvent({
                type: TRANSCRIPT_MANUAL_AUDIT_EVENT_TYPES.extract,
                locationId: location.id,
                actor: manualAccess.actor,
                conversationId: resolved.conversation.id,
                contactId: resolved.conversation.contactId,
                payload: {
                    ...baseAuditPayload,
                    reason: "not_whatsapp",
                },
                status: "error",
                error: "Viewing notes extraction is currently available only for WhatsApp conversations.",
            });
            return {
                success: false as const,
                error: "Viewing notes extraction is currently available only for WhatsApp conversations.",
            };
        }

        if (!resolved.attachment.transcript) {
            await persistTranscriptManualAuditEvent({
                type: TRANSCRIPT_MANUAL_AUDIT_EVENT_TYPES.extract,
                locationId: location.id,
                actor: manualAccess.actor,
                conversationId: resolved.conversation.id,
                contactId: resolved.conversation.contactId,
                payload: {
                    ...baseAuditPayload,
                    reason: "transcript_missing",
                },
                status: "error",
                error: "Transcript not found. Transcribe this audio first.",
            });
            return {
                success: false as const,
                error: "Transcript not found. Transcribe this audio first.",
            };
        }

        if (resolved.attachment.transcript.status !== "completed") {
            const statusError = resolved.attachment.transcript.status === "failed"
                ? "Transcript failed. Regenerate transcript first."
                : "Transcript is still processing. Try again once it is completed.";
            await persistTranscriptManualAuditEvent({
                type: TRANSCRIPT_MANUAL_AUDIT_EVENT_TYPES.extract,
                locationId: location.id,
                actor: manualAccess.actor,
                conversationId: resolved.conversation.id,
                contactId: resolved.conversation.contactId,
                payload: {
                    ...baseAuditPayload,
                    reason: "transcript_not_completed",
                    transcriptStatus: resolved.attachment.transcript.status,
                },
                status: "error",
                error: statusError,
            });
            return {
                success: false as const,
                error: statusError,
            };
        }

        try {
            await initWhatsAppAudioExtractionWorker();
        } catch (workerErr) {
            console.warn("[extractWhatsAppViewingNotes] Worker init failed, continuing with enqueue fallback:", workerErr);
        }

        const enqueueResult = await enqueueWhatsAppAudioExtraction({
            locationId: location.id,
            messageId: resolved.message.id,
            attachmentId: resolved.attachment.id,
            force,
            priority,
            allowInlineFallback,
        });

        if (!enqueueResult.accepted && enqueueResult.mode === "queue-unavailable") {
            await persistTranscriptManualAuditEvent({
                type: TRANSCRIPT_MANUAL_AUDIT_EVENT_TYPES.extract,
                locationId: location.id,
                actor: manualAccess.actor,
                conversationId: resolved.conversation.id,
                contactId: resolved.conversation.contactId,
                payload: {
                    ...baseAuditPayload,
                    mode: enqueueResult.mode,
                    accepted: enqueueResult.accepted,
                    transcriptId: enqueueResult.transcriptId,
                    extractionId: enqueueResult.extractionId,
                    queueError: enqueueResult.error || null,
                },
                status: "error",
                error: enqueueResult.error || "Queue is unavailable. Please try again.",
            });
            return {
                success: false as const,
                error: enqueueResult.error || "Queue is unavailable. Please try again.",
                mode: enqueueResult.mode,
            };
        }

        if (!enqueueResult.accepted && enqueueResult.mode === "skipped") {
            await persistTranscriptManualAuditEvent({
                type: TRANSCRIPT_MANUAL_AUDIT_EVENT_TYPES.extract,
                locationId: location.id,
                actor: manualAccess.actor,
                conversationId: resolved.conversation.id,
                contactId: resolved.conversation.contactId,
                payload: {
                    ...baseAuditPayload,
                    mode: enqueueResult.mode,
                    accepted: enqueueResult.accepted,
                    transcriptId: enqueueResult.transcriptId,
                    extractionId: enqueueResult.extractionId,
                    skipped: true,
                },
            });
            return {
                success: true as const,
                mode: enqueueResult.mode,
                skipped: true as const,
                extractionId: enqueueResult.extractionId,
                message: "Viewing notes are already extracted.",
            };
        }

        if (enqueueResult.mode === "already-queued") {
            await persistTranscriptManualAuditEvent({
                type: TRANSCRIPT_MANUAL_AUDIT_EVENT_TYPES.extract,
                locationId: location.id,
                actor: manualAccess.actor,
                conversationId: resolved.conversation.id,
                contactId: resolved.conversation.contactId,
                payload: {
                    ...baseAuditPayload,
                    mode: enqueueResult.mode,
                    accepted: enqueueResult.accepted,
                    transcriptId: enqueueResult.transcriptId,
                    extractionId: enqueueResult.extractionId,
                    skipped: true,
                },
            });
            return {
                success: true as const,
                mode: enqueueResult.mode,
                skipped: true as const,
                extractionId: enqueueResult.extractionId,
                message: "Viewing notes extraction is already queued.",
            };
        }

        await persistTranscriptManualAuditEvent({
            type: TRANSCRIPT_MANUAL_AUDIT_EVENT_TYPES.extract,
            locationId: location.id,
            actor: manualAccess.actor,
            conversationId: resolved.conversation.id,
            contactId: resolved.conversation.contactId,
            payload: {
                ...baseAuditPayload,
                mode: enqueueResult.mode,
                accepted: enqueueResult.accepted,
                transcriptId: enqueueResult.transcriptId,
                extractionId: enqueueResult.extractionId,
                skipped: false,
            },
        });

        return {
            success: true as const,
            mode: enqueueResult.mode,
            skipped: false as const,
            extractionId: enqueueResult.extractionId,
            message: enqueueResult.mode === "inline-fallback"
                ? `${force ? "Notes regeneration" : "Viewing notes extraction"} started (inline fallback).`
                : `${force ? "Notes regeneration" : "Viewing notes extraction"} queued.`,
        };
    } catch (error: any) {
        console.error("[extractWhatsAppViewingNotes] Error:", error);
        return {
            success: false as const,
            error: error?.message || "Failed to extract viewing notes.",
        };
    }
}

export async function retryWhatsAppAudioTranscript(
    conversationId: string,
    messageId: string,
    attachmentId: string
) {
    try {
        const location = await getAuthenticatedLocation();
        const manualAccess = await resolveTranscriptManualActionAccess(location.id);
        const baseAuditPayload: Record<string, unknown> = {
            conversationId,
            messageId,
            attachmentId,
            force: true,
            priority: "high",
            visibilityPolicy: manualAccess.policy,
        };

        if (manualAccess.blocked) {
            await persistTranscriptManualAuditEvent({
                type: TRANSCRIPT_MANUAL_AUDIT_EVENT_TYPES.retry,
                locationId: location.id,
                actor: manualAccess.actor,
                payload: {
                    ...baseAuditPayload,
                    reason: "visibility_policy_blocked",
                },
                status: "error",
                error: getTranscriptManualActionRestrictionMessage(),
            });
            return {
                success: false as const,
                error: getTranscriptManualActionRestrictionMessage(),
            };
        }

        const resolved = await resolveOwnedConversationAudioAttachment({
            locationId: location.id,
            conversationId,
            messageId,
            attachmentId,
        });
        if (!resolved.success) {
            await persistTranscriptManualAuditEvent({
                type: TRANSCRIPT_MANUAL_AUDIT_EVENT_TYPES.retry,
                locationId: location.id,
                actor: manualAccess.actor,
                payload: {
                    ...baseAuditPayload,
                    reason: "attachment_resolution_failed",
                },
                status: "error",
                error: resolved.error,
            });
            return { success: false as const, error: resolved.error };
        }

        try {
            await initWhatsAppAudioTranscriptionWorker();
        } catch (workerErr) {
            console.warn("[retryWhatsAppAudioTranscript] Worker init failed, continuing with enqueue fallback:", workerErr);
        }
        const enqueueResult = await enqueueWhatsAppAudioTranscription({
            locationId: location.id,
            messageId: resolved.message.id,
            attachmentId: resolved.attachment.id,
            force: true,
            priority: "high",
        });

        if (!enqueueResult.accepted && enqueueResult.mode === "skipped") {
            await persistTranscriptManualAuditEvent({
                type: TRANSCRIPT_MANUAL_AUDIT_EVENT_TYPES.retry,
                locationId: location.id,
                actor: manualAccess.actor,
                conversationId: resolved.conversation.id,
                contactId: resolved.conversation.contactId,
                payload: {
                    ...baseAuditPayload,
                    mode: enqueueResult.mode,
                    accepted: enqueueResult.accepted,
                    transcriptId: enqueueResult.transcriptId,
                    skipped: true,
                },
            });
            return {
                success: true as const,
                mode: enqueueResult.mode,
                skipped: true as const,
                message: "Transcript already completed. No retry was needed.",
            };
        }

        if (!enqueueResult.accepted && enqueueResult.mode === "queue-unavailable") {
            await persistTranscriptManualAuditEvent({
                type: TRANSCRIPT_MANUAL_AUDIT_EVENT_TYPES.retry,
                locationId: location.id,
                actor: manualAccess.actor,
                conversationId: resolved.conversation.id,
                contactId: resolved.conversation.contactId,
                payload: {
                    ...baseAuditPayload,
                    mode: enqueueResult.mode,
                    accepted: enqueueResult.accepted,
                    transcriptId: enqueueResult.transcriptId,
                    queueError: enqueueResult.error || null,
                },
                status: "error",
                error: enqueueResult.error || "Queue is unavailable. Please try again.",
            });
            return {
                success: false as const,
                error: enqueueResult.error || "Queue is unavailable. Please try again.",
                mode: enqueueResult.mode,
            };
        }

        if (enqueueResult.mode === "already-queued") {
            await persistTranscriptManualAuditEvent({
                type: TRANSCRIPT_MANUAL_AUDIT_EVENT_TYPES.retry,
                locationId: location.id,
                actor: manualAccess.actor,
                conversationId: resolved.conversation.id,
                contactId: resolved.conversation.contactId,
                payload: {
                    ...baseAuditPayload,
                    mode: enqueueResult.mode,
                    accepted: enqueueResult.accepted,
                    transcriptId: enqueueResult.transcriptId,
                    skipped: true,
                },
            });
            return {
                success: true as const,
                mode: enqueueResult.mode,
                skipped: true as const,
                message: "Transcript is already queued.",
            };
        }

        await persistTranscriptManualAuditEvent({
            type: TRANSCRIPT_MANUAL_AUDIT_EVENT_TYPES.retry,
            locationId: location.id,
            actor: manualAccess.actor,
            conversationId: resolved.conversation.id,
            contactId: resolved.conversation.contactId,
            payload: {
                ...baseAuditPayload,
                mode: enqueueResult.mode,
                accepted: enqueueResult.accepted,
                transcriptId: enqueueResult.transcriptId,
                skipped: false,
            },
        });

        return {
            success: true as const,
            mode: enqueueResult.mode,
            skipped: false as const,
            message: enqueueResult.mode === "inline-fallback"
                ? "Retry started (inline fallback)."
                : "Retry queued.",
        };
    } catch (error: any) {
        console.error("[retryWhatsAppAudioTranscript] Error:", error);
        return { success: false as const, error: error?.message || "Failed to retry transcript." };
    }
}

export async function syncWhatsAppHistory(conversationId: string, limit: number = 20, ignoreDuplicates: boolean = false, offset: number = 0) {
    const location = await getAuthenticatedLocationReadOnly({ requireGhlToken: false });

    const conversation = await db.conversation.findFirst({
        where: {
            ghlConversationId: conversationId,
            locationId: location.id,
        },
        include: { contact: true }
    });

    if (!conversation) return { success: false, error: "Conversation not found" };
    if (!location.evolutionInstanceId) return { success: false, error: "WhatsApp not connected" };
    if (!conversation.contact?.phone && !conversation.contact?.lid) return { success: false, error: "Contact has no phone number or WhatsApp LID" };

    try {
        const { evolutionClient } = await import("@/lib/evolution/client");
        const { processNormalizedMessage } = await import("@/lib/whatsapp/sync");

        const fetchLimit = limit || 50;
        const {
            messages: evolutionMessages,
            remoteJid,
            candidates: remoteJidCandidates,
            fetchedFrom: fetchedRemoteJids,
            phoneDigits: phone,
        } = await fetchEvolutionMessagesForContactHistory({
            evolutionClient,
            evolutionInstanceId: location.evolutionInstanceId,
            contact: {
                phone: conversation.contact.phone,
                lid: (conversation.contact as any).lid || null,
                contactType: (conversation.contact as any).contactType || null,
            },
            limit: fetchLimit,
            offset,
            logPrefix: `[Sync][${conversationId}]`,
        });

        console.log(
            `[Sync] History fetch candidates for ${conversationId}: ${remoteJidCandidates.join(", ") || "(none)"}; fetchedFrom=${fetchedRemoteJids.join(", ") || "none"}; primary=${remoteJid || "none"}; found=${evolutionMessages.length}; ignoreDupes=${ignoreDuplicates}`
        );

        // --- Auto-resolve LID placeholder contacts ---
        // If this contact has no phone but we discovered real phone digits via history fetch,
        // backfill the phone or merge into an existing contact with that phone.
        const syncContact = conversation.contact;
        if (syncContact && !syncContact.phone && (syncContact as any).lid && phone && phone.length >= 7) {
            const normalizedPhone = phone.startsWith('+') ? phone : `+${phone}`;
            const phoneSuffix = phone.slice(-7);

            try {
                // Check if a real contact already exists for this phone
                const phoneCandidates = await db.contact.findMany({
                    where: {
                        locationId: location.id,
                        phone: { contains: phoneSuffix },
                        id: { not: syncContact.id }
                    }
                });

                const existingPhoneContact = phoneCandidates.find(c => {
                    if (!c.phone) return false;
                    const cDigits = c.phone.replace(/\D/g, '');
                    return (
                        cDigits === phone ||
                        (cDigits.endsWith(phone) && phone.length >= 7) ||
                        (phone.endsWith(cDigits) && cDigits.length >= 7)
                    );
                });

                if (existingPhoneContact) {
                    // Merge: move conversations & messages from placeholder to real contact
                    console.log(`[Sync Auto-Merge] Merging LID placeholder ${syncContact.id} into phone contact ${existingPhoneContact.id} (${existingPhoneContact.phone})`);

                    const sourceConvos = await db.conversation.findMany({
                        where: { contactId: syncContact.id, locationId: location.id }
                    });

                    for (const sourceConvo of sourceConvos) {
                        const targetConvo = await db.conversation.findUnique({
                            where: {
                                locationId_contactId: {
                                    locationId: location.id,
                                    contactId: existingPhoneContact.id
                                }
                            }
                        });

                        if (targetConvo) {
                            await db.message.updateMany({
                                where: { conversationId: sourceConvo.id },
                                data: { conversationId: targetConvo.id }
                            });
                            await db.conversation.delete({ where: { id: sourceConvo.id } });
                            console.log(`[Sync Auto-Merge] Merged conversation ${sourceConvo.id} -> ${targetConvo.id}`);
                        } else {
                            await db.conversation.update({
                                where: { id: sourceConvo.id },
                                data: { contactId: existingPhoneContact.id }
                            });
                            console.log(`[Sync Auto-Merge] Reassigned conversation ${sourceConvo.id} to ${existingPhoneContact.id}`);
                        }
                    }

                    // Transfer LID to the real contact
                    if ((syncContact as any).lid && !(existingPhoneContact as any).lid) {
                        await db.contact.update({
                            where: { id: existingPhoneContact.id },
                            data: { lid: (syncContact as any).lid } as any
                        });
                    }

                    // Delete the placeholder
                    await db.contact.delete({ where: { id: syncContact.id } });
                    console.log(`[Sync Auto-Merge] Deleted placeholder contact ${syncContact.id}. Merged into ${existingPhoneContact.id}`);

                    return {
                        success: true,
                        count: 0,
                        skipped: 0,
                        autoMerged: true,
                        mergedIntoContactId: existingPhoneContact.id,
                        message: `Contact auto-merged into ${existingPhoneContact.name || existingPhoneContact.phone}`
                    };
                } else {
                    // No duplicate — just backfill the phone on this placeholder
                    await db.contact.update({
                        where: { id: syncContact.id },
                        data: { phone: normalizedPhone }
                    });
                    console.log(`[Sync Auto-Merge] Backfilled phone ${normalizedPhone} on LID contact ${syncContact.id}`);
                }
            } catch (autoMergeErr) {
                console.error(`[Sync Auto-Merge] Error during auto-merge for ${syncContact.id}:`, autoMergeErr);
                // Continue with normal sync even if auto-merge fails
            }
        }

        let synced = 0;
        let skipped = 0;
        let consecutiveDuplicates = 0;
        const STOP_ON_DUPLICATES = 5;

        for (const msg of evolutionMessages) {
            try {
                const key = msg.key;
                const messageContent = msg.message;
                if (!messageContent || !key?.id) continue;

                const isFromMe = key.fromMe;

                // Detect group chat
                const isGroup = key.remoteJid?.includes('@g.us') || false;

                // Enhanced Participant Resolution (LID Fix)
                const realSenderPhone = (msg as any).senderPn || (key.participant?.includes('@s.whatsapp.net') ? key.participant.replace('@s.whatsapp.net', '') : null);
                let participantPhone = realSenderPhone || (key.participant ? key.participant.replace('@s.whatsapp.net', '').replace('@lid', '') : undefined);

                // For group messages, the participant is the sender; for 1:1, it's the phone from the contact
                // We use the Group Phone for 'from' to keep the conversation unified.
                // The participant field identifies the actual sender.

                const parsedContent = parseEvolutionMessageContent(messageContent);
                const senderName = msg.pushName || realSenderPhone || "Unknown";
                const normalizedBody = isGroup && parsedContent.type !== 'text'
                    ? `[${senderName}]: ${parsedContent.body}`
                    : parsedContent.body;

                const normalized: any = {
                    from: isFromMe ? location.id : phone,
                    to: isFromMe ? phone : location.id,
                    body: normalizedBody,
                    type: parsedContent.type,
                    wamId: key.id,
                    timestamp: new Date(msg.messageTimestamp ? (msg.messageTimestamp as number) * 1000 : Date.now()),
                    direction: isFromMe ? 'outbound' : 'inbound',
                    source: 'whatsapp_evolution',
                    locationId: location.id,
                    contactName: isGroup ? undefined : (msg.pushName || realSenderPhone), // Don't rename group to sender name
                    isGroup: isGroup,
                    participant: participantPhone, // Pass resolved participant to sync
                    participantJid: typeof key.participant === "string" ? key.participant : undefined,
                    participantPhoneJid: typeof (msg as any).senderPn === "string" ? String((msg as any).senderPn) : undefined,
                    participantLidJid: typeof key.participant === "string" && key.participant.endsWith("@lid") ? key.participant : undefined,
                    participantDisplayName: isGroup ? (msg.pushName || realSenderPhone || undefined) : undefined,
                    lid: !isGroup ? extractEvolutionLidJid(key) : undefined,
                    resolvedPhone: !isGroup && phone ? phone : undefined,
                };

                if ((parsedContent.type === 'image' || parsedContent.type === 'audio' || parsedContent.type === 'document') && location.evolutionInstanceId) {
                    normalized.__evolutionMediaAttachmentPayload = {
                        instanceName: location.evolutionInstanceId,
                        evolutionMessageData: msg,
                    };
                }

                const result = await processNormalizedMessage(normalized);

                if ((parsedContent.type === 'image' || parsedContent.type === 'audio' || parsedContent.type === 'document') && location.evolutionInstanceId) {
                    if (result?.status === 'deferred_unresolved_lid') {
                        console.log(`[Sync] Delaying media attachment ingest until LID resolves (${key.id})`);
                    } else {
                        void ingestEvolutionMediaAttachment({
                            instanceName: location.evolutionInstanceId,
                            evolutionMessageData: msg,
                            wamId: key.id,
                        }).catch((err) => {
                            console.error(`[Sync] Failed to ingest media attachment for ${key.id}:`, err);
                        });
                    }
                }

                if (result?.status === 'skipped') {
                    skipped++;
                    consecutiveDuplicates++;
                } else {
                    synced++;
                    consecutiveDuplicates = 0;
                }

                if (!ignoreDuplicates && consecutiveDuplicates >= STOP_ON_DUPLICATES) {
                    console.log(`[Sync] Stopped after ${consecutiveDuplicates} consecutive duplicates.`);
                    break;
                }
            } catch (msgErr) {
                // Skip
            }
        }

        if (synced > 0) {
            invalidateConversationReadCaches(conversationId);
        }
        return { success: true, count: synced, skipped };
    } catch (e: any) {
        console.error("Manual sync failed:", e);
        return { success: false, error: e.message };
    }
}

const WHATSAPP_IMAGE_MIME_TYPES = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/heic",
    "image/heif",
]);
const WHATSAPP_AUDIO_MIME_TYPES = new Set([
    "audio/ogg",
    "audio/opus",
    "audio/mpeg",
    "audio/mp4",
    "audio/webm",
    "audio/wav",
    "audio/x-wav",
    "audio/aac",
]);
const WHATSAPP_DOCUMENT_MIME_TYPES = new Set([
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "text/plain",
    "application/zip",
    "text/csv",
]);
const MAX_WHATSAPP_IMAGE_BYTES = 16 * 1024 * 1024;
const MAX_WHATSAPP_AUDIO_BYTES = 16 * 1024 * 1024;
const MAX_WHATSAPP_DOCUMENT_BYTES = 100 * 1024 * 1024;

type WhatsAppMediaKind = "image" | "audio" | "document";
type WhatsAppTranscriptOnDemandPriority = "normal" | "high";
type WhatsAppTranscriptBulkWindow = "30d" | "all";

type WhatsAppMediaUploadRef = {
    objectKey: string;
    fileName: string;
    contentType: string;
    size: number;
    kind: WhatsAppMediaKind;
};

type WhatsAppImageUploadRef = Omit<WhatsAppMediaUploadRef, "kind"> & { kind?: WhatsAppMediaKind };

function getWhatsAppMediaKind(contentType: string, fileName?: string): WhatsAppMediaKind | null {
    const normalizedContentType = String(contentType || "").toLowerCase();
    if (WHATSAPP_IMAGE_MIME_TYPES.has(normalizedContentType)) return "image";
    if (WHATSAPP_AUDIO_MIME_TYPES.has(normalizedContentType)) return "audio";
    if (WHATSAPP_DOCUMENT_MIME_TYPES.has(normalizedContentType)) return "document";

    const target = String(fileName || "").toLowerCase();
    if (target.match(/\.(jpg|jpeg|png|webp|gif|heic|heif)$/)) return "image";
    if (target.match(/\.(ogg|opus|mp3|m4a|webm|wav|aac)$/)) return "audio";
    if (target.match(/\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|zip|csv)$/)) return "document";
    return null;
}

function parseOptionalBooleanFlag(value: unknown): boolean | null {
    const normalized = String(value || "").trim().toLowerCase();
    if (!normalized) return null;
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
    return null;
}

async function isWhatsAppTranscriptOnDemandEnabledForLocation(locationId: string): Promise<boolean> {
    const envOverride = parseOptionalBooleanFlag(process.env.WHATSAPP_TRANSCRIPT_ON_DEMAND_ENABLED);
    if (typeof envOverride === "boolean") return envOverride;

    const config = await db.siteConfig.findUnique({
        where: { locationId },
        select: {
            whatsappTranscriptOnDemandEnabled: true,
        } as any,
    });

    return !!(config as any)?.whatsappTranscriptOnDemandEnabled;
}

function isLikelyWhatsAppConversation(lastMessageType: string | null | undefined): boolean {
    return String(lastMessageType || "").toUpperCase().includes("WHATSAPP");
}

async function resolveOwnedConversationAudioAttachment(args: {
    locationId: string;
    conversationId: string;
    messageId: string;
    attachmentId: string;
}) {
    const conversation = await db.conversation.findUnique({
        where: { ghlConversationId: args.conversationId },
        select: {
            id: true,
            locationId: true,
            contactId: true,
            lastMessageType: true,
        },
    });

    if (!conversation || conversation.locationId !== args.locationId) {
        return { success: false as const, error: "Conversation not found." };
    }

    const message = await db.message.findUnique({
        where: { id: args.messageId },
        include: {
            attachments: {
                include: {
                    transcript: {
                        select: {
                            id: true,
                            status: true,
                        },
                    },
                },
            },
        },
    });
    if (!message || message.conversationId !== conversation.id) {
        return { success: false as const, error: "Message not found for this conversation." };
    }

    const attachment = (message.attachments || []).find((item) => item.id === args.attachmentId);
    if (!attachment) {
        return { success: false as const, error: "Attachment not found for this message." };
    }

    const mediaKind = getWhatsAppMediaKind(attachment.contentType, attachment.fileName || attachment.url);
    if (mediaKind !== "audio") {
        return { success: false as const, error: "Attachment is not an audio file." };
    }

    return {
        success: true as const,
        conversation,
        message,
        attachment,
    };
}

function isSupportedWhatsAppMedia(contentType: string, kind: WhatsAppMediaKind) {
    const normalizedContentType = String(contentType || "").toLowerCase();
    if (kind === "image") return WHATSAPP_IMAGE_MIME_TYPES.has(normalizedContentType);
    if (kind === "audio") return WHATSAPP_AUDIO_MIME_TYPES.has(normalizedContentType);
    if (kind === "document") return WHATSAPP_DOCUMENT_MIME_TYPES.has(normalizedContentType);
    return false;
}

function getWhatsAppMediaMaxSize(kind: WhatsAppMediaKind) {
    if (kind === "image") return MAX_WHATSAPP_IMAGE_BYTES;
    if (kind === "audio") return MAX_WHATSAPP_AUDIO_BYTES;
    return MAX_WHATSAPP_DOCUMENT_BYTES;
}

export async function createWhatsAppMediaUploadUrl(
    conversationId: string,
    contactId: string,
    file: { fileName: string; contentType: string; size: number }
) {
    const location = await getAuthenticatedLocationReadOnly({ requireGhlToken: false });

    if (!location?.evolutionInstanceId) {
        return { success: false, error: "WhatsApp (Evolution) is not connected." };
    }

    const contentType = String(file.contentType || "").toLowerCase();
    const size = Number(file.size || 0);
    const fileName = String(file.fileName || "upload");
    const mediaKind = getWhatsAppMediaKind(contentType, fileName);

    if (!mediaKind) {
        return { success: false, error: `Unsupported media type: ${contentType || "unknown"}` };
    }
    if (!isSupportedWhatsAppMedia(contentType, mediaKind)) {
        return { success: false, error: `Unsupported ${mediaKind} type: ${contentType || "unknown"}` };
    }
    if (!size || size <= 0) {
        return { success: false, error: "Invalid file size." };
    }
    const maxSize = getWhatsAppMediaMaxSize(mediaKind);
    if (size > maxSize) {
        const kindLabel = mediaKind === "image" ? "Image" : mediaKind === "audio" ? "Audio" : "Document";
        return { success: false, error: `${kindLabel} is too large. Max size is ${Math.floor(maxSize / (1024 * 1024))}MB.` };
    }

    const conversation = await db.conversation.findUnique({
        where: { ghlConversationId: conversationId },
        select: { id: true, locationId: true, contactId: true }
    });

    if (!conversation || conversation.locationId !== location.id) {
        return { success: false, error: "Conversation not found." };
    }

    const contact = await db.contact.findFirst({
        where: {
            OR: [{ ghlContactId: contactId }, { id: contactId }],
            locationId: location.id
        },
        select: { id: true }
    });

    if (!contact) {
        return { success: false, error: "Contact not found." };
    }
    if (conversation.contactId !== contact.id) {
        return { success: false, error: "Conversation/contact mismatch." };
    }

    const key = buildWhatsAppOutboundUploadKey({
        locationId: location.id,
        contactId: contact.id,
        conversationId: conversation.id,
        fileName,
        contentType,
    });

    const upload = await createWhatsAppMediaUploadSignedUrl({
        key,
        contentType,
        expiresInSeconds: 600,
    });

    return {
        success: true as const,
        uploadUrl: upload.uploadUrl,
        upload: {
            objectKey: key,
            fileName,
            contentType,
            size,
            kind: mediaKind,
        },
        headers: {
            "Content-Type": contentType,
        },
    };
}

export async function createWhatsAppImageUploadUrl(
    conversationId: string,
    contactId: string,
    file: { fileName: string; contentType: string; size: number }
) {
    const mediaKind = getWhatsAppMediaKind(file.contentType, file.fileName);
    if (mediaKind !== "image") {
        return { success: false, error: `Unsupported image type: ${String(file.contentType || "").toLowerCase() || "unknown"}` };
    }

    return createWhatsAppMediaUploadUrl(conversationId, contactId, file);
}

export async function sendWhatsAppMediaReply(
    conversationId: string,
    contactId: string,
    upload: WhatsAppMediaUploadRef | WhatsAppImageUploadRef,
    options?: {
        caption?: string;
        kind?: WhatsAppMediaKind;
        clientMessageId?: string;
    }
) {
    const location = await getAuthenticatedLocationReadOnly({ requireGhlToken: false });

    const cleanCaption = String(options?.caption || "").trim();

    try {
        if (!location?.evolutionInstanceId) {
            return { success: false, error: "WhatsApp (Evolution) is not connected." };
        }

        const contentType = String(upload?.contentType || "").toLowerCase();
        const size = Number(upload?.size || 0);
        const objectKey = String(upload?.objectKey || "");
        const fileName = String(upload?.fileName || "upload");
        const inferredKind = getWhatsAppMediaKind(contentType, fileName);
        const uploadKind = (upload as any)?.kind as WhatsAppMediaKind | undefined;
        const mediaKind: WhatsAppMediaKind | null = options?.kind || uploadKind || inferredKind;
        const previewBody =
            mediaKind === "audio"
                ? "[Audio]"
                : mediaKind === "document"
                    ? (cleanCaption || "[Document]")
                    : (cleanCaption || "[Image]");

        const conversation = await db.conversation.findUnique({
            where: { ghlConversationId: conversationId },
            select: { id: true, locationId: true, contactId: true }
        });
        if (!conversation || conversation.locationId !== location.id) {
            return { success: false, error: "Conversation not found." };
        }

        if (!objectKey.startsWith("whatsapp/evolution/v1/")) {
            return { success: false, error: "Invalid upload reference." };
        }
        if (!objectKey.includes(`/location/${location.id}/`) || !objectKey.includes(`/conversation/${conversation.id}/`)) {
            return { success: false, error: "Upload reference does not belong to this conversation." };
        }
        if (!mediaKind) {
            return { success: false, error: `Unsupported media type: ${contentType || "unknown"}` };
        }
        if (!isSupportedWhatsAppMedia(contentType, mediaKind)) {
            return { success: false, error: `Unsupported ${mediaKind} type: ${contentType || "unknown"}` };
        }
        const maxSize = getWhatsAppMediaMaxSize(mediaKind);
        if (!size || size > maxSize) {
            return { success: false, error: `Invalid ${mediaKind} size.` };
        }

        const objectHead = await headWhatsAppMediaObject(objectKey);
        if (!objectHead.exists) {
            return { success: false, error: "Uploaded media not found in storage. Please re-upload and try again." };
        }

        const contact = await db.contact.findFirst({
            where: {
                OR: [
                    { ghlContactId: contactId },
                    { id: contactId }
                ],
                locationId: location.id
            },
            select: { id: true, phone: true, ghlContactId: true, name: true }
        });

        if (!contact) {
            return { success: false, error: "Contact not found in database." };
        }
        if (conversation.contactId !== contact.id) {
            return { success: false, error: "Conversation/contact mismatch." };
        }
        if (!contact.phone) {
            return { success: false, error: "Contact does not have a phone number. Please add a phone number to this contact." };
        }
        if (contact.phone.includes('*')) {
            const contactName = contact.name || 'This contact';
            return {
                success: false,
                error: `${contactName}'s phone number "${contact.phone}" is masked (contains ***). You cannot send WhatsApp media to masked numbers.`
            };
        }

        const normalizedPhone = contact.phone.replace(/\D/g, '');
        if (normalizedPhone.length < 10) {
            const contactName = contact.name || 'This contact';
            return {
                success: false,
                error: `${contactName}'s phone number "${contact.phone}" appears to be missing a country code. Please update the contact with the full international number.`
            };
        }

        const enqueueResult = await enqueueWhatsAppOutbound({
            locationId: location.id,
            conversationInternalId: conversation.id,
            conversationGhlId: conversationId,
            contactId: contact.id,
            body: previewBody,
            kind: mediaKind,
            source: "app_user",
            clientMessageId: options?.clientMessageId || null,
            caption: cleanCaption || null,
            attachment: {
                objectKey,
                contentType,
                fileName,
                size,
            },
        });

        invalidateConversationReadCaches(conversationId);
        emitConversationRealtimeEvent({
            locationId: location.id,
            conversationId,
            type: "message.outbound",
            payload: {
                channel: "whatsapp",
                mode: "media",
                queued: true,
                messageId: enqueueResult.messageId,
                clientMessageId: enqueueResult.clientMessageId,
                outboxJobId: enqueueResult.outboxJobId,
                queueAccepted: enqueueResult.queueAccepted,
                dispatchMode: enqueueResult.dispatchMode,
            },
        });
        return {
            success: true as const,
            queued: true as const,
            messageId: enqueueResult.messageId,
            clientMessageId: enqueueResult.clientMessageId,
            outboxJobId: enqueueResult.outboxJobId,
            queueAccepted: enqueueResult.queueAccepted,
            dispatchMode: enqueueResult.dispatchMode,
            warning: enqueueResult.warning,
            errorCode: enqueueResult.errorCode,
        };
    } catch (err: any) {
        console.error("WhatsApp media enqueue failed:", err);
        return { success: false, error: `WhatsApp media queue failed: ${err.message || 'Unknown error'}` };
    }
}

export async function sendWhatsAppImageReply(
    conversationId: string,
    contactId: string,
    caption: string,
    upload: WhatsAppImageUploadRef
) {
    return sendWhatsAppMediaReply(conversationId, contactId, {
        ...upload,
        kind: "image",
    }, { caption, kind: "image" });
}

export async function sendReply(
    conversationId: string,
    contactId: string,
    messageBody: string,
    type: 'SMS' | 'Email' | 'WhatsApp',
    options?: {
        clientMessageId?: string;
        translationSourceText?: string | null;
        translationTargetLanguage?: string | null;
        translationDetectedSourceLanguage?: string | null;
    }
) {
    try {
        if (type === "WhatsApp") {
            const location = await getAuthenticatedLocationReadOnly({ requireGhlToken: false });
            if (!location?.evolutionInstanceId) {
                return { success: false, error: "WhatsApp (Evolution) is not connected." };
            }

            const normalizedBody = String(messageBody || "").trim();
            if (!normalizedBody) {
                return { success: false, error: "Message body cannot be empty." };
            }

            const conversation = await db.conversation.findUnique({
                where: { ghlConversationId: conversationId },
                select: { id: true, locationId: true, contactId: true },
            });
            if (!conversation || conversation.locationId !== location.id) {
                return { success: false, error: "Conversation not found." };
            }

            const contact = await db.contact.findFirst({
                where: {
                    OR: [
                        { ghlContactId: contactId },
                        { id: contactId },
                    ],
                    locationId: location.id,
                },
                select: { id: true, phone: true, name: true },
            });
            if (!contact) {
                return { success: false, error: "Contact not found in database." };
            }
            if (conversation.contactId !== contact.id) {
                return { success: false, error: "Conversation/contact mismatch." };
            }
            if (!contact.phone) {
                return { success: false, error: "Contact does not have a phone number. Please add a phone number to this contact." };
            }
            if (contact.phone.includes("*")) {
                const contactName = contact.name || "This contact";
                return {
                    success: false,
                    error: `${contactName}'s phone number "${contact.phone}" is masked (contains ***). You cannot send WhatsApp messages to masked numbers.`,
                };
            }

            const normalizedPhone = contact.phone.replace(/\D/g, "");
            if (normalizedPhone.length < 10) {
                const contactName = contact.name || "This contact";
                return {
                    success: false,
                    error: `${contactName}'s phone number "${contact.phone}" appears to be missing a country code. Please update the contact with the full international number.`,
                };
            }

            const enqueueResult = await enqueueWhatsAppOutbound({
                locationId: location.id,
                conversationInternalId: conversation.id,
                conversationGhlId: conversationId,
                contactId: contact.id,
                body: normalizedBody,
                kind: "text",
                source: "app_user",
                clientMessageId: options?.clientMessageId || null,
            });

            const translationSourceText = String(options?.translationSourceText || "").trim();
            const translationTargetLanguage = normalizeTranslationTargetLanguage(options?.translationTargetLanguage || null);
            if (translationSourceText && translationSourceText !== normalizedBody && enqueueResult?.messageId) {
                const sourceHash = buildTranslationSourceHash(translationSourceText);
                await (db as any).messageTranslationCache.create({
                    data: {
                        messageId: enqueueResult.messageId,
                        conversationId: conversation.id,
                        locationId: location.id,
                        targetLanguage: translationTargetLanguage,
                        sourceHash,
                        sourceText: translationSourceText,
                        translatedText: normalizedBody,
                        detectedSourceLanguage: normalizeReplyLanguage(options?.translationDetectedSourceLanguage || null),
                        detectionConfidence: null,
                        status: MESSAGE_TRANSLATION_STATUS.completed,
                        provider: "manual_send_preview",
                        model: "manual_send_preview",
                    },
                }).catch((error: any) => {
                    console.warn("[sendReply] Failed to persist WhatsApp outbound translation cache:", error?.message || error);
                });
            }

            invalidateConversationReadCaches(conversationId);
            emitConversationRealtimeEvent({
                locationId: location.id,
                conversationId,
                type: "message.outbound",
                payload: {
                    channel: "whatsapp",
                    mode: "text",
                    queued: true,
                    messageId: enqueueResult.messageId,
                    clientMessageId: enqueueResult.clientMessageId,
                    outboxJobId: enqueueResult.outboxJobId,
                    queueAccepted: enqueueResult.queueAccepted,
                    dispatchMode: enqueueResult.dispatchMode,
                },
            });

            return {
                success: true as const,
                queued: true as const,
                messageId: enqueueResult.messageId,
                clientMessageId: enqueueResult.clientMessageId,
                outboxJobId: enqueueResult.outboxJobId,
                queueAccepted: enqueueResult.queueAccepted,
                dispatchMode: enqueueResult.dispatchMode,
                warning: enqueueResult.warning,
                errorCode: enqueueResult.errorCode,
            };
        }

        const location = await getAuthenticatedLocation();
        if (!location?.ghlAccessToken) {
            throw new Error("Unauthorized");
        }

        if (type === "SMS") {
            const contact = await db.contact.findFirst({
                where: {
                    OR: [
                        { ghlContactId: contactId },
                        { id: contactId }
                    ],
                    locationId: location.id
                },
                select: { name: true, phone: true }
            });

            if (!contact) {
                return { success: false, error: "Contact not found in database." };
            }

            const smsEligibility = await checkSmsPhoneEligibility(
                {
                    id: location.id,
                    ghlAccessToken: location.ghlAccessToken,
                    ghlLocationId: location.ghlLocationId,
                },
                contact.phone,
                {
                    contactName: contact.name,
                }
            );

            if (smsEligibility.status === "ineligible") {
                return { success: false, error: smsEligibility.reason || "SMS is not configured for this location." };
            }
        }

        const payload: any = {
            contactId,
            type,
        };

        if (type === "Email") {
            payload.html = messageBody.replace(/\n/g, "<br/>");
            payload.subject = "Re: Your Inquiry";
            const locationEmail = (location as any).email || (location as any).ghlEmail;
            const locationName = location.name || location.domain;
            if (locationEmail) payload.emailFrom = locationEmail;
            if (locationName) payload.emailFromName = locationName;
        } else {
            payload.message = messageBody;
        }

        const res = await sendMessage(location.ghlAccessToken, payload);

        if (res?.messageId) {
            const messageId = res.messageId;
            const msgData = {
                messageId,
                ghlMessageId: messageId,
                id: messageId,
                conversationId,
                contactId,
                body: type === "Email" ? payload.html : payload.message,
                type: type === "Email" ? "TYPE_EMAIL" : "TYPE_SMS",
                direction: "outbound",
                status: "sent",
                dateAdded: new Date(),
                locationId: location.ghlLocationId,
            };
            await syncMessageFromWebhook(msgData);

            const translationSourceText = String(options?.translationSourceText || "").trim();
            const translationTargetLanguage = normalizeTranslationTargetLanguage(options?.translationTargetLanguage || null);
            if (translationSourceText && translationSourceText !== messageBody) {
                const localConversation = await db.conversation.findFirst({
                    where: {
                        ghlConversationId: conversationId,
                        locationId: location.id,
                    },
                    select: { id: true },
                });
                if (localConversation) {
                    const localMessage = await db.message.findFirst({
                        where: {
                            conversationId: localConversation.id,
                            OR: [
                                { ghlMessageId: messageId },
                                { id: messageId },
                            ],
                        },
                        select: { id: true },
                    });

                    if (localMessage?.id) {
                        const sourceHash = buildTranslationSourceHash(translationSourceText);
                        await (db as any).messageTranslationCache.create({
                            data: {
                                messageId: localMessage.id,
                                conversationId: localConversation.id,
                                locationId: location.id,
                                targetLanguage: translationTargetLanguage,
                                sourceHash,
                                sourceText: translationSourceText,
                                translatedText: messageBody,
                                detectedSourceLanguage: normalizeReplyLanguage(options?.translationDetectedSourceLanguage || null),
                                detectionConfidence: null,
                                status: MESSAGE_TRANSLATION_STATUS.completed,
                                provider: "manual_send_preview",
                                model: "manual_send_preview",
                            },
                        }).catch((error: any) => {
                            console.warn("[sendReply] Failed to persist outbound translation cache:", error?.message || error);
                        });
                    }
                }
            }
        }

        invalidateConversationReadCaches(conversationId);
        emitConversationRealtimeEvent({
            locationId: location.id,
            conversationId,
            type: "message.outbound",
            payload: { channel: type.toLowerCase() },
        });
        return { success: true as const };
    } catch (error) {
        console.error("sendMessage error:", error);
        return { success: false as const, error };
    }
}

type GenerateAIDraftOptions = {
    mode?: "chat" | "deal";
    dealId?: string;
    replyLanguage?: string | null;
};

export async function generateAIDraft(
    conversationId: string,
    contactId: string,
    instruction?: string,
    model?: string,
    options?: GenerateAIDraftOptions
) {
    const location = await getAuthenticatedLocation();
    if (!location?.ghlAccessToken) {
        throw new Error("Unauthorized");
    }

    if (!location.ghlLocationId) {
        throw new Error("Misconfigured: Location has no GHL Location ID");
    }

    const explicitModel = typeof model === "string" && model.trim() ? model.trim() : undefined;

    // [JIT Sync] Ensure contact exists locally before asking AI
    // Resolve GHL ID if possible, otherwise rely on local data
    const existingContact = await db.contact.findFirst({
        where: { OR: [{ id: contactId }, { ghlContactId: contactId }], locationId: location.id },
        select: { ghlContactId: true }
    });

    if (existingContact?.ghlContactId) {
        await ensureLocalContactSynced(existingContact.ghlContactId, location.id, location.ghlAccessToken);
    } else if (!existingContact) {
        // Assume it's a GHL ID and try to sync
        await ensureLocalContactSynced(contactId, location.id, location.ghlAccessToken);
    }

    // Resolve current agent display name (DB-first; no extra Clerk API calls).
    const { userId } = await auth();
    let agentName: string | undefined;
    if (userId) {
        const agentUser = await db.user.findUnique({
            where: { clerkId: userId },
            select: { name: true, firstName: true, lastName: true, email: true }
        });
        if (agentUser) {
            const fullName = [agentUser.firstName, agentUser.lastName].filter(Boolean).join(" ").trim();
            agentName = agentUser.name || fullName || agentUser.email || undefined;
        }
    }

    const conversationRecord = await db.conversation.findFirst({
        where: {
            locationId: location.id,
            OR: [{ id: conversationId }, { ghlConversationId: conversationId }],
        },
        select: {
            id: true,
            contactId: true,
        },
    });
    const contactRecord = await db.contact.findFirst({
        where: {
            locationId: location.id,
            OR: [{ id: contactId }, { ghlContactId: contactId }],
        },
        select: { id: true },
    });

    if (conversationRecord?.id && contactRecord?.id) {
        try {
            const runtimeResult = await runAiSkillDecision({
                locationId: location.id,
                conversationId: conversationRecord.id,
                contactId: contactRecord.id,
                source: "manual",
                contextSummary: [
                    `Mode: ${options?.mode || "chat"}`,
                    options?.dealId ? `Deal: ${options.dealId}` : null,
                ].filter(Boolean).join("\n"),
                extraInstruction: instruction || "Draft the best next response based on current conversation context.",
                executeImmediately: true,
            });

            if (runtimeResult.success && runtimeResult.draftBody) {
                return {
                    draft: runtimeResult.draftBody,
                    reasoning: `Generated via unified skill runtime (${runtimeResult.selectedSkillId || "skill"}).`,
                    requiresHumanApproval: true,
                    traceId: runtimeResult.traceId || null,
                };
            }
        } catch (skillError: any) {
            console.warn("[generateAIDraft] Skill runtime failed, falling back to legacy generateDraft:", skillError?.message || skillError);
        }
    }

    // Use internal location.id (for SiteConfig lookup), not ghlLocationId (external GHL ID)
    const result = await generateDraft({
        conversationId,
        contactId,
        locationId: location.id, // CRITICAL: SiteConfig uses internal Location.id
        accessToken: location.ghlAccessToken,
        agentName,
        businessName: location.name || undefined,
        instruction,
        model: explicitModel,
        mode: options?.mode || "chat",
        dealId: options?.dealId || undefined,
        replyLanguageOverride: options?.replyLanguage,
    });

    return result;
}

export async function setConversationReplyLanguageOverride(
    conversationId: string,
    replyLanguage: string | null
) {
    const location = await getAuthenticatedLocationReadOnly({ requireGhlToken: false });
    const trimmedConversationId = String(conversationId || "").trim();

    if (!trimmedConversationId) {
        return { success: false as const, error: "Missing conversation ID." };
    }

    const rawReplyLanguage = String(replyLanguage || "").trim();
    const normalizedReplyLanguage = normalizeReplyLanguage(rawReplyLanguage);
    if (rawReplyLanguage && rawReplyLanguage.toLowerCase() !== "auto" && !normalizedReplyLanguage) {
        return { success: false as const, error: "Invalid language code." };
    }
    const conversation = await db.conversation.findFirst({
        where: {
            locationId: location.id,
            OR: [
                { id: trimmedConversationId },
                { ghlConversationId: trimmedConversationId },
            ],
        },
        select: { id: true, ghlConversationId: true },
    });

    if (!conversation) {
        return { success: false as const, error: "Conversation not found." };
    }

    await db.conversation.update({
        where: { id: conversation.id },
        data: { replyLanguageOverride: normalizedReplyLanguage },
    });

    invalidateConversationReadCaches(conversation.ghlConversationId);
    emitConversationRealtimeEvent({
        locationId: location.id,
        conversationId: conversation.ghlConversationId,
        type: "conversation.reply_language_override.updated",
        payload: { replyLanguageOverride: normalizedReplyLanguage },
    });

    return {
        success: true as const,
        conversationId: conversation.ghlConversationId,
        replyLanguageOverride: normalizedReplyLanguage,
    };
}

export async function previewTranslatedReply(
    conversationId: string,
    sourceText: string,
    channel: "SMS" | "Email" | "WhatsApp",
    targetLanguage?: string | null
) {
    const location = await getAuthenticatedLocationReadOnly({ requireGhlToken: false });
    const trimmedConversationId = String(conversationId || "").trim();
    const normalizedSourceText = String(sourceText || "").trim();
    const normalizedChannel = String(channel || "").trim() || "SMS";

    if (!trimmedConversationId) {
        return { success: false as const, error: "Missing conversation ID." };
    }
    if (!normalizedSourceText) {
        return { success: false as const, error: "Source text is empty." };
    }

    const conversation = await db.conversation.findFirst({
        where: {
            locationId: location.id,
            OR: [
                { id: trimmedConversationId },
                { ghlConversationId: trimmedConversationId },
            ],
        },
        include: {
            contact: {
                select: { preferredLang: true },
            },
        },
    });
    if (!conversation) {
        return { success: false as const, error: "Conversation not found." };
    }

    const resolvedTargetLanguage = normalizeTranslationTargetLanguage(
        targetLanguage || conversation.replyLanguageOverride || await getLocationDefaultReplyLanguage(location.id, DEFAULT_TRANSLATION_TARGET_LANGUAGE)
    );
    const sourceHash = buildTranslationSourceHash(normalizedSourceText);

    try {
        const translation = await runMessageTranslationLLM({
            sourceText: normalizedSourceText,
            targetLanguage: resolvedTargetLanguage,
        });

        return {
            success: true as const,
            channel: normalizedChannel,
            targetLanguage: resolvedTargetLanguage,
            sourceText: normalizedSourceText,
            sourceHash,
            translatedText: translation.translatedText,
            detectedSourceLanguage: translation.detectedSourceLanguage,
            detectionConfidence: translation.confidence,
            provider: translation.provider,
            model: translation.model,
        };
    } catch (error: any) {
        return {
            success: false as const,
            error: String(error?.message || "Failed to generate translation preview."),
            targetLanguage: resolvedTargetLanguage,
        };
    }
}

export async function translateConversationMessage(
    messageId: string,
    targetLanguage?: string | null
) {
    const location = await getAuthenticatedLocationReadOnly({ requireGhlToken: false });
    const trimmedMessageId = String(messageId || "").trim();
    if (!trimmedMessageId) {
        return { success: false as const, error: "Missing message ID." };
    }

    const message = await db.message.findFirst({
        where: {
            id: trimmedMessageId,
            conversation: { locationId: location.id },
        },
        include: {
            conversation: {
                include: {
                    contact: {
                        select: { preferredLang: true },
                    },
                },
            },
        },
    });
    if (!message) {
        return { success: false as const, error: "Message not found." };
    }

    const sourceRaw = String(message.body || "").trim();
    const sourceText = String(message.type || "").toUpperCase().includes("EMAIL")
        ? stripHtmlToText(sourceRaw)
        : sourceRaw;
    if (!sourceText) {
        return { success: false as const, error: "Message has no translatable text." };
    }

    const resolvedTargetLanguage = normalizeTranslationTargetLanguage(
        targetLanguage || message.conversation.replyLanguageOverride || await getLocationDefaultReplyLanguage(location.id, DEFAULT_TRANSLATION_TARGET_LANGUAGE)
    );
    const sourceHash = buildTranslationSourceHash(sourceText);

    const existing = await (db as any).messageTranslationCache.findFirst({
        where: {
            messageId: message.id,
            targetLanguage: resolvedTargetLanguage,
            sourceHash,
            status: MESSAGE_TRANSLATION_STATUS.completed,
        },
        orderBy: [{ updatedAt: "desc" }],
    });
    if (existing) {
        return {
            success: true as const,
            conversationId: message.conversation.ghlConversationId,
            messageId: message.id,
            translation: {
                id: existing.id,
                targetLanguage: existing.targetLanguage,
                sourceLanguage: existing.detectedSourceLanguage || null,
                sourceText: existing.sourceText || sourceText,
                translatedText: existing.translatedText || "",
                status: MESSAGE_TRANSLATION_STATUS.completed,
                provider: existing.provider || null,
                model: existing.model || null,
                updatedAt: existing.updatedAt ? new Date(existing.updatedAt).toISOString() : null,
            },
            cached: true as const,
        };
    }

    try {
        const translation = await runMessageTranslationLLM({
            sourceText,
            targetLanguage: resolvedTargetLanguage,
        });

        const stored = await (db as any).messageTranslationCache.create({
            data: {
                messageId: message.id,
                conversationId: message.conversationId,
                locationId: location.id,
                targetLanguage: resolvedTargetLanguage,
                sourceHash,
                sourceText,
                translatedText: translation.translatedText,
                detectedSourceLanguage: translation.detectedSourceLanguage,
                detectionConfidence: translation.confidence,
                status: MESSAGE_TRANSLATION_STATUS.completed,
                provider: translation.provider,
                model: translation.model,
            },
        });

        invalidateConversationReadCaches(message.conversation.ghlConversationId);
        emitConversationRealtimeEvent({
            locationId: location.id,
            conversationId: message.conversation.ghlConversationId,
            type: "conversation.message_translation.created",
            payload: {
                messageId: message.id,
                targetLanguage: resolvedTargetLanguage,
                cacheId: stored.id,
            },
        });

        return {
            success: true as const,
            conversationId: message.conversation.ghlConversationId,
            messageId: message.id,
            translation: {
                id: stored.id,
                targetLanguage: stored.targetLanguage,
                sourceLanguage: stored.detectedSourceLanguage || null,
                sourceText: stored.sourceText || sourceText,
                translatedText: stored.translatedText || "",
                status: MESSAGE_TRANSLATION_STATUS.completed,
                provider: stored.provider || null,
                model: stored.model || null,
                updatedAt: stored.updatedAt ? new Date(stored.updatedAt).toISOString() : null,
            },
            cached: false as const,
        };
    } catch (error: any) {
        const messageText = String(error?.message || "Translation failed.");
        await (db as any).messageTranslationCache.create({
            data: {
                messageId: message.id,
                conversationId: message.conversationId,
                locationId: location.id,
                targetLanguage: resolvedTargetLanguage,
                sourceHash,
                sourceText,
                translatedText: "",
                detectedSourceLanguage: null,
                detectionConfidence: null,
                status: MESSAGE_TRANSLATION_STATUS.failed,
                provider: "google",
                model: getModelForTask("simple_generation"),
                error: messageText,
            },
        }).catch(() => null);
        return {
            success: false as const,
            error: messageText,
            messageId: message.id,
            conversationId: message.conversation.ghlConversationId,
        };
    }
}

export async function translateConversationThread(
    conversationId: string,
    targetLanguage?: string | null,
    visibleMessageIds?: string[] | null
) {
    const location = await getAuthenticatedLocationReadOnly({ requireGhlToken: false });
    const trimmedConversationId = String(conversationId || "").trim();
    if (!trimmedConversationId) {
        return { success: false as const, error: "Missing conversation ID." };
    }

    const conversation = await db.conversation.findFirst({
        where: {
            locationId: location.id,
            OR: [
                { id: trimmedConversationId },
                { ghlConversationId: trimmedConversationId },
            ],
        },
        include: {
            contact: { select: { preferredLang: true } },
        },
    });
    if (!conversation) {
        return { success: false as const, error: "Conversation not found." };
    }

    const normalizedIds = Array.isArray(visibleMessageIds)
        ? visibleMessageIds.map((id) => String(id || "").trim()).filter(Boolean)
        : [];
    const resolvedTargetLanguage = normalizeTranslationTargetLanguage(
        targetLanguage || conversation.replyLanguageOverride || await getLocationDefaultReplyLanguage(location.id, DEFAULT_TRANSLATION_TARGET_LANGUAGE)
    );

    const rows = await db.message.findMany({
        where: {
            conversationId: conversation.id,
            direction: "inbound",
            body: { not: null },
            ...(normalizedIds.length > 0 ? { id: { in: normalizedIds } } : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: normalizedIds.length > 0 ? Math.min(normalizedIds.length, 250) : 120,
        select: {
            id: true,
        },
    });

    let translatedCount = 0;
    let cachedCount = 0;
    const failed: Array<{ messageId: string; error: string }> = [];

    for (const row of rows) {
        const result = await translateConversationMessage(row.id, resolvedTargetLanguage);
        if (result?.success) {
            translatedCount += 1;
            if ((result as any).cached) cachedCount += 1;
        } else {
            failed.push({
                messageId: row.id,
                error: String((result as any)?.error || "Translation failed"),
            });
        }
    }

    emitConversationRealtimeEvent({
        locationId: location.id,
        conversationId: conversation.ghlConversationId,
        type: "conversation.thread_translation.created",
        payload: {
            targetLanguage: resolvedTargetLanguage,
            translatedCount,
            cachedCount,
            failedCount: failed.length,
        },
    });

    return {
        success: true as const,
        conversationId: conversation.ghlConversationId,
        targetLanguage: resolvedTargetLanguage,
        translatedCount,
        cachedCount,
        failedCount: failed.length,
        failed,
    };
}

export async function orchestrateAction(conversationId: string, contactId: string, dealStage?: string) {
    const location = await getAuthenticatedLocationReadOnly({ requireGhlToken: false });
    const requestedConversationId = String(conversationId || "").trim();

    if (!requestedConversationId) {
        throw new Error("Conversation ID is required.");
    }

    // Resolve real conversation DB ID (AgentExecution FK requires Conversation.id, not ghlConversationId)
    const conversation = await db.conversation.findFirst({
        where: {
            locationId: location.id,
            OR: [
                { id: requestedConversationId },
                { ghlConversationId: requestedConversationId },
            ],
        },
        select: {
            id: true,
            contactId: true,
            ghlConversationId: true,
            lastMessageType: true,
            createdAt: true,
            contact: {
                select: {
                    id: true,
                    message: true,
                    name: true,
                },
            },
        },
    });

    if (!conversation) {
        throw new Error(`Conversation not found for ID: ${requestedConversationId}`);
    }

    // Canonicalize contact ID to local DB Contact.id.
    let resolvedContactId = conversation.contactId;
    const requestedContactId = String(contactId || "").trim();
    if (requestedContactId && requestedContactId !== conversation.contactId) {
        const mapped = await db.contact.findFirst({
            where: {
                locationId: location.id,
                OR: [{ id: requestedContactId }, { ghlContactId: requestedContactId }],
            },
            select: { id: true },
        });
        if (mapped?.id) resolvedContactId = mapped.id;
    }

    // Heal empty shell conversations created from Contacts by seeding the lead inquiry text.
    const seedResult = await seedConversationFromContactLeadText({
        conversationId: conversation.id,
        contact: conversation.contact,
        messageType: conversation.lastMessageType || "TYPE_SMS",
        messageDate: conversation.createdAt,
        source: "contact_bootstrap",
    });
    if (seedResult.seeded) {
        console.log(`[ORCHESTRATE_ACTION] Seeded conversation ${requestedConversationId} from contact.message before runtime decision.`);
    }

    const messages = await db.message.findMany({
        where: {
            conversationId: conversation.id,
            direction: { in: ["inbound", "outbound"] },
        },
        orderBy: { createdAt: "asc" },
        take: 40,
    });

    let latestMessage = "";
    let historyForOrchestration = "";
    let bootstrapMode: "none" | "empty_thread" = "none";

    if (messages.length === 0) {
        bootstrapMode = "empty_thread";
        latestMessage = "I am interested in a property and would like more information. This is our first contact.";
    } else {
        const lastMessage = messages[messages.length - 1];
        latestMessage = (lastMessage.body || "").trim();
        if (!latestMessage) {
            latestMessage = `[${lastMessage.direction} ${lastMessage.type || "message"} with no text body]`;
        }
        historyForOrchestration = messages
            .map((message) => {
                const speaker = message.direction === "inbound" ? "User" : "Agent";
                const body = (message.body || "").trim() || `[${message.type || "message"} with no text body]`;
                return `${speaker}: ${body}`;
            })
            .join("\n");
    }

    const contextSummary = [
        "Mission action: orchestrate",
        dealStage ? `Deal stage: ${dealStage}` : null,
        bootstrapMode !== "none" ? `Bootstrap mode: ${bootstrapMode}` : null,
        `Latest message: ${latestMessage}`,
    ]
        .filter(Boolean)
        .join("\n");

    const runtimeResult = await runAiSkillDecision({
        locationId: location.id,
        conversationId: conversation.id,
        contactId: resolvedContactId,
        source: "mission",
        contextSummary,
        extraInstruction: historyForOrchestration
            ? `Use the full mission conversation history below when deciding the best next step.\n\n${historyForOrchestration}`
            : "Generate the first mission-safe outreach for this conversation context.",
        executeImmediately: true,
    });

    const holdReason = runtimeResult.holdReason || null;
    const suggestionQueued = Boolean(runtimeResult.draftBody);
    const success = Boolean(runtimeResult.success);

    let reasoning = "";
    if (!success) {
        reasoning = runtimeResult.error || "Mission runtime decision failed.";
    } else if (holdReason) {
        reasoning = `Decision held by policy: ${holdReason}.`;
    } else if (suggestionQueued) {
        reasoning = `Queued suggested response via skill "${runtimeResult.selectedSkillId || "unknown"}".`;
    } else {
        reasoning = "Decision executed without draft output.";
    }

    return {
        success,
        traceId: runtimeResult.traceId || null,
        intent: runtimeResult.objective || "mission",
        sentiment: null,
        skillUsed: runtimeResult.selectedSkillId || null,
        actions: [] as any[],
        draftReply: null,
        requiresHumanApproval: true,
        reasoning,
        policyResult: {
            approved: success && !holdReason,
            reviewRequired: true,
            reason: holdReason ? `Held: ${holdReason}` : reasoning,
        },
        decisionId: runtimeResult.decisionId || null,
        selectedSkillId: runtimeResult.selectedSkillId || null,
        objective: runtimeResult.objective || null,
        score: typeof runtimeResult.score === "number" ? runtimeResult.score : null,
        holdReason,
        suggestionQueued,
        bootstrapMode,
    };
}

export async function createDealContext(title: string, conversationIds: string[]) {
    const location = await getAuthenticatedLocation();
    const accessToken = location.ghlAccessToken!;

    // Auto-detect properties from the contacts involved
    let propertyIds: string[] = [];
    try {
        // [JIT Sync] & Fetch Details
        // We sync ALL contacts in the deal to ensure we have their full data
        const conversations = await Promise.all(
            conversationIds.map(id => getConversation(accessToken, id))
        );

        const ghlContactIds = conversations
            .map(c => c.conversation?.contactId)
            .filter(Boolean) as string[];

        // Run Sync in Parallel
        await Promise.all(
            ghlContactIds.map(cid => ensureLocalContactSynced(cid, location.id, accessToken))
        );

        // 2. Find local Contacts and their Property Roles
        if (ghlContactIds.length > 0) {
            const contacts = await db.contact.findMany({
                where: {
                    ghlContactId: { in: ghlContactIds },
                    locationId: location.id
                },
                include: {
                    propertyRoles: {
                        select: { propertyId: true }
                    }
                }
            });

            // 3. Extract unique Property IDs
            const allPropIds = contacts.flatMap((c: any) => c.propertyRoles.map((r: any) => r.propertyId));
            propertyIds = Array.from(new Set(allPropIds));
        }
    } catch (e) {
        console.warn("Failed to auto-detect properties for Deal Context", e);
        // non-fatal, proceed with empty properties
    }

    // Create the DB record
    const dealContext = await db.dealContext.create({
        data: {
            title,
            locationId: location.id,
            conversationIds,
            propertyIds, // Auto-populated
            stage: 'ACTIVE'
        }
    });

    return dealContext;
}

// ... existing code ...

export async function generateMultiContextDraftAction(dealContextId: string, targetAudience: 'LEAD' | 'OWNER') {
    const location = await getAuthenticatedLocation();

    if (!location.ghlAccessToken) throw new Error("Unauthorized");

    return generateMultiContextDraft({
        dealContextId,
        targetAudience,
        accessToken: location.ghlAccessToken
    });
}

export async function getContactContext(contactId: string, options?: { refreshExternal?: boolean }) {
    const refreshExternal = !!options?.refreshExternal;
    const location = refreshExternal
        ? await getAuthenticatedLocationExternal()
        : await getAuthenticatedLocationReadOnly();

    if (!contactId || contactId === 'unknown') return null;

    // 1. Try to resolve locally first (as ID or GHL ID)
    let contact = await db.contact.findFirst({
        where: {
            OR: [
                { id: contactId },
                { ghlContactId: contactId }
            ],
            locationId: location.id
        },
        include: getContactContextInclude()
    });

    // Optional external refresh when explicitly requested.
    if (refreshExternal && contact && contact.ghlContactId && location.ghlAccessToken) {
        try {
            await ensureLocalContactSynced(contact.ghlContactId, location.id, location.ghlAccessToken!);
        } catch (e) {
            console.warn("[getContactContext] JIT Sync refresh failed, returning local data:", e);
        }
    }

    // 3. If NOT found locally, assume it's a GHL ID and try to import it
    if (!contact && refreshExternal && location.ghlAccessToken) {
        try {
            const synced = await ensureLocalContactSynced(contactId, location.id, location.ghlAccessToken!);
            if (synced) {
                // Re-fetch with full includes
                contact = await db.contact.findUnique({
                    where: { id: synced.id },
                    include: getContactContextInclude()
                });
            }
        } catch (e) {
            console.error("[getContactContext] Failed to resolve contact from GHL ID:", e);
        }
    }

    // Fetch Lead Sources for the Edit Form
    const leadSources = await db.leadSource.findMany({
        where: { locationId: location.id, isActive: true },
        select: { name: true },
        orderBy: { name: 'asc' }
    });


    const hydratedContact = await enrichContactContextContact(contact, location.id);

    return {
        contact: hydratedContact,
        leadSources: leadSources.map((s: any) => s.name)
    };
}

// Helper to get location without strict GHL requirement
async function getBasicLocationContext() {
    const location = await getLocationContext();
    if (!location) {
        throw new Error("Unauthorized");
    }
    return location;
}

export async function getEmailSyncProvidersStatus() {
    try {
        const { userId: clerkUserId } = await auth();
        if (!clerkUserId) {
            return { providers: [] as any[] };
        }

        const user = await db.user.findUnique({
            where: { clerkId: clerkUserId },
            select: {
                googleAccessToken: true,
                googleRefreshToken: true,
                googleSyncEnabled: true,
                gmailSyncState: {
                    select: {
                        emailAddress: true,
                        lastSyncedAt: true,
                        watchExpiration: true
                    }
                },
                outlookAuthMethod: true,
                outlookEmail: true,
                outlookAccessToken: true,
                outlookRefreshToken: true,
                outlookSyncEnabled: true,
                outlookSessionCookies: true,
                outlookPasswordEncrypted: true,
                outlookSessionExpiry: true,
                outlookSubscriptionExpiry: true,
                outlookSyncState: {
                    select: {
                        emailAddress: true,
                        lastSyncedAt: true
                    }
                }
            }
        });

        if (!user) {
            return { providers: [] as any[] };
        }

        const now = Date.now();
        const minutesAgo = (value?: Date | null) =>
            value ? Math.floor((now - value.getTime()) / 60000) : null;

        const gmailConnected = !!(
            user.googleSyncEnabled &&
            (user.googleAccessToken || user.googleRefreshToken)
        );
        const gmailConfigured = !!(
            user.googleAccessToken ||
            user.googleRefreshToken ||
            user.googleSyncEnabled ||
            user.gmailSyncState
        );
        const gmailLastSync = user.gmailSyncState?.lastSyncedAt ?? null;
        const gmailWatchExpiry = user.gmailSyncState?.watchExpiration ?? null;
        const gmailWatchExpired = !!(gmailWatchExpiry && gmailWatchExpiry.getTime() < now);
        const gmailAgeMins = minutesAgo(gmailLastSync);

        let gmailHealth: 'healthy' | 'warning' | 'stale' | 'error' = 'warning';
        if (gmailConnected) {
            if (!gmailLastSync) gmailHealth = 'warning';
            else if ((gmailAgeMins ?? 9999) > 120) gmailHealth = 'stale';
            else gmailHealth = 'healthy';

            if (gmailWatchExpired && gmailHealth === 'healthy') {
                gmailHealth = 'warning';
            }
        } else {
            gmailHealth = 'error';
        }

        const inferredOutlookMethod =
            (user.outlookAuthMethod as 'oauth' | 'puppeteer' | null)
            || (user.outlookSessionCookies ? 'puppeteer' : null)
            || ((user.outlookAccessToken || user.outlookRefreshToken) ? 'oauth' : null);
        const outlookConfigured = !!(
            user.outlookSyncEnabled ||
            user.outlookSessionCookies ||
            user.outlookAccessToken ||
            user.outlookRefreshToken ||
            user.outlookAuthMethod
        );
        const outlookCanAutoReconnect = inferredOutlookMethod === 'puppeteer' && !!user.outlookPasswordEncrypted;

        const outlookSessionExpired = inferredOutlookMethod === 'puppeteer'
            ? (user.outlookSessionExpiry ? user.outlookSessionExpiry.getTime() < now : true)
            : false;
        const outlookSubscriptionExpired = inferredOutlookMethod === 'oauth'
            ? !!(user.outlookSubscriptionExpiry && user.outlookSubscriptionExpiry.getTime() < now)
            : false;

        const outlookConnected = !!(
            user.outlookSyncEnabled &&
            (
                (inferredOutlookMethod === 'puppeteer' && user.outlookSessionCookies && !outlookSessionExpired) ||
                (inferredOutlookMethod === 'oauth' && (user.outlookAccessToken || user.outlookRefreshToken))
            )
        );

        const outlookLastSync = user.outlookSyncState?.lastSyncedAt ?? null;
        const outlookAgeMins = minutesAgo(outlookLastSync);

        let outlookHealth: 'healthy' | 'warning' | 'stale' | 'error' = 'warning';
        if (outlookConnected) {
            if (!outlookLastSync) outlookHealth = 'warning';
            else if ((outlookAgeMins ?? 9999) > 180) outlookHealth = 'stale';
            else outlookHealth = 'healthy';

            if ((outlookSessionExpired || outlookSubscriptionExpired) && outlookHealth === 'healthy') {
                outlookHealth = 'warning';
            }
        } else {
            outlookHealth = (outlookSessionExpired || outlookSubscriptionExpired) ? 'error' : 'error';
        }

        const providers = [
            {
                provider: 'gmail' as const,
                configured: gmailConfigured,
                connected: gmailConnected,
                health: gmailHealth,
                email: user.gmailSyncState?.emailAddress || null,
                lastSyncedAt: gmailLastSync?.toISOString() || null,
                expectedCadenceMinutes: 5,
                watchExpiration: gmailWatchExpiry?.toISOString() || null,
                watchExpired: gmailWatchExpired,
                settingsPath: '/admin/settings/integrations/google'
            },
            {
                provider: 'outlook' as const,
                configured: outlookConfigured,
                connected: outlookConnected,
                health: outlookHealth,
                method: inferredOutlookMethod,
                email: user.outlookEmail || user.outlookSyncState?.emailAddress || null,
                // This timestamp is treated as email sync freshness; contact sync no longer updates it.
                lastSyncedAt: outlookLastSync?.toISOString() || null,
                expectedCadenceMinutes: inferredOutlookMethod === 'puppeteer' ? 15 : 5,
                sessionExpiry: user.outlookSessionExpiry?.toISOString() || null,
                sessionExpired: outlookSessionExpired,
                canAutoReconnect: outlookCanAutoReconnect,
                subscriptionExpiry: user.outlookSubscriptionExpiry?.toISOString() || null,
                subscriptionExpired: outlookSubscriptionExpired,
                settingsPath: '/admin/settings/integrations/microsoft'
            }
        ];

        return { providers };
    } catch (error) {
        console.error('[getEmailSyncProvidersStatus] Error:', error);
        return { providers: [] as any[] };
    }
}

export async function getAvailableAiModelsAction() {
    const location = await getBasicLocationContext();
    const { getAvailableModels } = await import("@/lib/ai/fetch-models");
    return getAvailableModels(location.id);
}

export async function getAiDraftModelPickerStateAction() {
    const location = await getBasicLocationContext();
    const { getAiDraftModelPickerState } = await import("@/lib/ai/fetch-models");
    return getAiDraftModelPickerState(location.id);
}

export async function getAiModelPickerDefaultsAction() {
    const location = await getBasicLocationContext();
    const { getAiModelPickerDefaults } = await import("@/lib/ai/fetch-models");
    return getAiModelPickerDefaults(location.id);
}

export async function getPropertyImageEnhancementModelCatalogAction() {
    const location = await getBasicLocationContext();
    const { getPropertyImageEnhancementModelCatalog } = await import("@/lib/ai/fetch-models");
    return getPropertyImageEnhancementModelCatalog(location.id);
}

export async function getSmsChannelEligibility(conversationId: string) {
    try {
        const location = await getBasicLocationContext();

        const conversation = await db.conversation.findFirst({
            where: {
                ghlConversationId: conversationId,
                locationId: location.id,
            },
            select: {
                contact: {
                    select: {
                        name: true,
                        phone: true,
                    }
                }
            }
        });

        if (!conversation?.contact) {
            return {
                success: false,
                eligible: null as boolean | null,
                status: 'unknown' as const,
                reason: 'Conversation contact not found.',
            };
        }

        const contact = conversation.contact;
        const eligibility = await checkSmsPhoneEligibility(
            {
                id: location.id,
                ghlAccessToken: location.ghlAccessToken,
                ghlLocationId: location.ghlLocationId,
            },
            contact.phone,
            {
                contactName: contact.name,
            }
        );

        return {
            success: true,
            eligible: eligibility.status === 'eligible' ? true : eligibility.status === 'ineligible' ? false : null,
            status: eligibility.status,
            reason: eligibility.reason,
            phone: contact.phone || null,
        };
    } catch (error: any) {
        console.error('[getSmsChannelEligibility] Error:', error);
        return {
            success: false,
            eligible: null as boolean | null,
            status: 'unknown' as const,
            reason: error?.message || 'Failed to check SMS eligibility.',
        };
    }
}

export async function getWhatsAppChannelEligibility(conversationId: string) {
    try {
        const location = await getBasicLocationContext();

        const conversation = await db.conversation.findFirst({
            where: {
                ghlConversationId: conversationId,
                locationId: location.id,
            },
            select: {
                contact: {
                    select: {
                        name: true,
                        phone: true,
                        contactType: true,
                    }
                }
            }
        });

        if (!conversation?.contact) {
            return {
                success: false,
                eligible: null as boolean | null,
                status: 'unknown' as const,
                reason: 'Conversation contact not found.',
            };
        }

        const contact = conversation.contact;
        const eligibility = await checkWhatsAppPhoneEligibility(
            {
                evolutionInstanceId: location.evolutionInstanceId,
            },
            contact.phone,
            {
                contactName: contact.name,
                contactType: contact.contactType,
                verifyServiceHealth: true,
            }
        );

        return {
            success: true,
            eligible: eligibility.status === 'eligible' ? true : eligibility.status === 'ineligible' ? false : null,
            status: eligibility.status,
            reason: eligibility.reason,
            phone: contact.phone || null,
        };
    } catch (error: any) {
        console.error('[getWhatsAppChannelEligibility] Error:', error);
        return {
            success: false,
            eligible: null as boolean | null,
            status: 'unknown' as const,
            reason: error?.message || 'Failed to check WhatsApp eligibility.',
        };
    }
}

export async function getEvolutionStatus() {
    const traceId = createTraceId();
    try {
        // Relaxed Auth: Don't require GHL token just to check WhatsApp status
        const location = await getBasicLocationContext();
        const instanceName = location.id;
        const { evolutionClient } = await import("@/lib/evolution/client");
        let instance = await withServerTiming("conversations.evolution_status", {
            traceId,
            locationId: location.id,
            instanceName,
            step: "fetch_instance",
        }, async () => withResilience({
            breakerKey: `evolution:status:${instanceName}`,
            timeoutMs: 8_000,
            timeoutMessage: "Evolution status check timed out",
            retry: { attempts: 2, baseDelayMs: 250, maxDelayMs: 1500 },
            task: async () => evolutionClient.fetchInstance(instanceName),
        }));

        // Auto-Revival Logic:
        // If Evolution API restarted, it might forget the instance handle but keep the session on disk.
        // If we get NOT_FOUND, we try to "revive" it by calling createInstance.
        if (!instance) {
            console.log(`Instance ${instanceName} not found. Attempting to revive...`);
            try {
                const reviveRes = await withResilience({
                    breakerKey: `evolution:revive:${instanceName}`,
                    timeoutMs: 12_000,
                    timeoutMessage: "Evolution instance revive timed out",
                    retry: { attempts: 2, baseDelayMs: 400, maxDelayMs: 2000 },
                    task: async () => evolutionClient.createInstance(location.id, instanceName),
                });
                if (reviveRes) {
                    console.log(`Instance ${instanceName} revived successfully.`);
                    // Use the result as the instance
                    instance = reviveRes;
                }

            } catch (reviveError) {
                console.warn(`Failed to revive instance ${instanceName}:`, reviveError);
            }
        }

        // Map status
        let status = 'UNKNOWN';
        let qrcode = null;

        if (!instance) {
            status = 'NOT_FOUND';
        } else {
            // Evolution v2 structure might vary, check common paths
            // Revive response might be the instance object itself or have .instance
            // Also handle the case where it returns { connectionStatus: 'open' } directly (as seen in logs)
            const rawStatus = instance.instance?.status
                || (instance as any).status
                || (instance as any).connectionStatus
                || 'UNKNOWN';

            status = rawStatus;
        }

        // CRITICAL FIX: Update the Database with the real status
        // This ensures Settings page stays in sync with what we see here
        // SPLIT-BRAIN FIX: Only update status if running in PRODUCTION to avoid Local overwriting it
        if (process.env.NODE_ENV === 'production') {
            if (location.evolutionConnectionStatus !== status) {
                await db.location.update({
                    where: { id: location.id },
                    data: { evolutionConnectionStatus: status }
                }).catch((err: any) => console.error("Failed to sync evolution status to DB:", err));
            }
        } else {
            console.log(`[getEvolutionStatus] Skipped DB update for status '${status}' (Local Dev Mode)`);
        }

        // If not connected, try to get QR code (but do not aggressively create instance just on check)
        // Only fetch QR if we are explicitly in a connecting state or if the user requested it?
        // Actually, if it's 'close', we usually might want to show QR if it's available.
        // But merely calling this shouldn't trigger a full connection flow unless necessary.
        // Let's just check if there is a QR in the fetch response first.

        if (instance?.qrcode?.base64) {
            qrcode = instance.qrcode.base64;
        }

        return { status, qrcode };
    } catch (error) {
        console.error("getEvolutionStatus error:", error);
        return { status: 'ERROR', qrcode: null };
    }
}

export async function triggerWhatsAppConnection() {
    try {
        // Relaxed Auth
        const location = await getBasicLocationContext();
        const instanceName = location.id;
        const { evolutionClient } = await import("@/lib/evolution/client");

        // 1. Create if not exists (Idempotent-ish)
        let qrCodeBase64 = null;
        try {
            const createRes = await evolutionClient.createInstance(location.id, instanceName);
            if (createRes?.qrcode?.base64) {
                qrCodeBase64 = createRes.qrcode.base64;
            }
        } catch (e) {
            console.log("Instance might already exist, proceeding to connect...");
        }

        // 2. Connect
        if (!qrCodeBase64) {
            // Try explicit connect to generate QR
            try {
                const connectRes = await evolutionClient.connectInstance(instanceName);
                if (connectRes?.base64 || connectRes?.qrcode?.base64) {
                    qrCodeBase64 = connectRes.base64 || connectRes.qrcode.base64;
                }
            } catch (e) {
                console.warn("Connect instance warning:", e);
            }
        }

        // 3. Update DB
        await db.location.update({
            where: { id: location.id },
            data: {
                evolutionInstanceId: instanceName,
                // We don't set status to 'open' yet, we wait for the poll to find it
            }
        });

        // 4. Return result
        return {
            success: true,
            qrCode: qrCodeBase64,
            status: qrCodeBase64 ? 'qrcode' : 'connecting'
        };

    } catch (error: any) {
        console.error("triggerWhatsAppConnection error:", error);
        return { success: false, error: error.message };
    }
}

export async function resendMessage(messageId: string) {
    const location = await getAuthenticatedLocation();

    // 1. Fetch Message
    const message = await db.message.findFirst({
        where: {
            OR: [
                { id: messageId },
                { ghlMessageId: messageId }
            ],
            conversation: { locationId: location.id } // Security Check
        },
        include: { conversation: { include: { contact: true } } }
    });

    if (!message) {
        return { success: false, error: "Message not found" };
    }

    if (message.direction === 'inbound') {
        return { success: false, error: "Cannot resend inbound messages" };
    }

    const contact = message.conversation.contact;
    if (!contact || !contact.phone) {
        return { success: false, error: "Contact phone not found" };
    }

    // 2. Determine Transport (Same Logic as sendReply)
    const hasEvolution = !!location.evolutionInstanceId;

    if (message.type === 'TYPE_WHATSAPP' && hasEvolution) {
        try {
            const { evolutionClient } = await import("@/lib/evolution/client");
            const normalizedPhone = contact.phone.replace(/\D/g, '');

            console.log(`[resendMessage] Retrying wamId ${message.wamId || 'new'} via Evolution...`);

            const res = await evolutionClient.sendMessage(
                location.evolutionInstanceId!,
                normalizedPhone,
                message.body || ''
            );

            if (res?.key?.id) {
                // Update Existing or Create New?
                // Creating new avoids confusion, but for "Retry" UI typically we want to update the failed one if it never sent.
                // But wamId changes. So we should probably mark old as failed/retried and create new.
                // OR update the existing record with new wamId.

                await db.message.update({
                    where: { id: message.id },
                    data: {
                        wamId: res.key.id, // Update WAM ID
                        status: 'sent',
                        updatedAt: new Date(),
                        // error: null // Clear previous errors if any (field not in schema yet)
                    }
                });

                return { success: true };
            }
        } catch (err: any) {
            console.error("Resend failed:", err);
            return { success: false, error: err.message };
        }
    }

    return { success: false, error: "Unsupported message type or transport unavailable" };
}


// --- AI Planner Actions ---

export async function generatePlanAction(conversationId: string, contactId: string, goal: string) {
    const location = await getAuthenticatedLocation();

    // 1. Fetch History
    const conversation = await db.conversation.findFirst({
        where: { ghlConversationId: conversationId, locationId: location.id },
        include: { messages: { orderBy: { createdAt: 'asc' }, take: 30 } }
    });

    if (!conversation) return { success: false, error: "Conversation not found" };

    const historyText = conversation.messages.map((m: any) =>
        `${m.direction === 'outbound' ? 'Agent' : 'Lead'}: ${m.body}`
    ).join("\n");

    try {
        const { generateAgentPlan } = await import('@/lib/ai/agent');
        const result = await generateAgentPlan(contactId, location.id, historyText, goal);

        if (result.success && result.plan) {
            // Calculate Cost
            const runCost = calculateRunCost(
                result.usage?.model || 'default',
                result.usage?.promptTokenCount || 0,
                result.usage?.candidatesTokenCount || 0
            );

            // Update Conversation Stats & Save Plan
            await db.conversation.update({
                where: { id: conversation.id },
                data: {
                    agentPlan: result.plan,
                    promptTokens: { increment: result.usage?.promptTokenCount || 0 },
                    completionTokens: { increment: result.usage?.candidatesTokenCount || 0 },
                    totalTokens: { increment: result.usage?.totalTokenCount || 0 },
                    totalCost: { increment: runCost }
                } as any
            });

            // Log Execution Trace for History
            await db.agentExecution.create({
                data: {
                    conversationId: conversation.id,
                    locationId: location.id,
                    taskId: 'PLANNING', // Special ID for planning phase
                    taskTitle: "Generate Mission Plan",
                    taskStatus: "done",
                    thoughtSummary: result.thought || "Generated new mission plan based on goal.",
                    thoughtSteps: [], // Planner doesn't return steps currently
                    toolCalls: [],
                    draftReply: null,
                    promptTokens: result.usage?.promptTokenCount,
                    completionTokens: result.usage?.candidatesTokenCount,
                    totalTokens: result.usage?.totalTokenCount,
                    model: result.usage?.model,
                    cost: runCost
                }
            });

            return { success: true, plan: result.plan, thought: result.thought };
        } else {
            return { success: false, error: "Failed to generate plan" };
        }
    } catch (e: any) {
        console.error("Plan Action Failed", e);
        return { success: false, error: e.message };
    }
}

export async function executeNextTaskAction(conversationId: string, contactId: string) {
    const location = await getAuthenticatedLocationReadOnly({ requireGhlToken: false });
    const requestedConversationId = String(conversationId || "").trim();
    if (!requestedConversationId) {
        return { success: false, error: "Missing conversation ID." };
    }

    const conversation = await db.conversation.findFirst({
        where: {
            locationId: location.id,
            OR: [
                { id: requestedConversationId },
                { ghlConversationId: requestedConversationId },
            ],
        },
        include: { messages: { orderBy: { createdAt: "asc" }, take: 40 } },
    });

    if (!conversation || !(conversation as any).agentPlan) {
        return { success: false, error: "No plan found" };
    }

    const plan = (conversation as any).agentPlan as any[];
    const nextTask = plan.find((task) => task.status === "pending");
    if (!nextTask) return { success: false, message: "All tasks completed!" };

    // Mark in-progress before runtime execution.
    nextTask.status = "in-progress";
    await db.conversation.update({
        where: { id: conversation.id },
        data: { agentPlan: plan } as any,
    });

    const mappedContact = await db.contact.findFirst({
        where: {
            locationId: location.id,
            OR: [{ id: contactId }, { ghlContactId: contactId }],
        },
        select: { id: true },
    });
    const resolvedContactId = mappedContact?.id || conversation.contactId;
    if (!resolvedContactId) {
        nextTask.status = "failed";
        nextTask.result = "Missing contact context.";
        await db.conversation.update({
            where: { id: conversation.id },
            data: { agentPlan: plan } as any,
        });
        return { success: false, error: "Missing contact context." };
    }

    const historyText = conversation.messages
        .map((message: any) => `${message.direction === "outbound" ? "Agent" : "Lead"}: ${message.body}`)
        .join("\n");

    try {
        const runtimeResult = await runAiSkillDecision({
            locationId: location.id,
            conversationId: conversation.id,
            contactId: resolvedContactId,
            source: "mission",
            contextSummary: [
                "Mission action: execute_next_task",
                `Task: ${String(nextTask.title || nextTask.id || "Untitled task")}`,
            ].join("\n"),
            extraInstruction: [
                `Execute this mission task: ${String(nextTask.title || nextTask.id || "Untitled task")}`,
                historyText ? `Conversation history:\n${historyText}` : null,
            ]
                .filter(Boolean)
                .join("\n\n"),
            executeImmediately: true,
        });

        if (!runtimeResult.success) {
            nextTask.status = "failed";
            nextTask.result = runtimeResult.error || "Runtime execution failed.";
            await db.conversation.update({
                where: { id: conversation.id },
                data: { agentPlan: plan } as any,
            });
            return { success: false, error: nextTask.result };
        }

        if (runtimeResult.holdReason) {
            nextTask.status = "pending";
            nextTask.result = `Held by policy: ${runtimeResult.holdReason}`;
        } else {
            nextTask.status = "done";
            nextTask.result = runtimeResult.draftBody
                ? `Queued suggested response via ${runtimeResult.selectedSkillId || "skill"}.`
                : `Decision executed via ${runtimeResult.selectedSkillId || "skill"}.`;
        }

        let updatedConversation = await db.conversation.update({
            where: { id: conversation.id },
            data: { agentPlan: plan } as any,
        });

        let usage: {
            promptTokenCount?: number;
            candidatesTokenCount?: number;
            totalTokenCount?: number;
            model?: string | null;
            cost?: number;
        } | null = null;

        if (runtimeResult.traceId) {
            const rootExecution = await db.agentExecution.findFirst({
                where: {
                    conversationId: conversation.id,
                    traceId: runtimeResult.traceId,
                    parentSpanId: null,
                },
                select: {
                    promptTokens: true,
                    completionTokens: true,
                    totalTokens: true,
                    model: true,
                    cost: true,
                },
            });

            const promptTokens = Number(rootExecution?.promptTokens || 0);
            const completionTokens = Number(rootExecution?.completionTokens || 0);
            const totalTokens = Number(rootExecution?.totalTokens || 0);
            const cost = Number(rootExecution?.cost || 0);

            usage = {
                promptTokenCount: promptTokens,
                candidatesTokenCount: completionTokens,
                totalTokenCount: totalTokens,
                model: rootExecution?.model || null,
                cost,
            };

            if (promptTokens > 0 || completionTokens > 0 || totalTokens > 0 || cost > 0) {
                updatedConversation = await db.conversation.update({
                    where: { id: conversation.id },
                    data: {
                        promptTokens: { increment: promptTokens },
                        completionTokens: { increment: completionTokens },
                        totalTokens: { increment: totalTokens },
                        totalCost: { increment: cost },
                    } as any,
                });
            }
        }

        return {
            success: true,
            task: nextTask,
            draft: null,
            thoughtSummary: nextTask.result || "Mission task executed.",
            thoughtSteps: [],
            actions: [],
            usage,
            traceId: runtimeResult.traceId || null,
            suggestionQueued: Boolean(runtimeResult.draftBody),
            selectedSkillId: runtimeResult.selectedSkillId || null,
            holdReason: runtimeResult.holdReason || null,
            conversationUsage: {
                promptTokens: Number(updatedConversation.promptTokens || 0),
                completionTokens: Number(updatedConversation.completionTokens || 0),
                totalTokens: Number(updatedConversation.totalTokens || 0),
                totalCost: Number(updatedConversation.totalCost || 0),
            },
        };
    } catch (error: any) {
        nextTask.status = "failed";
        nextTask.result = error?.message || "Mission task execution failed.";
        await db.conversation.update({
            where: { id: conversation.id },
            data: { agentPlan: plan } as any,
        });
        return { success: false, error: nextTask.result };
    }
}

export async function getAgentPlan(conversationId: string) {
    const location = await getAuthenticatedLocation();
    const conversation = await db.conversation.findFirst({
        where: { ghlConversationId: conversationId, locationId: location.id },
        select: {
            agentPlan: true,
            promptTokens: true,
            completionTokens: true,
            totalTokens: true
        } as any
    });

    if (!conversation) return null;

    return {
        plan: (conversation as any).agentPlan,
        usage: {
            promptTokens: (conversation as any).promptTokens || 0,
            completionTokens: (conversation as any).completionTokens || 0,
            totalTokens: (conversation as any).totalTokens || 0
        }
    };
}

// [Updated] Return full tracing fields
export async function getAgentExecutions(conversationId: string) {
    const location = await getAuthenticatedLocation();
    const conversation = await db.conversation.findFirst({
        where: { ghlConversationId: conversationId, locationId: location.id },
        select: { id: true }
    });

    if (!conversation) return [];

    // Fetch root spans (where parentSpanId is null OR spanId == traceId)
    // The current schema treats AgentExecution as a flattened span log. 
    // We want the 'Root' entries which usually correspond to 'runAgent' or top-level tasks.
    const executions = await db.agentExecution.findMany({
        where: {
            conversationId: conversation.id,
            // Simple heuristic for root spans: parentSpanId is null
            parentSpanId: null
        },
        orderBy: { createdAt: 'desc' },
        take: 20
    });

    const parseJsonField = (value: any, fallback: any) => {
        if (value == null) return fallback;
        if (typeof value === "string") {
            try {
                return JSON.parse(value);
            } catch {
                return fallback;
            }
        }
        return value;
    };

    return executions.map(e => ({
        id: e.id,
        traceId: e.traceId,
        spanId: e.spanId,
        taskId: e.taskId,
        taskTitle: e.taskTitle,
        taskStatus:
            e.taskStatus === "done" ? "success" :
                e.taskStatus === "failed" ? "error" :
                    e.taskStatus || (e.status === "success" ? "success" : e.status === "error" ? "error" : e.status),
        thoughtSummary: e.thoughtSummary,
        thoughtSteps: parseJsonField(e.thoughtSteps, []),
        toolCalls: parseJsonField(e.toolCalls, []),
        draftReply: e.draftReply,
        usage: {
            promptTokenCount: e.promptTokens,
            candidatesTokenCount: e.completionTokens,
            totalTokenCount: e.totalTokens,
            cost: e.cost,
            model: e.model
        },
        latencyMs: e.latencyMs,
        errorMessage: e.errorMessage,
        createdAt: e.createdAt.toISOString()
    }));
}

import { getTrace } from "@/lib/ai/tracing-queries";

export async function getTraceTreeAction(traceId: string) {
    const location = await getAuthenticatedLocation();
    if (!location) throw new Error("Unauthorized");
    return getTrace(traceId);
}

export async function getContactInsightsAction(contactId: string) {
    const location = await getAuthenticatedLocation();

    // Resolve contact ID first (could be GHL ID)
    const contact = await db.contact.findFirst({
        where: {
            OR: [{ id: contactId }, { ghlContactId: contactId }],
            locationId: location.id
        },
        select: { id: true }
    });

    if (!contact) return [];

    return db.insight.findMany({
        where: { contactId: contact.id },
        orderBy: { createdAt: 'desc' },
        take: 10
    });
}

/**
 * Get aggregate AI usage across all conversations for the current location.
 * Returns usage broken down by time period (today, this month, all-time)
 * and top conversations for the detailed modal.
 * Includes both AI agent usage (from AgentExecution) and transcription usage
 * (from MessageTranscript + MessageTranscriptExtraction).
 */
export async function getAggregateAIUsage() {
    const emptyResult = {
        today: { totalTokens: 0, totalCost: 0 },
        thisMonth: { totalTokens: 0, totalCost: 0 },
        allTime: { totalTokens: 0, totalCost: 0, conversationCount: 0 },
        automation: {
            today: { totalTokens: 0, totalCost: 0 },
            thisMonth: { totalTokens: 0, totalCost: 0 },
            allTime: { totalTokens: 0, totalCost: 0 },
        },
        transcription: {
            today: { totalTokens: 0, totalCost: 0 },
            thisMonth: { totalTokens: 0, totalCost: 0 },
            allTime: { totalTokens: 0, totalCost: 0, transcriptCount: 0 },
        },
        sourceBreakdown: {
            manual: { totalTokens: 0, totalCost: 0 },
            semi_auto: { totalTokens: 0, totalCost: 0 },
            automation: { totalTokens: 0, totalCost: 0 },
        },
        skillBreakdown: [] as Array<{
            source: "manual" | "semi_auto" | "automation";
            skillId: string;
            totalTokens: number;
            totalCost: number;
        }>,
        topConversations: [] as any[]
    };

    try {
        const location = await getLocationContext();
        if (!location) return emptyResult;

        // Calculate date boundaries
        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        const locationFilter = { message: { conversation: { locationId: location.id } } };

        // Aggregate from AgentExecution + MessageTranscript + MessageTranscriptExtraction
        const [
            todayUsage,
            monthUsage,
            allTimeExecutionUsage,
            automationTodayUsage,
            automationMonthUsage,
            automationAllTimeUsage,
            allTimeUsage,
            topConversations,
            topConversationUsageByExecution,
            sourceAndSkillUsageRows,
            txTodayT, txMonthT, txAllTimeT,
            txTodayE, txMonthE, txAllTimeE,
            scraperTodayUsage,
            scraperMonthUsage,
            scraperAllTimeUsage,
        ] = await Promise.all([
            // --- AI Agent usage (Global by Location) ---
            db.agentExecution.aggregate({
                where: {
                    locationId: location.id,
                    createdAt: { gte: startOfToday }
                },
                _sum: { totalTokens: true, cost: true }
            }),
            db.agentExecution.aggregate({
                where: {
                    locationId: location.id,
                    createdAt: { gte: startOfMonth }
                },
                _sum: { totalTokens: true, cost: true }
            }),
            db.agentExecution.aggregate({
                where: {
                    locationId: location.id,
                },
                _sum: { totalTokens: true, cost: true }
            }),
            db.agentExecution.aggregate({
                where: {
                    locationId: location.id,
                    taskTitle: { startsWith: "automation:" },
                    createdAt: { gte: startOfToday },
                },
                _sum: { totalTokens: true, cost: true },
            }),
            db.agentExecution.aggregate({
                where: {
                    locationId: location.id,
                    taskTitle: { startsWith: "automation:" },
                    createdAt: { gte: startOfMonth },
                },
                _sum: { totalTokens: true, cost: true },
            }),
            db.agentExecution.aggregate({
                where: {
                    locationId: location.id,
                    taskTitle: { startsWith: "automation:" },
                },
                _sum: { totalTokens: true, cost: true },
            }),
            db.conversation.aggregate({
                where: { locationId: location.id },
                _sum: { totalTokens: true, totalCost: true },
                _count: { id: true }
            }),
            db.conversation.findMany({
                where: { locationId: location.id, totalCost: { gt: 0 } },
                orderBy: { totalCost: 'desc' },
                take: 10,
                select: {
                    id: true,
                    ghlConversationId: true,
                    totalTokens: true,
                    totalCost: true,
                    lastMessageAt: true,
                    contact: { select: { name: true, email: true } }
                }
            }),
            db.agentExecution.groupBy({
                by: ["conversationId"],
                where: {
                    locationId: location.id,
                    conversationId: { not: null },
                },
                _sum: { totalTokens: true, cost: true },
                orderBy: [
                    { _sum: { cost: "desc" } },
                    { _sum: { totalTokens: "desc" } },
                ],
                take: 10,
            }),
            db.agentExecution.groupBy({
                by: ["taskTitle", "sourceType"],
                where: {
                    locationId: location.id,
                },
                _sum: { totalTokens: true, cost: true },
            }),

            // --- Transcript usage (MessageTranscript) ---
            db.messageTranscript.aggregate({
                where: { ...locationFilter, createdAt: { gte: startOfToday } },
                _sum: { totalTokens: true, estimatedCostUsd: true }
            }),
            db.messageTranscript.aggregate({
                where: { ...locationFilter, createdAt: { gte: startOfMonth } },
                _sum: { totalTokens: true, estimatedCostUsd: true }
            }),
            db.messageTranscript.aggregate({
                where: locationFilter,
                _sum: { totalTokens: true, estimatedCostUsd: true },
                _count: { id: true }
            }),

            // --- Extraction usage (MessageTranscriptExtraction) ---
            db.messageTranscriptExtraction.aggregate({
                where: { transcript: locationFilter, createdAt: { gte: startOfToday } },
                _sum: { totalTokens: true, estimatedCostUsd: true }
            }),
            db.messageTranscriptExtraction.aggregate({
                where: { transcript: locationFilter, createdAt: { gte: startOfMonth } },
                _sum: { totalTokens: true, estimatedCostUsd: true }
            }),
            db.messageTranscriptExtraction.aggregate({
                where: { transcript: locationFilter },
                _sum: { totalTokens: true, estimatedCostUsd: true }
            }),

            // --- Explicit Scraper Usage ---
            db.agentExecution.aggregate({
                where: {
                    locationId: location.id,
                    sourceType: "scraper",
                    createdAt: { gte: startOfToday },
                },
                _sum: { totalTokens: true, cost: true },
            }),
            db.agentExecution.aggregate({
                where: {
                    locationId: location.id,
                    sourceType: "scraper",
                    createdAt: { gte: startOfMonth },
                },
                _sum: { totalTokens: true, cost: true },
            }),
            db.agentExecution.aggregate({
                where: {
                    locationId: location.id,
                    sourceType: "scraper",
                },
                _sum: { totalTokens: true, cost: true },
            }),
        ]);

        const normalizedTopConversations = topConversationUsageByExecution.length > 0
            ? (() => {
                const usageByConversationId = new Map(
                    topConversationUsageByExecution.map((row) => [
                        row.conversationId,
                        {
                            totalTokens: Number(row._sum.totalTokens || 0),
                            totalCost: Number(row._sum.cost || 0),
                        },
                    ])
                );
                return usageByConversationId;
            })()
            : null;

        let topConversationRows: Array<{
            id: string;
            conversationId: string;
            contactName: string;
            contactEmail: string | null;
            totalTokens: number;
            totalCost: number;
            lastMessageAt: string;
        }> = [];

        if (normalizedTopConversations && normalizedTopConversations.size > 0) {
            const conversationIds = Array.from(normalizedTopConversations.keys());
            const conversationRecords = await db.conversation.findMany({
                where: {
                    id: { in: (conversationIds as string[]).filter(Boolean) },
                    locationId: location.id,
                },
                select: {
                    id: true,
                    ghlConversationId: true,
                    lastMessageAt: true,
                    contact: {
                        select: {
                            name: true,
                            email: true,
                        },
                    },
                },
            });

            const byConversationId = new Map(
                conversationRecords.map((record) => [record.id, record])
            );

            topConversationRows = conversationIds
                .map((conversationId) => {
                    const record = byConversationId.get(conversationId as string);
                    const usage = normalizedTopConversations.get(conversationId);
                    if (!record || !usage) return null;
                    return {
                        id: record.id,
                        conversationId: record.ghlConversationId,
                        contactName: (record as any).contact?.name || "Unknown",
                        contactEmail: (record as any).contact?.email || null,
                        totalTokens: usage.totalTokens,
                        totalCost: usage.totalCost,
                        lastMessageAt: record.lastMessageAt.toISOString(),
                    };
                })
                .filter((row): row is {
                    id: string;
                    conversationId: string;
                    contactName: string;
                    contactEmail: string | null;
                    totalTokens: number;
                    totalCost: number;
                    lastMessageAt: string;
                } => !!row);
        }

        if (topConversationRows.length === 0) {
            topConversationRows = topConversations.map((conversation) => ({
                id: conversation.id,
                conversationId: conversation.ghlConversationId,
                contactName: conversation.contact?.name || "Unknown",
                contactEmail: conversation.contact?.email || null,
                totalTokens: Number(conversation.totalTokens || 0),
                totalCost: Number(conversation.totalCost || 0),
                lastMessageAt: conversation.lastMessageAt.toISOString(),
            }));
        }

        // Per-conversation transcript cost for top conversations
        const topConvIds = topConversationRows.map((conversation) => conversation.id);
        let convTranscriptMap: Record<string, { tokens: number; cost: number }> = {};
        if (topConvIds.length > 0) {
            const convTxRows = await db.messageTranscript.groupBy({
                by: ['messageId'],
                where: {
                    message: { conversationId: { in: topConvIds } },
                },
                _sum: { totalTokens: true, estimatedCostUsd: true }
            });
            // Map messageId -> conversationId via a quick lookup
            const msgIds = convTxRows.map(r => r.messageId);
            if (msgIds.length > 0) {
                const msgs = await db.message.findMany({
                    where: { id: { in: msgIds } },
                    select: { id: true, conversationId: true }
                });
                const msgToConv = new Map(msgs.map(m => [m.id, m.conversationId]));
                for (const row of convTxRows) {
                    const convId = msgToConv.get(row.messageId);
                    if (!convId) continue;
                    const existing = convTranscriptMap[convId] || { tokens: 0, cost: 0 };
                    existing.tokens += Number(row._sum.totalTokens || 0);
                    existing.cost += Number(row._sum.estimatedCostUsd || 0);
                    convTranscriptMap[convId] = existing;
                }
            }
        }

        const allTimeTokens = Math.max(
            Number(allTimeExecutionUsage._sum.totalTokens || 0),
            Number(allTimeUsage._sum.totalTokens || 0)
        );
        const allTimeCost = Math.max(
            Number(allTimeExecutionUsage._sum.cost || 0),
            Number(allTimeUsage._sum.totalCost || 0)
        );

        const sourceBreakdown = {
            manual: { totalTokens: 0, totalCost: 0 },
            semi_auto: { totalTokens: 0, totalCost: 0 },
            automation: { totalTokens: 0, totalCost: 0 },
        };
        const skillBreakdownMap = new Map<string, {
            source: "manual" | "semi_auto" | "automation";
            skillId: string;
            totalTokens: number;
            totalCost: number;
        }>();

        for (const row of sourceAndSkillUsageRows) {
            const taskTitle = String(row.taskTitle || "").trim().toLowerCase();
            const tokens = Number(row._sum.totalTokens || 0);
            const cost = Number(row._sum.cost || 0);

            let source: "manual" | "semi_auto" | "automation" = "manual";
            if (taskTitle.startsWith("automation:")) source = "automation";
            else if (taskTitle.startsWith("semi_auto:")) source = "semi_auto";
            else if (taskTitle.startsWith("manual:")) source = "manual";
            else if (taskTitle.startsWith("mission:")) source = "manual";

            sourceBreakdown[source].totalTokens += tokens;
            sourceBreakdown[source].totalCost += cost;

            const skillMatch = taskTitle.match(/^(automation|semi_auto|manual|mission):skill:([a-z0-9_-]+)/i);
            if (!skillMatch) continue;

            const rawSkillSource = String(skillMatch[1] || "").toLowerCase();
            const skillSource = (rawSkillSource === "mission" ? "manual" : rawSkillSource) as "manual" | "semi_auto" | "automation";
            const skillId = String(skillMatch[2] || "").trim() || "unknown";
            const key = `${skillSource}:${skillId}`;
            const existing = skillBreakdownMap.get(key) || {
                source: skillSource,
                skillId,
                totalTokens: 0,
                totalCost: 0,
            };
            existing.totalTokens += tokens;
            existing.totalCost += cost;
            skillBreakdownMap.set(key, existing);
        }

        const skillBreakdown = Array.from(skillBreakdownMap.values())
            .sort((a, b) => b.totalCost - a.totalCost || b.totalTokens - a.totalTokens)
            .slice(0, 20);

        return {
            today: {
                totalTokens: todayUsage._sum.totalTokens || 0,
                totalCost: todayUsage._sum.cost || 0
            },
            thisMonth: {
                totalTokens: monthUsage._sum.totalTokens || 0,
                totalCost: monthUsage._sum.cost || 0
            },
            allTime: {
                totalTokens: allTimeTokens,
                totalCost: allTimeCost,
                conversationCount: allTimeUsage._count.id || 0
            },
            automation: {
                today: {
                    totalTokens: automationTodayUsage._sum.totalTokens || 0,
                    totalCost: automationTodayUsage._sum.cost || 0,
                },
                thisMonth: {
                    totalTokens: automationMonthUsage._sum.totalTokens || 0,
                    totalCost: automationMonthUsage._sum.cost || 0,
                },
                allTime: {
                    totalTokens: automationAllTimeUsage._sum.totalTokens || 0,
                    totalCost: automationAllTimeUsage._sum.cost || 0,
                },
            },
            transcription: {
                today: {
                    totalTokens: (txTodayT._sum.totalTokens || 0) + (txTodayE._sum.totalTokens || 0),
                    totalCost: (txTodayT._sum.estimatedCostUsd || 0) + (txTodayE._sum.estimatedCostUsd || 0),
                },
                thisMonth: {
                    totalTokens: (txMonthT._sum.totalTokens || 0) + (txMonthE._sum.totalTokens || 0),
                    totalCost: (txMonthT._sum.estimatedCostUsd || 0) + (txMonthE._sum.estimatedCostUsd || 0),
                },
                allTime: {
                    totalTokens: (txAllTimeT._sum.totalTokens || 0) + (txAllTimeE._sum.totalTokens || 0),
                    totalCost: (txAllTimeT._sum.estimatedCostUsd || 0) + (txAllTimeE._sum.estimatedCostUsd || 0),
                    transcriptCount: txAllTimeT._count?.id || 0,
                },
            },
            sourceBreakdown,
            skillBreakdown,
            topConversations: topConversationRows.map((conversation) => ({
                id: conversation.id,
                conversationId: conversation.conversationId,
                contactName: conversation.contactName,
                contactEmail: conversation.contactEmail,
                totalTokens: conversation.totalTokens,
                totalCost: conversation.totalCost,
                transcriptTokens: convTranscriptMap[conversation.id]?.tokens || 0,
                transcriptCost: convTranscriptMap[conversation.id]?.cost || 0,
                lastMessageAt: conversation.lastMessageAt,
            }))
        };
    } catch (e) {
        console.error('[getAggregateAIUsage] Error:', e);
        return emptyResult;
    }
}

/**
 * Get transcript usage (tokens + cost) for a single conversation.
 * Used by the AI Thinking Trace Performance card.
 */
export async function getConversationTranscriptUsage(conversationId: string) {
    try {
        const location = await getLocationContext();
        if (!location) return { totalTokens: 0, totalCost: 0, transcriptCount: 0, extractionCount: 0 };

        const conversation = await db.conversation.findFirst({
            where: {
                OR: [{ id: conversationId }, { ghlConversationId: conversationId }],
                locationId: location.id
            },
            select: { id: true }
        });
        if (!conversation) return { totalTokens: 0, totalCost: 0, transcriptCount: 0, extractionCount: 0 };

        const txWhere = { message: { conversationId: conversation.id } };

        const [txAgg, exAgg] = await Promise.all([
            db.messageTranscript.aggregate({
                where: txWhere,
                _sum: { totalTokens: true, estimatedCostUsd: true },
                _count: { id: true }
            }),
            db.messageTranscriptExtraction.aggregate({
                where: { transcript: txWhere },
                _sum: { totalTokens: true, estimatedCostUsd: true },
                _count: { id: true }
            }),
        ]);

        return {
            totalTokens: (txAgg._sum.totalTokens || 0) + (exAgg._sum.totalTokens || 0),
            totalCost: (txAgg._sum.estimatedCostUsd || 0) + (exAgg._sum.estimatedCostUsd || 0),
            transcriptCount: txAgg._count.id || 0,
            extractionCount: exAgg._count.id || 0,
        };
    } catch (e) {
        console.error('[getConversationTranscriptUsage] Error:', e);
        return { totalTokens: 0, totalCost: 0, transcriptCount: 0, extractionCount: 0 };
    }
}


export async function refreshConversation(conversationId: string) {
    const location = await getAuthenticatedLocationReadOnly();

    // Fetch from DB to get latest fields like suggestedActions
    const conversation = await db.conversation.findUnique({
        where: { ghlConversationId: conversationId },
        include: { contact: true }
    });

    if (!conversation) return null;

    // Map to UI format (Conversation interface)
    return {
        id: conversation.ghlConversationId,
        contactId: conversation.contact.ghlContactId || conversation.contactId,
        contactName: conversation.contact.name || "Unknown",
        contactPhone: conversation.contact.phone || undefined,
        contactEmail: conversation.contact.email || undefined,
        contactPreferredLanguage: conversation.contact.preferredLang || null,
        replyLanguageOverride: conversation.replyLanguageOverride || null,
        locationDefaultReplyLanguage: await getLocationDefaultReplyLanguage(location.id),
        lastMessageBody: conversation.lastMessageBody || "",
        lastMessageDate: Math.floor(conversation.lastMessageAt.getTime() / 1000),
        unreadCount: conversation.unreadCount,
        status: conversation.status as any,
        type: conversation.lastMessageType || 'TYPE_SMS',
        lastMessageType: conversation.lastMessageType || undefined,
        locationId: location.ghlLocationId || "",
        suggestedActions: conversation.suggestedActions || []
    };
}

export async function markConversationAsRead(conversationId: string) {
    const location = await getAuthenticatedLocationReadOnly();

    if (!conversationId) {
        return { success: false, error: "Missing conversationId" };
    }

    try {
        const result = await db.conversation.updateMany({
            where: {
                ghlConversationId: conversationId,
                locationId: location.id,
                unreadCount: { gt: 0 },
            },
            data: {
                unreadCount: 0,
            }
        });

        if (result.count > 0) {
            invalidateConversationReadCaches(conversationId);
            emitConversationRealtimeEvent({
                locationId: location.id,
                conversationId,
                type: "conversation.read_reset",
                payload: { unreadCount: 0 },
            });
        }

        return { success: true, updatedCount: result.count };
    } catch (error: any) {
        console.error("markConversationAsRead error:", error);
        return { success: false, error: error?.message || "Failed to mark conversation as read" };
    }
}

export async function deleteConversations(conversationIds: string[]) {
    const location = await getAuthenticatedLocationReadOnly();

    if (!conversationIds || conversationIds.length === 0) {
        return { success: false, error: "No conversations selected" };
    }

    try {
        // Soft Delete: Mark conversations as deleted instead of removing them
        // This allows users to restore them from the trash within 30 days
        const result = await db.conversation.updateMany({
            where: {
                ghlConversationId: { in: conversationIds },
                locationId: location.id, // Security check to ensure ownership
                deletedAt: null // Only delete non-deleted conversations (prevent double-delete)
            },
            data: {
                deletedAt: new Date(),
                // Note: deletedBy would require user context from auth
                // For now, we'll track via deletedAt timestamp only
            }
        });

        console.log(`[Soft Delete] Moved ${result.count} conversations to trash.`);
        invalidateConversationReadCaches();
        conversationIds.forEach((conversationId) => {
            emitConversationRealtimeEvent({
                locationId: location.id,
                conversationId,
                type: "conversation.deleted_soft",
            });
        });
        return { success: true, count: result.count };

    } catch (error: any) {
        console.error("deleteConversations error:", error);
        return { success: false, error: error.message };
    }
}

export async function restoreConversations(conversationIds: string[]) {
    const location = await getAuthenticatedLocationReadOnly();

    if (!conversationIds || conversationIds.length === 0) {
        return { success: false, error: "No conversations selected" };
    }

    try {
        // Restore: Remove deletedAt timestamp to bring back from trash
        const result = await db.conversation.updateMany({
            where: {
                ghlConversationId: { in: conversationIds },
                locationId: location.id,
                deletedAt: { not: null } // Only restore deleted conversations
            },
            data: {
                deletedAt: null,
                deletedBy: null
            }
        });

        console.log(`[Restore] Restored ${result.count} conversations from trash.`);
        invalidateConversationReadCaches();
        conversationIds.forEach((conversationId) => {
            emitConversationRealtimeEvent({
                locationId: location.id,
                conversationId,
                type: "conversation.restored",
            });
        });
        return { success: true, count: result.count };

    } catch (error: any) {
        console.error("restoreConversations error:", error);
        return { success: false, error: error.message };
    }
}

export async function permanentlyDeleteConversations(conversationIds: string[]) {
    const location = await getAuthenticatedLocationReadOnly();

    if (!conversationIds || conversationIds.length === 0) {
        return { success: false, error: "No conversations selected" };
    }

    try {
        // Hard Delete: Permanently remove from database
        // Can only delete conversations that are already in trash (have deletedAt)
        const result = await db.conversation.deleteMany({
            where: {
                ghlConversationId: { in: conversationIds },
                locationId: location.id,
                deletedAt: { not: null } // Security: Only allow permanent deletion of trashed items
            }
        });

        console.log(`[Permanent Delete] Permanently deleted ${result.count} conversations.`);
        invalidateConversationReadCaches();
        conversationIds.forEach((conversationId) => {
            emitConversationRealtimeEvent({
                locationId: location.id,
                conversationId,
                type: "conversation.deleted_hard",
            });
        });
        return { success: true, count: result.count };

    } catch (error: any) {
        console.error("permanentlyDeleteConversations error:", error);
        return { success: false, error: error.message };
    }
}

export async function archiveConversations(conversationIds: string[]) {
    const location = await getAuthenticatedLocationReadOnly();

    if (!conversationIds || conversationIds.length === 0) {
        return { success: false, error: "No conversations selected" };
    }

    try {
        // Archive: Hide from inbox without deleting
        const result = await db.conversation.updateMany({
            where: {
                ghlConversationId: { in: conversationIds },
                locationId: location.id,
                archivedAt: null, // Only archive non-archived conversations
                deletedAt: null // Don't archive deleted conversations
            },
            data: {
                archivedAt: new Date()
            }
        });

        console.log(`[Archive] Archived ${result.count} conversations.`);
        invalidateConversationReadCaches();
        conversationIds.forEach((conversationId) => {
            emitConversationRealtimeEvent({
                locationId: location.id,
                conversationId,
                type: "conversation.archived",
            });
        });
        return { success: true, count: result.count };

    } catch (error: any) {
        console.error("archiveConversations error:", error);
        return { success: false, error: error.message };
    }
}

export async function unarchiveConversations(conversationIds: string[]) {
    const location = await getAuthenticatedLocationReadOnly();

    if (!conversationIds || conversationIds.length === 0) {
        return { success: false, error: "No conversations selected" };
    }

    try {
        // Unarchive: Return to inbox
        const result = await db.conversation.updateMany({
            where: {
                ghlConversationId: { in: conversationIds },
                locationId: location.id,
                archivedAt: { not: null } // Only unarchive archived conversations
            },
            data: {
                archivedAt: null
            }
        });

        console.log(`[Unarchive] Unarchived ${result.count} conversations.`);
        invalidateConversationReadCaches();
        conversationIds.forEach((conversationId) => {
            emitConversationRealtimeEvent({
                locationId: location.id,
                conversationId,
                type: "conversation.unarchived",
            });
        });
        return { success: true, count: result.count };

    } catch (error: any) {
        console.error("unarchiveConversations error:", error);
        return { success: false, error: error.message };
    }
}

export async function emptyTrash() {
    const location = await getAuthenticatedLocationReadOnly();

    try {
        // Permanently delete all conversations in trash
        const deletedRows = await db.conversation.findMany({
            where: {
                locationId: location.id,
                deletedAt: { not: null }
            },
            select: { ghlConversationId: true },
        });

        const result = await db.conversation.deleteMany({
            where: {
                locationId: location.id,
                deletedAt: { not: null }
            }
        });

        console.log(`[Empty Trash] Permanently deleted ${result.count} conversations from trash.`);
        invalidateConversationReadCaches();
        deletedRows.forEach((row) => {
            emitConversationRealtimeEvent({
                locationId: location.id,
                conversationId: row.ghlConversationId,
                type: "conversation.deleted_hard",
                payload: { source: "empty_trash" },
            });
        });
        return { success: true, count: result.count };

    } catch (error: any) {
        console.error("emptyTrash error:", error);
        return { success: false, error: error.message };
    }
}

export async function getConversationParticipants(conversationId: string) {
    try {
        const location = await getLocationContext();
        if (!location) throw new Error("Unauthorized");

        const conversation = await db.conversation.findFirst({
            where: {
                OR: [
                    { id: conversationId },
                    { ghlConversationId: conversationId }
                ],
                locationId: location.id
            }
        });

        if (!conversation) return { success: false, error: "Conversation not found" };

        const participants = await db.conversationParticipant.findMany({
            where: { conversationId: conversation.id },
            include: {
                contact: {
                    select: {
                        id: true,
                        name: true,
                        phone: true,
                        email: true,
                        contactType: true
                    }
                }
            },
            orderBy: [
                { role: 'asc' },
                { displayName: 'asc' }
            ]
        });

        return {
            success: true,
            participants: participants.map((participant) => ({
                id: participant.id,
                role: participant.role,
                displayName: participant.displayName || participant.contact?.name || "Unknown",
                identitySummary: formatGroupParticipantIdentitySummary(participant),
                participantJid: participant.participantJid,
                lidJid: participant.lidJid,
                phoneJid: participant.phoneJid,
                phoneDigits: participant.phoneDigits,
                resolutionConfidence: participant.resolutionConfidence,
                source: participant.source,
                lastSeenAt: participant.lastSeenAt,
                linkedContact: participant.contact,
                canSave: true,
                canOpenDirect: canOpenDirectChatForParticipant(participant),
                directChatLabel: participant.contactId ? "Open Direct Chat" : "Start Direct Chat",
            })),
        };
    } catch (error: any) {
        console.error("Failed to fetch participants:", error);
        return { success: false, error: error.message };
    }
}

export async function prepareGroupParticipantSave(participantId: string) {
    try {
        const location = await getLocationContext();
        if (!location) throw new Error("Unauthorized");

        const participant = await getScopedConversationParticipant(location.id, participantId);
        if (!participant) return { success: false, error: "Participant not found" };

        const matches = await findLikelyContactsForGroupParticipant(location.id, participant);
        const draftName = buildGroupParticipantDraftName(participant);
        const draftPhone = canOpenDirectChatForParticipant(participant)
            ? normalizeContactPhoneForStorage(participant.phoneDigits)
            : null;

        return {
            success: true,
            participant: {
                id: participant.id,
                displayName: participant.displayName || participant.contact?.name || draftName,
                identitySummary: formatGroupParticipantIdentitySummary(participant),
                linkedContact: participant.contact,
                phoneDigits: participant.phoneDigits,
                phoneJid: participant.phoneJid,
                lidJid: participant.lidJid,
            },
            draft: {
                name: draftName,
                phone: draftPhone,
            },
            matches,
        };
    } catch (error: any) {
        console.error("prepareGroupParticipantSave failed:", error);
        return { success: false, error: error.message };
    }
}

const SaveGroupParticipantSchema = z.object({
    participantId: z.string().trim().min(1),
    action: z.enum(["create", "link"]),
    contactId: z.string().trim().optional(),
    name: z.string().trim().optional(),
    phone: z.string().trim().optional(),
});

export async function saveGroupParticipantContact(input: z.infer<typeof SaveGroupParticipantSchema>) {
    try {
        const location = await getLocationContext();
        if (!location) throw new Error("Unauthorized");

        const parsed = SaveGroupParticipantSchema.parse(input);
        const participant = await getScopedConversationParticipant(location.id, parsed.participantId);
        if (!participant) return { success: false, error: "Participant not found" };

        const contactId = await ensureRealContactForGroupParticipant({
            locationId: location.id,
            participant,
            contactId: parsed.action === "link" ? parsed.contactId : null,
            name: parsed.name,
            phone: parsed.phone,
        });

        revalidatePath("/admin/conversations");
        revalidatePath("/admin/contacts");
        return { success: true, contactId };
    } catch (error: any) {
        console.error("saveGroupParticipantContact failed:", error);
        return { success: false, error: error.message };
    }
}

export async function openConversationForGroupParticipant(participantId: string) {
    try {
        const location = await getLocationContext();
        if (!location) throw new Error("Unauthorized");

        const participant = await getScopedConversationParticipant(location.id, participantId);
        if (!participant) return { success: false, error: "Participant not found" };
        if (!canOpenDirectChatForParticipant(participant)) {
            return { success: false, error: "Direct chat is unavailable until a trusted direct WhatsApp number is known." };
        }

        const contactId = await ensureRealContactForGroupParticipant({
            locationId: location.id,
            participant,
            name: participant.displayName,
            phone: participant.phoneDigits ? `+${participant.phoneDigits}` : null,
        });

        const { openOrStartConversationForContact } = await import("../contacts/actions");
        return openOrStartConversationForContact(contactId);
    } catch (error: any) {
        console.error("openConversationForGroupParticipant failed:", error);
        return { success: false, error: error.message };
    }
}

// =============================================
// WhatsApp Chat Sync & New Conversation Actions
// =============================================

async function checkWhatsAppPhoneEligibility(
    location: { evolutionInstanceId?: string | null },
    phone: string | null | undefined,
    options?: {
        contactName?: string | null;
        contactType?: string | null;
        verifyServiceHealth?: boolean;
    }
): Promise<{ status: 'eligible' | 'ineligible' | 'unknown'; reason?: string; normalizedDigits?: string }> {
    const contactName = options?.contactName || 'This contact';
    const phoneValue = String(phone || '').trim();

    if (!phoneValue) {
        return {
            status: 'ineligible',
            reason: `${contactName} does not have a phone number.`,
        };
    }

    if (options?.contactType === 'WhatsAppGroup' || phoneValue.includes('@g.us')) {
        return { status: 'eligible' };
    }

    if (phoneValue.includes('*')) {
        return {
            status: 'ineligible',
            reason: `${contactName}'s phone number "${phoneValue}" is masked (contains ***), so WhatsApp cannot be verified.`,
        };
    }

    const rawDigits = phoneValue.replace(/\D/g, '');
    if (rawDigits.length < 7) {
        return {
            status: 'ineligible',
            reason: `${contactName}'s phone number "${phoneValue}" is invalid or too short.`,
            normalizedDigits: rawDigits,
        };
    }

    if (!location?.evolutionInstanceId) {
        return {
            status: 'unknown',
            reason: 'WhatsApp eligibility check is unavailable (Evolution is not connected).',
            normalizedDigits: rawDigits,
        };
    }

    try {
        const { evolutionClient } = await import("@/lib/evolution/client");

        if (options?.verifyServiceHealth) {
            const health = await evolutionClient.healthCheck();
            if (!health.ok) {
                return {
                    status: 'unknown',
                    reason: health.error || 'WhatsApp service is unavailable.',
                    normalizedDigits: rawDigits,
                };
            }
        }

        const lookup = await evolutionClient.checkWhatsAppNumber(location.evolutionInstanceId, rawDigits);
        if (lookup.exists) {
            return {
                status: 'eligible',
                normalizedDigits: rawDigits,
            };
        }

        return {
            status: 'ineligible',
            reason: `${contactName}'s phone number is not registered on WhatsApp.`,
            normalizedDigits: rawDigits,
        };
    } catch (err) {
        console.warn(`[WhatsAppEligibility] Lookup failed for ${rawDigits}:`, err);
        return {
            status: 'unknown',
            reason: 'Could not verify WhatsApp registration right now.',
            normalizedDigits: rawDigits,
        };
    }
}

async function checkSmsPhoneEligibility(
    location: { id: string; ghlAccessToken?: string | null; ghlLocationId?: string | null },
    phone: string | null | undefined,
    options?: {
        contactName?: string | null;
    }
): Promise<{ status: 'eligible' | 'ineligible' | 'unknown'; reason?: string; normalizedDigits?: string }> {
    const contactName = options?.contactName || 'This contact';
    const phoneValue = String(phone || '').trim();

    if (!phoneValue) {
        return {
            status: 'ineligible',
            reason: `${contactName} does not have a phone number.`,
        };
    }

    if (phoneValue.includes('*')) {
        return {
            status: 'ineligible',
            reason: `${contactName}'s phone number "${phoneValue}" is masked (contains ***), so SMS cannot be sent.`,
        };
    }

    const rawDigits = phoneValue.replace(/\D/g, '');
    if (rawDigits.length < 7) {
        return {
            status: 'ineligible',
            reason: `${contactName}'s phone number "${phoneValue}" is invalid or too short.`,
            normalizedDigits: rawDigits,
        };
    }

    if (!location?.ghlAccessToken || !location?.ghlLocationId) {
        return {
            status: 'unknown',
            reason: 'SMS eligibility check is unavailable (GoHighLevel is not fully connected).',
            normalizedDigits: rawDigits,
        };
    }

    const smsStatus = await checkGHLSMSStatus(location.id);
    if (smsStatus.status === 'configured') {
        return {
            status: 'eligible',
            normalizedDigits: rawDigits,
        };
    }

    if (smsStatus.status === 'not_configured') {
        return {
            status: 'ineligible',
            reason: smsStatus.reason || 'SMS is not configured in GoHighLevel for this location.',
            normalizedDigits: rawDigits,
        };
    }

    return {
        status: 'unknown',
        reason: smsStatus.reason || 'Could not verify SMS configuration right now.',
        normalizedDigits: rawDigits,
    };
}

async function resolvePreferredChannelTypeForPhone(
    location: { evolutionInstanceId?: string | null },
    phone: string | null | undefined
): Promise<'TYPE_WHATSAPP' | 'TYPE_SMS'> {
    const rawDigits = String(phone || '').replace(/\D/g, '');
    if (!location?.evolutionInstanceId || rawDigits.length < 7) {
        return 'TYPE_SMS';
    }

    try {
        const { evolutionClient } = await import("@/lib/evolution/client");
        const lookup = await evolutionClient.checkWhatsAppNumber(location.evolutionInstanceId, rawDigits);
        if (lookup.exists) {
            console.log(`[ChannelDetect] WhatsApp confirmed for ${rawDigits}`);
            return 'TYPE_WHATSAPP';
        }
    } catch (err) {
        console.warn(`[ChannelDetect] WhatsApp lookup failed for ${rawDigits}:`, err);
    }

    return 'TYPE_SMS';
}

/**
 * Bulk-sync all WhatsApp chats from Evolution API into local DB.
 * Safe to call multiple times — dedup handled at message, conversation, and contact levels.
 */
export async function syncAllEvolutionChats() {
    const location = await getAuthenticatedLocation();
    if (!location.evolutionInstanceId) {
        return { success: false, error: "WhatsApp not connected. Please connect via Settings." };
    }

    try {
        const { evolutionClient } = await import("@/lib/evolution/client");
        const { processNormalizedMessage } = await import("@/lib/whatsapp/sync");

        // 1. Health check
        const health = await evolutionClient.healthCheck();
        if (!health.ok) {
            return { success: false, error: "Evolution API is unreachable. Please check the server." };
        }

        // 2. Fetch all chats from the phone
        const allChats = await evolutionClient.fetchChats(location.evolutionInstanceId);
        if (!allChats || allChats.length === 0) {
            return { success: true, chatsProcessed: 0, messagesImported: 0, messagesSkipped: 0, errors: 0 };
        }

        // 3. Filter to valid WhatsApp chats only (1:1 and groups)
        const validChats = allChats.filter((chat: any) => {
            const jid = chat.id || chat.remoteJid || chat.jid;
            if (!jid) return false;
            return jid.endsWith('@s.whatsapp.net') || jid.endsWith('@g.us');
        });

        console.log(`[SyncAll] Found ${validChats.length} valid chats (filtered from ${allChats.length} total)`);

        let chatsProcessed = 0;
        let totalImported = 0;
        let totalSkipped = 0;
        let totalErrors = 0;

        // 4. Process each chat
        const MESSAGES_PER_CHAT = 30;
        const STOP_ON_DUPLICATES = 5;

        for (const chat of validChats) {
            const remoteJid = chat.id || chat.remoteJid || chat.jid;
            const isGroup = remoteJid.endsWith('@g.us');
            const phone = remoteJid.replace('@s.whatsapp.net', '').replace('@g.us', '');

            try {
                // Fetch recent messages for this chat
                const messages = await evolutionClient.fetchMessages(
                    location.evolutionInstanceId,
                    remoteJid,
                    MESSAGES_PER_CHAT
                );

                if (!messages || messages.length === 0) {
                    chatsProcessed++;
                    continue;
                }

                let consecutiveDuplicates = 0;

                for (const msg of messages) {
                    try {
                        const key = msg.key;
                        const messageContent = msg.message;
                        if (!messageContent || !key?.id) continue;

                        const isFromMe = key.fromMe;

                        // Enhanced Participant Resolution (same as syncWhatsAppHistory)
                        const realSenderPhone = (msg as any).senderPn ||
                            (key.participant?.includes('@s.whatsapp.net') ? key.participant.replace('@s.whatsapp.net', '') : null);
                        let participantPhone = realSenderPhone ||
                            (key.participant ? key.participant.replace('@s.whatsapp.net', '').replace('@lid', '') : undefined);
                        const parsedContent = parseEvolutionMessageContent(messageContent);
                        const senderName = msg.pushName || realSenderPhone || "Unknown";
                        const normalizedBody = isGroup && parsedContent.type !== 'text'
                            ? `[${senderName}]: ${parsedContent.body}`
                            : parsedContent.body;

                        const normalized: any = {
                            from: isFromMe ? location.id : phone,
                            to: isFromMe ? phone : location.id,
                            body: normalizedBody,
                            type: parsedContent.type,
                            wamId: key.id,
                            timestamp: new Date(msg.messageTimestamp ? (msg.messageTimestamp as number) * 1000 : Date.now()),
                            direction: isFromMe ? 'outbound' : 'inbound',
                            source: 'whatsapp_evolution',
                            locationId: location.id,
                            contactName: isGroup ? (chat.name || chat.subject) : (isFromMe ? undefined : (msg.pushName || realSenderPhone)),
                            isGroup: isGroup,
                            participant: participantPhone,
                            participantJid: typeof key.participant === "string" ? key.participant : undefined,
                            participantPhoneJid: typeof (msg as any).senderPn === "string" ? String((msg as any).senderPn) : undefined,
                            participantLidJid: typeof key.participant === "string" && key.participant.endsWith("@lid") ? key.participant : undefined,
                            participantDisplayName: isGroup ? (msg.pushName || realSenderPhone || undefined) : undefined,
                        };

                        if ((parsedContent.type === "image" || parsedContent.type === "audio") && location.evolutionInstanceId) {
                            normalized.__evolutionMediaAttachmentPayload = {
                                instanceName: location.evolutionInstanceId,
                                evolutionMessageData: msg,
                            };
                        }

                        const result = await processNormalizedMessage(normalized);

                        if ((parsedContent.type === "image" || parsedContent.type === "audio") && location.evolutionInstanceId) {
                            if (result?.status === 'deferred_unresolved_lid') {
                                console.log(`[SyncAll] Delaying media attachment ingest until LID resolves (${key.id})`);
                            } else {
                                void ingestEvolutionMediaAttachment({
                                    instanceName: location.evolutionInstanceId,
                                    evolutionMessageData: msg,
                                    wamId: key.id,
                                }).catch((err) => {
                                    console.error(`[SyncAll] Failed to ingest media attachment for ${key.id}:`, err);
                                });
                            }
                        }

                        if (result?.status === 'skipped') {
                            totalSkipped++;
                            consecutiveDuplicates++;
                        } else if (result?.status === 'processed') {
                            totalImported++;
                            consecutiveDuplicates = 0;
                        } else {
                            totalErrors++;
                            consecutiveDuplicates = 0;
                        }

                        // Early stop if we hit known history
                        if (consecutiveDuplicates >= STOP_ON_DUPLICATES) {
                            console.log(`[SyncAll] Chat ${remoteJid}: stopped after ${STOP_ON_DUPLICATES} consecutive dupes`);
                            break;
                        }
                    } catch (msgErr) {
                        totalErrors++;
                    }
                }

                chatsProcessed++;
            } catch (chatErr) {
                console.error(`[SyncAll] Error processing chat ${remoteJid}:`, chatErr);
                totalErrors++;
                chatsProcessed++;
            }
        }

        console.log(`[SyncAll] Complete: ${chatsProcessed} chats, ${totalImported} imported, ${totalSkipped} skipped, ${totalErrors} errors`);

        return {
            success: true,
            chatsProcessed,
            totalChats: validChats.length,
            messagesImported: totalImported,
            messagesSkipped: totalSkipped,
            errors: totalErrors
        };
    } catch (e: any) {
        console.error("[SyncAll] Failed:", e);
        return { success: false, error: e.message };
    }
}

/**
 * Fetch the list of WhatsApp chats from Evolution API for the picker UI.
 * Cross-references with existing DB conversations to mark "already synced".
 */
export async function fetchEvolutionChats() {
    const location = await getAuthenticatedLocationReadOnly({ requireGhlToken: false });
    if (!location.evolutionInstanceId) {
        return { success: false, error: "WhatsApp not connected", chats: [] };
    }

    try {
        const { evolutionClient } = await import("@/lib/evolution/client");

        const health = await evolutionClient.healthCheck();
        if (!health.ok) {
            return { success: false, error: "Evolution API unreachable", chats: [] };
        }

        const allChats = await evolutionClient.fetchChats(location.evolutionInstanceId);
        if (!allChats || allChats.length === 0) {
            return { success: true, chats: [] };
        }

        // Filter to valid chats
        const validChats = allChats.filter((chat: any) => {
            const jid = chat.id || chat.remoteJid || chat.jid;
            if (!jid) return false;
            return jid.endsWith('@s.whatsapp.net') || jid.endsWith('@g.us');
        });

        // Cross-reference with existing contacts/conversations in DB
        const existingContacts = await db.contact.findMany({
            where: { locationId: location.id, phone: { not: null } },
            select: { phone: true, name: true }
        });

        const existingConversations = await db.conversation.findMany({
            where: { locationId: location.id },
            include: { contact: { select: { phone: true } } }
        });

        // Build a set of normalized phones that already have conversations
        const syncedPhones = new Set(
            existingConversations
                .map((c: any) => c.contact?.phone?.replace(/\D/g, ''))
                .filter(Boolean)
        );

        const formatted = validChats.map((chat: any) => {
            const jid = chat.id || chat.remoteJid || chat.jid;
            const isGroup = jid.endsWith('@g.us');
            const phone = jid.replace('@s.whatsapp.net', '').replace('@g.us', '');
            const rawPhone = phone.replace(/\D/g, '');

            // Check if already synced
            const alreadySynced = syncedPhones.has(rawPhone) ||
                Array.from(syncedPhones).some(p => p?.endsWith(rawPhone) || rawPhone.endsWith(p || ''));

            // Try to find a name from existing contacts
            const matchedContact = existingContacts.find(c => {
                const cp = c.phone?.replace(/\D/g, '') || '';
                return cp === rawPhone || cp.endsWith(rawPhone) || rawPhone.endsWith(cp);
            });

            return {
                jid,
                phone: `+${phone}`,
                name: chat.name || chat.subject || chat.pushName || matchedContact?.name || `+${phone}`,
                isGroup,
                alreadySynced,
                lastMessageTimestamp: chat.conversationTimestamp || chat.lastMessageTimestamp || null
            };
        });

        // Sort: non-synced first, then by last message
        formatted.sort((a: any, b: any) => {
            if (a.alreadySynced !== b.alreadySynced) return a.alreadySynced ? 1 : -1;
            return (b.lastMessageTimestamp || 0) - (a.lastMessageTimestamp || 0);
        });

        return { success: true, chats: formatted };
    } catch (e: any) {
        console.error("[FetchChats] Failed:", e);
        return { success: false, error: e.message, chats: [] };
    }
}

/**
 * Create a new conversation for a phone number, with history backfill from Evolution.
 */
export async function startNewConversation(phone: string) {
    const location = await getAuthenticatedLocationReadOnly({ requireGhlToken: false });
    const { userId: clerkUserId } = await auth();
    const currentUser = clerkUserId
        ? await db.user.findUnique({ where: { clerkId: clerkUserId }, select: { id: true } })
        : null;
    const preferredUserId = currentUser?.id || null;

    // Normalize phone to E.164
    let normalizedPhone = phone.replace(/\s+/g, '').replace(/[-()]/g, '');
    if (!normalizedPhone.startsWith('+')) {
        normalizedPhone = `+${normalizedPhone}`;
    }

    const rawDigits = normalizedPhone.replace(/\D/g, '');
    if (rawDigits.length < 7) {
        return { success: false, error: "Phone number is too short. Please include the country code." };
    }

    const preferredChannelType = await resolvePreferredChannelTypeForPhone(location, rawDigits);

    try {
        // 1. Find or create contact
        const searchSuffix = rawDigits.length > 2 ? rawDigits.slice(-2) : rawDigits;
        const candidates = await db.contact.findMany({
            where: {
                locationId: location.id,
                phone: { contains: searchSuffix }
            }
        });

        let contact = candidates.find(c => {
            if (!c.phone) return false;
            const cp = c.phone.replace(/\D/g, '');
            return cp === rawDigits ||
                (cp.endsWith(rawDigits) && rawDigits.length >= 7) ||
                (rawDigits.endsWith(cp) && cp.length >= 7);
        });
        let isNewContact = false;

        if (!contact) {
            // Create new contact
            contact = await db.contact.create({
                data: {
                    locationId: location.id,
                    phone: normalizedPhone,
                    name: `WhatsApp ${normalizedPhone}`,
                    status: "New",
                    contactType: "Lead"
                }
            });
            isNewContact = true;
            console.log(`[NewConversation] Created new contact: ${contact.id} for ${normalizedPhone}`);
        } else {
            console.log(`[NewConversation] Found existing contact: ${contact.name} (${contact.id})`);
        }

        if (isNewContact) {
            runDetachedTask(`new_conversation_google_autosync:${contact.id}`, async () => {
                await runGoogleAutoSyncForContact({
                    locationId: location.id,
                    contactId: contact.id,
                    source: 'LEAD_CAPTURE',
                    event: 'create',
                    preferredUserId
                });
            });
        }

        // 2. Check if conversation already exists for this contact
        const existingConv = await db.conversation.findFirst({
            where: {
                locationId: location.id,
                contactId: contact.id
            }
        });

        if (existingConv) {
            console.log(`[NewConversation] Existing conversation found: ${existingConv.ghlConversationId}`);

            // Still try to backfill recent messages if Evolution is connected
            if (location.evolutionInstanceId) {
                try {
                    const { evolutionClient } = await import("@/lib/evolution/client");
                    const { processNormalizedMessage } = await import("@/lib/whatsapp/sync");

                    const whatsappPhone = rawDigits;
                    const { messages, remoteJid, candidates, fetchedFrom } = await fetchEvolutionMessagesForContactHistory({
                        evolutionClient,
                        evolutionInstanceId: location.evolutionInstanceId,
                        contact: {
                            phone: contact.phone,
                            lid: (contact as any).lid || null,
                            contactType: (contact as any).contactType || null,
                        },
                        limit: 30,
                        offset: 0,
                        logPrefix: `[NewConversation][existing:${existingConv.ghlConversationId}]`,
                    });
                    console.log(
                        `[NewConversation] Existing convo history candidates: ${candidates.join(", ") || "(none)"}; fetchedFrom=${fetchedFrom.join(", ") || "none"}; primary=${remoteJid || "none"}; found=${messages.length}`
                    );

                    let imported = 0;
                    for (const msg of (messages || [])) {
                        const key = msg.key;
                        const messageContent = msg.message;
                        if (!messageContent || !key?.id) continue;

                        const isFromMe = key.fromMe;
                        const parsedContent = parseEvolutionMessageContent(messageContent);
                        const normalized: any = {
                            from: isFromMe ? location.id : whatsappPhone,
                            to: isFromMe ? whatsappPhone : location.id,
                            body: parsedContent.body,
                            type: parsedContent.type,
                            wamId: key.id,
                            timestamp: new Date(msg.messageTimestamp ? (msg.messageTimestamp as number) * 1000 : Date.now()),
                            direction: isFromMe ? 'outbound' : 'inbound',
                            source: 'whatsapp_evolution',
                            locationId: location.id,
                            contactName: isFromMe ? undefined : msg.pushName,
                            lid: extractEvolutionLidJid(key),
                            resolvedPhone: whatsappPhone,
                        };

                        if ((parsedContent.type === "image" || parsedContent.type === "audio") && location.evolutionInstanceId) {
                            normalized.__evolutionMediaAttachmentPayload = {
                                instanceName: location.evolutionInstanceId,
                                evolutionMessageData: msg,
                            };
                        }

                        const result = await processNormalizedMessage(normalized);
                        if ((parsedContent.type === "image" || parsedContent.type === "audio") && location.evolutionInstanceId) {
                            if (result?.status === "deferred_unresolved_lid") {
                                console.log(`[NewConversation] Delaying media attachment ingest until LID resolves (${key.id})`);
                            } else {
                                void ingestEvolutionMediaAttachment({
                                    instanceName: location.evolutionInstanceId,
                                    evolutionMessageData: msg,
                                    wamId: key.id,
                                }).catch((err) => {
                                    console.error(`[NewConversation] Failed to ingest media attachment for ${key.id}:`, err);
                                });
                            }
                        }
                        if (result?.status === 'processed') imported++;
                    }

                    console.log(`[NewConversation] Backfilled ${imported} messages for existing conversation`);
                } catch (backfillErr) {
                    console.warn("[NewConversation] History backfill failed:", backfillErr);
                }
            }

            const seedResult = await seedConversationFromContactLeadText({
                conversationId: existingConv.id,
                contact,
                messageType: existingConv.lastMessageType || preferredChannelType,
                messageDate: existingConv.createdAt,
                source: "contact_bootstrap"
            });
            if (seedResult.seeded) {
                console.log(`[NewConversation] Seeded existing conversation ${existingConv.ghlConversationId} from contact.message`);
            }

            return {
                success: true,
                conversationId: existingConv.ghlConversationId,
                isNew: false,
                contactName: contact.name
            };
        }

        // 3. Create new conversation
        const syntheticId = `wa_${Date.now()}_${contact.id}`;
        const conversation = await db.conversation.create({
            data: {
                ghlConversationId: syntheticId,
                locationId: location.id,
                contactId: contact.id,
                lastMessageBody: null,
                lastMessageAt: new Date(0), // Epoch — will sort to bottom until a real message arrives
                lastMessageType: preferredChannelType,
                unreadCount: 0,
                status: 'open'
            }
        });

        console.log(`[NewConversation] Created conversation: ${conversation.ghlConversationId}`);

        // 4. Try to backfill history from Evolution
        let messagesImported = 0;
        if (location.evolutionInstanceId) {
            try {
                const { evolutionClient } = await import("@/lib/evolution/client");
                const { processNormalizedMessage } = await import("@/lib/whatsapp/sync");

                const whatsappPhone = rawDigits;
                const { messages, remoteJid, candidates, fetchedFrom } = await fetchEvolutionMessagesForContactHistory({
                    evolutionClient,
                    evolutionInstanceId: location.evolutionInstanceId,
                    contact: {
                        phone: contact.phone,
                        lid: (contact as any).lid || null,
                        contactType: (contact as any).contactType || null,
                    },
                    limit: 30,
                    offset: 0,
                    logPrefix: `[NewConversation][new:${conversation.ghlConversationId}]`,
                });
                console.log(
                    `[NewConversation] New convo history candidates: ${candidates.join(", ") || "(none)"}; fetchedFrom=${fetchedFrom.join(", ") || "none"}; primary=${remoteJid || "none"}; found=${messages.length}`
                );

                for (const msg of (messages || [])) {
                    const key = msg.key;
                    const messageContent = msg.message;
                    if (!messageContent || !key?.id) continue;

                    const isFromMe = key.fromMe;
                    const parsedContent = parseEvolutionMessageContent(messageContent);
                    const normalized: any = {
                        from: isFromMe ? location.id : whatsappPhone,
                        to: isFromMe ? whatsappPhone : location.id,
                        body: parsedContent.body,
                        type: parsedContent.type,
                        wamId: key.id,
                        timestamp: new Date(msg.messageTimestamp ? (msg.messageTimestamp as number) * 1000 : Date.now()),
                        direction: isFromMe ? 'outbound' : 'inbound',
                        source: 'whatsapp_evolution',
                        locationId: location.id,
                        contactName: isFromMe ? undefined : msg.pushName,
                        lid: extractEvolutionLidJid(key),
                        resolvedPhone: whatsappPhone,
                    };

                    if ((parsedContent.type === "image" || parsedContent.type === "audio") && location.evolutionInstanceId) {
                        normalized.__evolutionMediaAttachmentPayload = {
                            instanceName: location.evolutionInstanceId,
                            evolutionMessageData: msg,
                        };
                    }

                    const result = await processNormalizedMessage(normalized);
                    if ((parsedContent.type === "image" || parsedContent.type === "audio") && location.evolutionInstanceId) {
                        if (result?.status === "deferred_unresolved_lid") {
                            console.log(`[NewConversation] Delaying media attachment ingest until LID resolves (${key.id})`);
                        } else {
                            void ingestEvolutionMediaAttachment({
                                instanceName: location.evolutionInstanceId,
                                evolutionMessageData: msg,
                                wamId: key.id,
                            }).catch((err) => {
                                console.error(`[NewConversation] Failed to ingest media attachment for ${key.id}:`, err);
                            });
                        }
                    }
                    if (result?.status === 'processed') messagesImported++;
                }

                console.log(`[NewConversation] Backfilled ${messagesImported} messages for new conversation`);
            } catch (backfillErr) {
                console.warn("[NewConversation] History backfill failed:", backfillErr);
            }
        }

        const seedResult = await seedConversationFromContactLeadText({
            conversationId: conversation.id,
            contact,
            messageType: conversation.lastMessageType || preferredChannelType,
            messageDate: conversation.createdAt,
            source: "contact_bootstrap"
        });
        if (seedResult.seeded) {
            console.log(`[NewConversation] Seeded new conversation ${conversation.ghlConversationId} from contact.message`);
        }

        return {
            success: true,
            conversationId: conversation.ghlConversationId,
            isNew: true,
            contactName: contact.name,
            messagesImported
        };
    } catch (e: any) {
        console.error("[NewConversation] Failed:", e);
        return { success: false, error: e.message };
    }
}

// ------------------------------------------------------------------
// Paste Lead Feature Actions
// ------------------------------------------------------------------

const REQUIREMENT_DISTRICTS = ["Paphos", "Nicosia", "Famagusta", "Limassol", "Larnaca"] as const;
const REQUIREMENT_PRICE_OPTIONS = [
    200, 300, 400, 500, 600, 700, 800, 900, 1000, 1500, 2000, 3000, 5000, 50000, 75000, 100000, 125000, 150000, 175000
] as const;

function mergeUniqueText(existing?: string | null, incoming?: string | null): string | undefined {
    const next = incoming?.trim();
    if (!next) return existing || undefined;
    const prev = existing?.trim();
    if (!prev) return next;
    if (prev.toLowerCase().includes(next.toLowerCase())) return prev;
    return `${prev}\n${next}`;
}

function extractPropertyRefsFromLeadText(text: string): string[] {
    const refs = new Set<string>();
    const refRegex = /\b(?:ref(?:erence)?[.:#\s-]*)?([A-Z]{1,4}\d{2,6}|[A-Z]{2,6}-\d{2,6})\b/gi;
    let match: RegExpExecArray | null;

    while ((match = refRegex.exec(text)) !== null) {
        refs.add(match[1].toUpperCase());
    }

    return Array.from(refs);
}

function extractPropertySlugsFromLeadUrls(text: string): string[] {
    const slugs = new Set<string>();
    const urlRegex = /https?:\/\/[^\s]+/gi;
    const matches = text.match(urlRegex) || [];

    for (const rawUrl of matches) {
        try {
            const parsed = new URL(rawUrl);
            const parts = parsed.pathname.split("/").filter(Boolean);
            if (parts.length === 0) continue;

            const last = parts[parts.length - 1];
            if (last) slugs.add(last.toLowerCase());
        } catch {
            // Ignore invalid URLs
        }
    }

    return Array.from(slugs);
}

function parseNumericToken(token: string): number | null {
    const cleaned = token.replace(/[, ]/g, "").toLowerCase();
    if (!cleaned) return null;

    const hasK = cleaned.endsWith("k");
    const base = hasK ? cleaned.slice(0, -1) : cleaned;
    const value = Number(base);
    if (!Number.isFinite(value)) return null;

    return hasK ? Math.round(value * 1000) : Math.round(value);
}

function parseBudgetRange(raw?: string | null): { min?: number; max?: number } {
    if (!raw) return {};
    const text = raw.toLowerCase();
    const tokens = text.match(/\d+(?:[.,]\d+)?\s*[k]?/g) || [];
    const values = tokens
        .map(parseNumericToken)
        .filter((v): v is number => Number.isFinite(v) && !!v)
        .map(v => Math.max(0, Math.round(v)));

    if (values.length === 0) return {};

    if (/[–—-]|\bto\b/.test(text) && values.length >= 2) {
        const min = Math.min(values[0], values[1]);
        const max = Math.max(values[0], values[1]);
        return { min, max };
    }

    return { max: values[0] };
}

function formatPriceOption(value: number): string {
    return `€${value.toLocaleString("en-US")}`;
}

function mapToMinPriceOption(value?: number): string | null {
    if (!value || value <= 0) return null;
    const eligible = REQUIREMENT_PRICE_OPTIONS.filter(p => p <= value);
    const selected = eligible.length > 0 ? eligible[eligible.length - 1] : REQUIREMENT_PRICE_OPTIONS[0];
    return formatPriceOption(selected);
}

function mapToMaxPriceOption(value?: number): string | null {
    if (!value || value <= 0) return null;
    const eligible = REQUIREMENT_PRICE_OPTIONS.filter(p => p <= value);
    const selected = eligible.length > 0 ? eligible[eligible.length - 1] : REQUIREMENT_PRICE_OPTIONS[0];
    return formatPriceOption(selected);
}

function normalizeRequirementDistrict(raw?: string | null): string | null {
    if (!raw) return null;
    const text = raw.toLowerCase();
    for (const district of REQUIREMENT_DISTRICTS) {
        if (text.includes(district.toLowerCase())) return district;
    }
    return null;
}

function normalizeRequirementBedrooms(raw?: string | null): string | null {
    if (!raw) return null;
    const match = raw.match(/\d+/);
    if (!match) return null;
    const count = Number(match[0]);
    if (!Number.isFinite(count) || count <= 0) return null;
    if (count >= 5) return "5+ Bedrooms";
    return `${count}+ Bedrooms`;
}

function extractBedroomSummary(raw?: string | null): string | null {
    if (!raw) return null;
    const match = raw.match(/\d+\+?/);
    if (!match) return null;
    return `${match[0]}Bdr`;
}

function abbreviatePropertyType(raw?: string | null): string | null {
    const text = String(raw || "").trim();
    if (!text) return null;
    const lower = text.toLowerCase();

    if (lower === "apartment") return "Apt";
    if (lower === "appartment") return "Apt";
    if (lower === "apt") return "Apt";
    if (lower === "bedroom") return "Bdr";
    if (lower === "bedrooms") return "Bdr";
    if (lower.includes("apartment")) return text.replace(/apartment/gi, "Apt");
    if (lower.includes("appartment")) return text.replace(/appartment/gi, "Apt");
    if (lower.includes("bedroom")) return text.replace(/bedrooms?/gi, "Bdr");

    return text;
}

function normalizeWhitespace(value?: string | null): string {
    return String(value || "").replace(/\s+/g, " ").trim();
}

function splitLeadPersonName(contact: ParsedLeadData["contact"] | undefined) {
    const explicitFirst = normalizeWhitespace(contact?.firstName);
    const explicitLast = normalizeWhitespace(contact?.lastName);
    const fallbackName = normalizeWhitespace(contact?.name);

    if (explicitFirst || explicitLast) {
        return {
            firstName: explicitFirst,
            lastName: explicitLast,
            fullName: normalizeWhitespace(`${explicitFirst} ${explicitLast}`),
        };
    }

    if (!fallbackName) {
        return { firstName: "", lastName: "", fullName: "" };
    }

    const parts = fallbackName.split(/\s+/).filter(Boolean);
    if (parts.length === 1) {
        return {
            firstName: parts[0],
            lastName: "",
            fullName: parts[0],
        };
    }

    return {
        firstName: parts[0],
        lastName: parts.slice(1).join(" "),
        fullName: fallbackName,
    };
}

function inferLeadContactRole(rawLeadText: string, parsedRole?: string | null): "Lead" | "Owner" | "Agent" {
    const normalizedRole = normalizeWhitespace(parsedRole);
    if (normalizedRole === "Lead" || normalizedRole === "Owner" || normalizedRole === "Agent") {
        return normalizedRole;
    }

    const text = rawLeadText.toLowerCase();
    if (/\bowner\b/.test(text)) return "Owner";
    if (/\bagent\b/.test(text)) return "Agent";
    return "Lead";
}

function formatLeadGoalLabel(status?: "For Rent" | "For Sale" | null): "Rent" | "Sale" | "" {
    if (status === "For Rent") return "Rent";
    if (status === "For Sale") return "Sale";
    return "";
}

function shouldUseMatchedPropertyTitle(title?: string | null): boolean {
    const text = normalizeWhitespace(title).toLowerCase();
    if (!text) return false;
    return text.includes("#")
        || text.includes("block")
        || text.includes("residence")
        || text.includes("residences");
}

function buildStructuredLeadPropertySummary(args: {
    matchedProperty?: ResolvedLeadPropertyMatch;
    requirements?: ParsedLeadData["requirements"];
}): string {
    const matchedProperty = args.matchedProperty || null;
    if (matchedProperty?.title && shouldUseMatchedPropertyTitle(matchedProperty.title)) {
        return normalizeWhitespace(matchedProperty.title);
    }

    const bedrooms = extractBedroomSummary(args.requirements?.bedrooms);
    const propertyType = abbreviatePropertyType(args.requirements?.type);
    const location = normalizeWhitespace(
        matchedProperty?.propertyLocation
        || matchedProperty?.city
        || args.requirements?.location
    );

    return [bedrooms, propertyType, location].filter(Boolean).join(" ").trim();
}

function buildStructuredLeadDisplayName(args: {
    contact: ParsedLeadData["contact"];
    rawLeadText: string;
    inferredStatus: "For Rent" | "For Sale" | null;
    matchedProperty?: ResolvedLeadPropertyMatch;
    requirements?: ParsedLeadData["requirements"];
}): string {
    const person = splitLeadPersonName(args.contact);
    const personName = person.fullName
        || normalizeWhitespace(args.contact?.name)
        || normalizeWhitespace(args.contact?.email)
        || normalizeWhitespace(args.contact?.phone)
        || "Lead";
    const refs = extractPropertyRefsFromLeadText(args.rawLeadText);

    if (refs.length > 1) {
        return normalizeWhitespace(`${personName} ${refs.join(", ")}`);
    }

    const role = inferLeadContactRole(args.rawLeadText, args.contact?.role);
    const goal = formatLeadGoalLabel(args.inferredStatus);
    const singleRef = refs[0] || normalizeWhitespace(args.matchedProperty?.reference);
    const propertySummary = refs.length <= 1
        ? buildStructuredLeadPropertySummary({
            matchedProperty: args.matchedProperty,
            requirements: args.requirements,
        })
        : "";

    return [personName, role, goal, singleRef, propertySummary].filter(Boolean).join(" ").trim();
}

function inferRequirementStatusFromLead(rawLeadText: string, budgetText?: string | null): "For Rent" | "For Sale" | null {
    const text = `${rawLeadText}\n${budgetText || ""}`.toLowerCase();
    if (
        text.includes("for rent") ||
        text.includes("to rent") ||
        text.includes("goal\tto rent") ||
        text.includes("goal: to rent") ||
        text.includes("/month") ||
        text.includes(" per month") ||
        text.includes("unfurnished")
    ) {
        return "For Rent";
    }
    if (
        text.includes("for sale") ||
        text.includes("to buy") ||
        text.includes("purchase")
    ) {
        return "For Sale";
    }
    return null;
}

function inferRequirementStatusFromMatchedProperty(property: {
    goal?: string | null;
    title?: string | null;
    slug?: string | null;
}): "For Rent" | "For Sale" | null {
    const text = `${property.title || ""} ${property.slug || ""}`.toLowerCase();
    if (text.includes("for-rent") || text.includes("for rent") || text.includes("rent")) return "For Rent";
    if (text.includes("for-sale") || text.includes("for sale") || text.includes("sale")) return "For Sale";

    if (property.goal === "RENT") return "For Rent";
    if (property.goal === "SALE") return "For Sale";
    return null;
}

async function resolveLeadPropertyMatch(locationId: string, rawLeadText: string) {
    const refs = extractPropertyRefsFromLeadText(rawLeadText);
    const slugs = extractPropertySlugsFromLeadUrls(rawLeadText);

    if (refs.length === 0 && slugs.length === 0) return null;

    const orClauses: any[] = [];
    if (refs.length > 0) {
        orClauses.push({ reference: { in: refs } });
        for (const ref of refs) {
            orClauses.push({ reference: { contains: ref, mode: "insensitive" } });
            orClauses.push({ slug: { contains: ref.toLowerCase(), mode: "insensitive" } });
            orClauses.push({ title: { contains: ref, mode: "insensitive" } });
        }
    }
    if (slugs.length > 0) {
        orClauses.push({ slug: { in: slugs } });
    }

    const candidates = await db.property.findMany({
        where: {
            locationId,
            OR: orClauses
        },
        select: {
            id: true,
            reference: true,
            slug: true,
            title: true,
            goal: true,
            propertyLocation: true,
            city: true
        },
        take: 10
    });

    if (candidates.length === 0) return null;

    const refSet = new Set(refs.map(r => r.toUpperCase()));
    const slugSet = new Set(slugs.map(s => s.toLowerCase()));

    const exactRef = candidates.find(c => c.reference && refSet.has(c.reference.toUpperCase()));
    if (exactRef) return exactRef;

    const exactSlug = candidates.find(c => slugSet.has(c.slug.toLowerCase()));
    if (exactSlug) return exactSlug;

    const fuzzyRef = candidates.find(c => refs.some(ref => c.slug.toLowerCase().includes(ref.toLowerCase())));
    if (fuzzyRef) return fuzzyRef;

    return candidates[0];
}

const LeadParsingSchema = z.object({
    contact: z.object({
        name: z.string().nullable().optional(),
        firstName: z.string().nullable().optional(),
        lastName: z.string().nullable().optional(),
        role: z.enum(["Lead", "Owner", "Agent"]).nullable().optional(),
        phone: z.string().nullable().optional(),
        countryCode: z.string().nullable().optional(),
        email: z.string().nullable().optional(),
    }),
    requirements: z.object({
        budget: z.string().nullable().optional(),
        location: z.string().nullable().optional(),
        type: z.string().nullable().optional(),
        bedrooms: z.string().nullable().optional(),
    }),
    messageContent: z.string().nullable().optional().describe("The actual message text written by the lead. Null if only metadata/notes/summary."),
    internalNotes: z.string().nullable().optional().describe("Summary of the lead request or context if no direct message."),
    source: z.string().nullable().optional().describe("Inferred source e.g. Bazaraki, Facebook, WhatsApp")
});

export type ParsedLeadData = z.infer<typeof LeadParsingSchema>;

interface LeadAnalysisTrace {
    traceId: string; // Temporary ID for client side reference if needed
    start: number;
    end: number;
    model: string;
    thoughtSummary: string;
    llmRequest: {
        model: string;
        prompt: string;
        options: {
            jsonMode: boolean;
            maxOutputTokens?: number;
            thinkingBudget?: number;
        };
    };
    llmResponse: {
        rawText: string;
        cleanJson: string;
        parsed: ParsedLeadData;
        usage: {
            promptTokens: number;
            completionTokens: number;
            totalTokens: number;
            thoughtsTokens: number;
            toolUsePromptTokens: number;
            cachedContentTokens: number;
            raw: string;
        };
    };
    estimatedCost: {
        usd: number;
        method: string;
        confidence: string;
        breakdown: {
            promptTokens: number;
            completionTokens: number;
            totalTokens: number;
            thoughtsTokens: number;
            toolUsePromptTokens: number;
            inferredOutputTokens: number;
            billableInputTokens: number;
            billableOutputTokens: number;
            inputRatePerMillion: number;
            outputRatePerMillion: number;
        };
    };
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
}

export interface LeadParseTelemetry {
    traceId: string;
    model: string;
    latencyMs: number;
}

type LeadParseWithTraceResult =
    | { success: true; data: ParsedLeadData; telemetry: LeadParseTelemetry; trace: LeadAnalysisTrace; normalizedInput: string }
    | { success: false; error: string };

type ResolvedLeadPropertyMatch = Awaited<ReturnType<typeof resolveLeadPropertyMatch>>;

async function persistLeadAnalysisTraceRecord(args: {
    conversationId: string;
    locationId: string;
    trace: LeadAnalysisTrace;
    matchedProperty: ResolvedLeadPropertyMatch;
}) {
    const { conversationId, locationId, trace, matchedProperty } = args;
    const estimatedCost = trace.estimatedCost || (() => {
        const fallbackEstimate = calculateRunCostFromUsage(trace.model || 'default', {
            promptTokens: trace.promptTokens || 0,
            completionTokens: trace.completionTokens || 0,
            totalTokens: trace.totalTokens || 0
        });
        return {
            usd: fallbackEstimate.amount,
            method: fallbackEstimate.method,
            confidence: fallbackEstimate.confidence,
            breakdown: fallbackEstimate.breakdown
        };
    })();

    await db.agentExecution.create({
        data: {
            conversationId,
            locationId,
            traceId: trace.traceId,
            spanId: trace.traceId,
            taskTitle: "Analyze Lead Text",
            status: "success",
            taskStatus: "success",
            skillName: "lead_parser",
            intent: "analysis",
            model: trace.model,
            thoughtSummary: trace.thoughtSummary,
            thoughtSteps: [
                {
                    step: 1,
                    description: "LLM request payload",
                    conclusion: "Captured full request sent to model",
                    data: trace.llmRequest
                },
                {
                    step: 2,
                    description: "LLM response payload",
                    conclusion: "Captured raw response and parsed JSON output",
                    data: trace.llmResponse
                },
                {
                    step: 3,
                    description: "Usage & cost estimate",
                    conclusion: `Estimated run cost (${estimatedCost.confidence} confidence)`,
                    data: estimatedCost
                },
                {
                    step: 4,
                    description: "Import enrichment",
                    conclusion: matchedProperty
                        ? `Resolved property link: ${matchedProperty.reference || matchedProperty.slug}`
                        : "No deterministic property reference match found during import",
                    data: matchedProperty
                        ? {
                            propertyId: matchedProperty.id,
                            reference: matchedProperty.reference,
                            slug: matchedProperty.slug,
                            goal: matchedProperty.goal
                        }
                        : null
                }
            ],
            toolCalls: [
                {
                    tool: "gemini.generateContent",
                    arguments: trace.llmRequest,
                    result: trace.llmResponse,
                    error: null
                },
                {
                    tool: "lead_import.resolve_property",
                    arguments: {
                        source: "paste_lead",
                        locationId
                    },
                    result: matchedProperty
                        ? {
                            id: matchedProperty.id,
                            reference: matchedProperty.reference,
                            slug: matchedProperty.slug,
                            goal: matchedProperty.goal
                        }
                        : null,
                    error: null
                }
            ],
            promptTokens: trace.promptTokens,
            completionTokens: trace.completionTokens,
            totalTokens: trace.totalTokens,
            cost: estimatedCost.usd,
            latencyMs: trace.end - trace.start,
            createdAt: new Date(trace.start)
        }
    });
}

const DEFAULT_LEGACY_CRM_LEAD_SUBJECT_PATTERNS = [
    "you have been assigned a new lead",
    "you need to follow up on a lead",
] as const;

const LEGACY_CRM_LEAD_LABELS = [
    "Name",
    "Tel",
    "Email",
    "Goal",
    "Source",
    "Follow Up",
    "Next Action",
    "Notes",
] as const;

type LegacyCrmLeadEmailClassification = "new_lead" | "follow_up";
type LegacyCrmLeadSenderMatchMode = "exact" | "domain" | "unconfigured" | "none";

interface LegacyCrmLeadEmailFields {
    name?: string | null;
    tel?: string | null;
    email?: string | null;
    goal?: string | null;
    source?: string | null;
    followUp?: string | null;
    nextAction?: string | null;
    notes?: string | null;
}

interface LegacyCrmLeadEmailParseResult {
    matched: boolean;
    reason?: string;
    classification?: LegacyCrmLeadEmailClassification;
    senderEmail: string | null;
    senderMatchMode: LegacyCrmLeadSenderMatchMode;
    subject: string | null;
    bodyText: string;
    leadUrl: string | null;
    leadId: string | null;
    fields: LegacyCrmLeadEmailFields;
    parsedLeadData?: ParsedLeadData;
}

function decodeHtmlEntitiesBasic(input: string): string {
    if (!input) return "";
    const named: Record<string, string> = {
        nbsp: " ",
        amp: "&",
        lt: "<",
        gt: ">",
        quot: "\"",
        apos: "'",
        ndash: "-",
        mdash: "-",
    };

    return input
        .replace(/&([a-zA-Z]+);/g, (full, name) => named[name.toLowerCase()] ?? full)
        .replace(/&#(\d+);/g, (_, num) => {
            const code = Number(num);
            return Number.isFinite(code) ? String.fromCharCode(code) : _;
        })
        .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
            const code = Number.parseInt(hex, 16);
            return Number.isFinite(code) ? String.fromCharCode(code) : _;
        });
}

function stripHtmlForLeadParsing(input: string): string {
    if (!input) return "";

    const withLineBreaks = input
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<(br|\/p|\/div|\/tr|\/li|\/ul|\/ol|\/table|\/tbody|\/thead|\/td|\/th|\/h\d)\b[^>]*>/gi, "\n")
        .replace(/<[^>]+>/g, " ");

    return decodeHtmlEntitiesBasic(withLineBreaks)
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function normalizeEmailFromHeader(input?: string | null): string | null {
    const raw = String(input || "").trim();
    if (!raw) return null;
    const match = raw.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    return match ? match[1].toLowerCase() : null;
}

function matchLegacyCrmLeadSender(
    senderEmail: string | null,
    config: { senders: string[]; domains: string[] }
): LegacyCrmLeadSenderMatchMode {
    if (!senderEmail) return "none";

    const senders = (config.senders || []).map((s) => s.toLowerCase().trim()).filter(Boolean);
    const domains = (config.domains || []).map((d) => d.toLowerCase().replace(/^@/, "").trim()).filter(Boolean);

    if (senders.length === 0 && domains.length === 0) return "unconfigured";
    if (senders.includes(senderEmail)) return "exact";

    const senderDomain = senderEmail.split("@")[1] || "";
    if (domains.some((d) => senderDomain === d || senderDomain.endsWith(`.${d}`))) {
        return "domain";
    }

    return "none";
}

function extractLegacyCrmLeadUrl(input: string): string | null {
    if (!input) return null;
    const matches = input.match(/https?:\/\/[^\s"'<>]+/gi) || [];
    const normalized = matches
        .map((u) => decodeHtmlEntitiesBasic(u).replace(/[)\],.;]+$/, ""))
        .filter(Boolean);

    const prioritized = normalized.find((u) => /\/admin\/leads\//i.test(u))
        || normalized.find((u) => /\/leads\//i.test(u))
        || null;

    return prioritized;
}

function extractLegacyCrmLeadId(url: string | null): string | null {
    if (!url) return null;
    const patterns = [
        /\/admin\/leads\/(\d+)(?:\/|$|\?)/i,
        /\/admin\/leads\/[^/]+\/(\d+)(?:\/|$|\?)/i,
        /[?&](?:lead_id|leadId|id)=(\d+)/i,
    ];

    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match?.[1]) return match[1];
    }
    return null;
}

function extractLegacyCrmLeadFields(bodyText: string): LegacyCrmLeadEmailFields {
    if (!bodyText) return {};

    let body = bodyText;
    const leadOverviewIndex = body.toLowerCase().indexOf("lead overview");
    if (leadOverviewIndex >= 0) {
        body = body.slice(leadOverviewIndex + "lead overview".length).trim();
    }

    const footerMarkers = [
        "kind regards",
        "always at your disposal",
        "down town cyprus sales & rentals",
    ];
    for (const marker of footerMarkers) {
        const idx = body.toLowerCase().indexOf(marker);
        if (idx > 0) {
            body = body.slice(0, idx).trim();
            break;
        }
    }

    const labelRegex = /\b(Name|Tel|Email|Goal|Source|Follow Up|Next Action|Notes)\b\s*/g;
    const matches: Array<{ label: string; index: number; fullLength: number }> = [];
    let m: RegExpExecArray | null;

    while ((m = labelRegex.exec(body)) !== null) {
        matches.push({
            label: m[1],
            index: m.index,
            fullLength: m[0].length,
        });
    }

    if (matches.length === 0) return {};

    const rawValues: Record<string, string | null> = {};
    for (let i = 0; i < matches.length; i++) {
        const current = matches[i];
        const next = matches[i + 1];
        const start = current.index + current.fullLength;
        const end = next ? next.index : body.length;
        const value = body.slice(start, end).replace(/\s+/g, " ").trim();
        rawValues[current.label] = value || null;
    }

    const clean = (label: string, value?: string | null) => {
        let next = String(value || "").replace(/\s+/g, " ").trim();
        if (!next) return null;

        // Preview fallbacks can truncate and sometimes bleed labels into values.
        for (const knownLabel of LEGACY_CRM_LEAD_LABELS) {
            if (knownLabel === label) continue;
            const idx = next.indexOf(` ${knownLabel} `);
            if (idx > 0) {
                next = next.slice(0, idx).trim();
            }
        }

        if (!next) return null;
        if (label === "Email" && !next.includes("@")) return null;
        if (label === "Tel" && !/\d/.test(next)) return null;

        return next;
    };

    const fields: LegacyCrmLeadEmailFields = {
        name: clean("Name", rawValues["Name"]),
        tel: clean("Tel", rawValues["Tel"]),
        email: clean("Email", rawValues["Email"]),
        goal: clean("Goal", rawValues["Goal"]),
        source: clean("Source", rawValues["Source"]),
        followUp: clean("Follow Up", rawValues["Follow Up"]),
        nextAction: clean("Next Action", rawValues["Next Action"]),
        notes: clean("Notes", rawValues["Notes"]),
    };

    // Fallback split when Follow Up leaks into Source or vice versa due truncation.
    if (fields.source && !fields.followUp) {
        const idx = fields.source.toLowerCase().indexOf(" follow up ");
        if (idx > 0) {
            fields.followUp = fields.source.slice(idx + 1).trim();
            fields.source = fields.source.slice(0, idx).trim();
        }
    }
    if (fields.followUp && !fields.nextAction) {
        const idx = fields.followUp.toLowerCase().indexOf(" next action ");
        if (idx > 0) {
            fields.nextAction = fields.followUp.slice(idx + 1).trim();
            fields.followUp = fields.followUp.slice(0, idx).trim();
        }
    }

    return fields;
}

function buildParsedLeadDataFromLegacyCrmEmail(
    classification: LegacyCrmLeadEmailClassification,
    fields: LegacyCrmLeadEmailFields,
    leadUrl: string | null
): ParsedLeadData {
    const sourceLabel = fields.source?.trim() || null;
    const source = sourceLabel ? `Old CRM (${sourceLabel})` : "Old CRM Email";

    const notes: string[] = [
        classification === "follow_up"
            ? "Old CRM follow-up reminder email notification"
            : "Old CRM new lead assignment email notification",
    ];

    if (fields.goal) notes.push(`Goal: ${fields.goal}`);
    if (sourceLabel) notes.push(`Source: ${sourceLabel}`);
    if (fields.followUp) notes.push(`Follow Up: ${fields.followUp}`);
    if (fields.nextAction) notes.push(`Next Action: ${fields.nextAction}`);
    if (fields.notes) notes.push(`Notes: ${fields.notes}`);
    if (leadUrl) notes.push(`Old CRM Lead URL: ${leadUrl}`);

    return {
        contact: {
            name: fields.name || null,
            phone: fields.tel || null,
            email: fields.email || null,
        },
        requirements: {
            budget: null,
            location: null,
            type: null,
            bedrooms: null,
        },
        messageContent: null,
        internalNotes: notes.join("\n"),
        source,
    };
}

function parseLegacyCrmFollowUpDate(input?: string | null): Date | null {
    if (!input) return null;
    const normalized = input
        .replace(/next action[\s\S]*$/i, "")
        .replace(/\s+/g, " ")
        .trim();
    if (!normalized) return null;

    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
}

function parseLegacyCrmLeadNotificationEmail(args: {
    subject?: string | null;
    emailFrom?: string | null;
    body?: string | null;
    configuredSenders?: string[] | null;
    configuredDomains?: string[] | null;
    configuredSubjectPatterns?: string[] | null;
}): LegacyCrmLeadEmailParseResult {
    const senderEmail = normalizeEmailFromHeader(args.emailFrom);
    const subject = String(args.subject || "").trim() || null;
    const bodyRaw = String(args.body || "");
    const bodyText = stripHtmlForLeadParsing(bodyRaw);

    const senderMatchMode = matchLegacyCrmLeadSender(senderEmail, {
        senders: (args.configuredSenders || []) as string[],
        domains: (args.configuredDomains || []) as string[],
    });

    const subjectPatterns = ((args.configuredSubjectPatterns || []) as string[])
        .map((s) => String(s || "").trim().toLowerCase())
        .filter(Boolean);
    const effectiveSubjectPatterns = subjectPatterns.length > 0
        ? subjectPatterns
        : Array.from(DEFAULT_LEGACY_CRM_LEAD_SUBJECT_PATTERNS);

    const subjectLower = (subject || "").toLowerCase();
    const subjectMatched = effectiveSubjectPatterns.some((pattern) => subjectLower.includes(pattern));
    const hasLeadOverview = bodyText.toLowerCase().includes("lead overview");

    if (!subjectMatched) {
        return {
            matched: false,
            reason: "Subject does not match legacy CRM lead notification patterns",
            senderEmail,
            senderMatchMode,
            subject,
            bodyText,
            leadUrl: extractLegacyCrmLeadUrl(`${bodyRaw} ${bodyText}`),
            leadId: null,
            fields: {},
        };
    }

    if (!hasLeadOverview) {
        return {
            matched: false,
            reason: "Body does not contain 'Lead Overview' marker",
            senderEmail,
            senderMatchMode,
            subject,
            bodyText,
            leadUrl: extractLegacyCrmLeadUrl(`${bodyRaw} ${bodyText}`),
            leadId: null,
            fields: {},
        };
    }

    if (senderMatchMode === "none") {
        return {
            matched: false,
            reason: "Sender does not match configured legacy CRM notifier email/domain",
            senderEmail,
            senderMatchMode,
            subject,
            bodyText,
            leadUrl: extractLegacyCrmLeadUrl(`${bodyRaw} ${bodyText}`),
            leadId: null,
            fields: {},
        };
    }

    const classification: LegacyCrmLeadEmailClassification = subjectLower.includes("follow up on a lead")
        ? "follow_up"
        : "new_lead";

    const fields = extractLegacyCrmLeadFields(bodyText);
    const leadUrl = extractLegacyCrmLeadUrl(`${bodyRaw} ${bodyText}`);
    const leadId = extractLegacyCrmLeadId(leadUrl);

    if (!fields.name && !fields.tel && !fields.email) {
        return {
            matched: false,
            reason: "Could not extract key lead identity fields (name/phone/email)",
            senderEmail,
            senderMatchMode,
            subject,
            bodyText,
            leadUrl,
            leadId,
            fields,
        };
    }

    return {
        matched: true,
        classification,
        senderEmail,
        senderMatchMode,
        subject,
        bodyText,
        leadUrl,
        leadId,
        fields,
        parsedLeadData: buildParsedLeadDataFromLegacyCrmEmail(classification, fields, leadUrl),
    };
}

export async function improveInternalNoteText(input: z.infer<typeof ImproveNoteInputSchema>) {
    const parsed = ImproveNoteInputSchema.safeParse(input || {});
    if (!parsed.success) {
        return { success: false as const, error: "Invalid note improvement request." };
    }

    const {
        text,
        noteType,
        conversationId,
        contactId,
        modelOverride,
        context,
    } = parsed.data;

    try {
        const location = await getAuthenticatedLocationReadOnly({ requireGhlToken: false });
        const requestedConversationId = String(conversationId || "").trim();
        const requestedContactId = String(contactId || "").trim();

        let conversation = null as Awaited<ReturnType<typeof resolveConversationForCrmLog>> | null;
        if (requestedConversationId) {
            conversation = await resolveConversationForCrmLog(location.id, requestedConversationId);
        }

        let contact =
            conversation?.contact || null;

        if (!contact && requestedContactId) {
            const directContact = await db.contact.findFirst({
                where: {
                    locationId: location.id,
                    OR: [
                        { id: requestedContactId },
                        { ghlContactId: requestedContactId },
                    ],
                },
                select: {
                    id: true,
                    firstName: true,
                    name: true,
                    email: true,
                    phone: true,
                },
            });
            if (directContact) {
                contact = directContact;
            }
        }

        if (!conversation && contact && "id" in contact && contact.id) {
            const fallbackConversation = await db.conversation.findFirst({
                where: {
                    locationId: location.id,
                    contactId: contact.id,
                },
                orderBy: { lastMessageAt: "desc" },
                select: {
                    id: true,
                    ghlConversationId: true,
                    contactId: true,
                    contact: {
                        select: {
                            firstName: true,
                            name: true,
                            email: true,
                            phone: true,
                        },
                    },
                },
            });
            if (fallbackConversation) {
                conversation = fallbackConversation as any;
                contact = fallbackConversation.contact;
            }
        }

        const contactFirstName = deriveOptionalFirstName(
            contact?.firstName,
            contact?.name,
            contact?.email
        );

        let resolvedDefaultModel = "";
        try {
            const { resolveAiModelDefault } = await import("@/lib/ai/fetch-models");
            resolvedDefaultModel = await resolveAiModelDefault(location.id, "general");
        } catch (resolveError) {
            console.warn("[improveInternalNoteText] Failed to resolve AI model default:", resolveError);
        }

        const modelId = typeof modelOverride === "string" && modelOverride.trim()
            ? modelOverride.trim()
            : (resolvedDefaultModel || getModelForTask("simple_generation"));
        const startedAt = Date.now();
        const prompt = buildImproveNotePrompt({
            noteType,
            text,
            contactFirstName: contactFirstName || undefined,
            context,
        });

        const { text: rawOutput, usage } = await callLLMWithMetadata(
            modelId,
            prompt,
            undefined
        );
        const latencyMs = Date.now() - startedAt;
        const normalizedOutput = normalizeImprovedNoteOutput(rawOutput, text);
        const improvedText = replaceContactIdentityMentionsWithFirstName(
            normalizedOutput,
            contact
        );

        if (conversation?.id) {
            try {
                await persistSelectionAiExecution({
                    conversationInternalId: conversation.id,
                    taskTitle: noteType === "viewing" ? "Improve Viewing Note" : "Improve Activity Note",
                    intent: noteType === "viewing" ? "viewing_note_improvement" : "activity_note_improvement",
                    modelId,
                    promptText: prompt,
                    rawOutput,
                    normalizedOutput: improvedText,
                    usage: {
                        promptTokens: usage.promptTokens || 0,
                        completionTokens: usage.completionTokens || 0,
                        totalTokens: usage.totalTokens || 0,
                        thoughtsTokens: usage.thoughtsTokens || 0,
                        toolUsePromptTokens: usage.toolUsePromptTokens || 0,
                    },
                    latencyMs,
                });
            } catch (traceError) {
                console.warn("[improveInternalNoteText] Failed to persist AI usage trace:", traceError);
            }
        }

        return {
            success: true as const,
            improvedText,
            modelId,
        };
    } catch (error: any) {
        console.error("[improveInternalNoteText] Error:", error);
        return {
            success: false as const,
            error: error?.message || "Failed to improve note.",
        };
    }
}

export async function summarizeSelectionToCrmLog(conversationId: string, selectedText: string, modelOverride?: string) {
    const sanitizedConversationId = String(conversationId || "").trim();
    if (!sanitizedConversationId) {
        return { success: false, error: "Missing conversation ID" };
    }

    const text = trimSelectionText(selectedText);
    if (!text || text.length < 5) {
        return { success: false, error: "Selected text is too short" };
    }

    try {
        const location = await getAuthenticatedLocation();
        const conversation = await resolveConversationForCrmLog(location.id, sanitizedConversationId);
        if (!conversation) {
            return { success: false, error: "Conversation not found" };
        }

        const contactFirstName = deriveOptionalFirstName(
            conversation.contact?.firstName,
            conversation.contact?.name,
            conversation.contact?.email
        );

        const modelId = typeof modelOverride === "string" && modelOverride.trim()
            ? modelOverride.trim()
            : getModelForTask("simple_generation");
        const startedAt = Date.now();
        const summaryPrompt = [
            "You write concise internal CRM activity summaries for real estate teams.",
            "Rules:",
            "- Return exactly one plain-text sentence.",
            "- Keep it factual and action-oriented.",
            "- Include key entities (person/property/reference/price/date) only if present in the source text.",
            contactFirstName
                ? `- Refer to the person as ${contactFirstName} (first name only) when mentioning the contact.`
                : "- If a contact name is present, refer to the person by first name only.",
            "- Never identify the contact by full name, phone number, or email.",
            "- Do not include agent name or date prefix.",
            "- Do not use markdown, bullets, or quotes.",
            "",
            "Selected text:",
            '"""',
            text,
            '"""',
        ].join("\n");

        const { text: rawSummary, usage } = await callLLMWithMetadata(modelId, summaryPrompt, undefined, { temperature: 0.2 });
        const latencyMs = Date.now() - startedAt;
        const normalizedSummary = normalizeSingleLine(rawSummary, "Contacted lead and captured conversation update.");
        const summary = replaceContactIdentityMentionsWithFirstName(
            normalizedSummary,
            conversation.contact
        );
        const persisted = await persistSelectionLogEntry({
            conversationId: sanitizedConversationId,
            entryBody: summary,
        });

        if (!persisted.success || !persisted.conversation) {
            return { success: false, error: persisted.error };
        }

        try {
            await persistSelectionAiExecution({
                conversationInternalId: persisted.conversation.id,
                taskTitle: "Selection Summary to CRM Log",
                intent: "selection_summary",
                modelId,
                promptText: summaryPrompt,
                rawOutput: rawSummary,
                normalizedOutput: summary,
                usage: {
                    promptTokens: usage.promptTokens || 0,
                    completionTokens: usage.completionTokens || 0,
                    totalTokens: usage.totalTokens || 0,
                    thoughtsTokens: usage.thoughtsTokens || 0,
                    toolUsePromptTokens: usage.toolUsePromptTokens || 0,
                },
                latencyMs,
            });
        } catch (traceError) {
            console.warn("[summarizeSelectionToCrmLog] Failed to persist AI usage trace:", traceError);
        }

        return {
            success: true,
            summary,
            entry: persisted.entry,
            skipped: persisted.skipped ?? false,
        };
    } catch (error: any) {
        console.error("[summarizeSelectionToCrmLog] Error:", error);
        return { success: false, error: error?.message || "Failed to summarize selection" };
    }
}

export async function suggestTasksFromSelection(conversationId: string, selectedText: string, modelOverride?: string) {
    const sanitizedConversationId = String(conversationId || "").trim();
    if (!sanitizedConversationId) {
        return { success: false, error: "Missing conversation ID" };
    }

    const text = trimSelectionText(selectedText);
    if (!text || text.length < 10) {
        return { success: false, error: "Selected text is too short" };
    }

    let conversationForTelemetry: { id: string; contactId: string } | null = null;
    let modelForTelemetry: string | null = null;

    try {
        const location = await getAuthenticatedLocation();
        const conversation = await resolveConversationForCrmLog(location.id, sanitizedConversationId);
        if (!conversation) {
            return { success: false, error: "Conversation not found" };
        }
        conversationForTelemetry = {
            id: conversation.id,
            contactId: conversation.contactId,
        };

        const contactFirstName = deriveOptionalFirstName(
            conversation.contact?.firstName,
            conversation.contact?.name,
            conversation.contact?.email
        );

        const modelId = typeof modelOverride === "string" && modelOverride.trim()
            ? modelOverride.trim()
            : getModelForTask("simple_generation");
        modelForTelemetry = modelId;

        const startedAt = Date.now();
        const prompt = [
            "You are a CRM assistant that proposes high-quality actionable tasks from a selected conversation excerpt.",
            "Return JSON only. Do not include markdown or commentary.",
            "Schema:",
            '{ "suggestions": [ { "title": string, "description": string|null, "priority": "low"|"medium"|"high", "dueAt": string|null, "confidence": number, "reason": string|null } ] }',
            "Rules:",
            "- Suggest between 0 and 6 tasks.",
            "- Each title must be a concise action phrase (5-120 chars).",
            "- Include only tasks with clear value for follow-up.",
            "- Keep description short and factual.",
            "- Use priority=high only for urgent/time-sensitive actions.",
            "- Set dueAt only when explicit timing is present in source text; otherwise null.",
            "- confidence must be 0..1.",
            contactFirstName
                ? `- If you mention the contact, use first name only: ${contactFirstName}.`
                : "- If you mention the contact, use first name only.",
            "- Never include phone numbers or email addresses in task title.",
            "",
            "Selected text:",
            '"""',
            text,
            '"""',
        ].join("\n");

        await persistTaskSuggestionFunnelEvent({
            type: TASK_SUGGESTION_FUNNEL_EVENT_TYPES.generateRequested,
            conversationInternalId: conversation.id,
            contactId: conversation.contactId,
            payload: {
                source: "selection_toolbar",
                selectedTextLength: text.length,
                modelId,
                maxSuggestions: MAX_TASK_SUGGESTIONS,
            },
        });

        const { text: rawOutput, usage } = await callLLMWithMetadata(
            modelId,
            prompt,
            undefined,
            { jsonMode: true, temperature: 0.2 }
        );
        const latencyMs = Date.now() - startedAt;

        const cleanJson = rawOutput.replace(/```json/g, "").replace(/```/g, "").trim();
        const parsedPayload = JSON.parse(cleanJson);

        let rawSuggestions: Array<z.infer<typeof SelectionTaskSuggestionSchema>> = [];
        const parsedEnvelope = SelectionTaskSuggestionEnvelopeSchema.safeParse(parsedPayload);
        if (parsedEnvelope.success) {
            rawSuggestions = parsedEnvelope.data.suggestions;
        } else {
            const parsedArray = z.array(SelectionTaskSuggestionSchema).max(MAX_TASK_SUGGESTIONS).safeParse(parsedPayload);
            if (!parsedArray.success) {
                throw new Error("AI response was not valid task suggestion JSON");
            }
            rawSuggestions = parsedArray.data;
        }

        const seenTitles = new Set<string>();
        const suggestions: SelectionTaskSuggestion[] = [];

        for (const item of rawSuggestions) {
            const normalizedTitle = normalizeSingleLine(item.title, "")
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, MAX_TASK_SUGGESTION_TITLE_LENGTH);
            if (!normalizedTitle) continue;

            const dedupeKey = normalizedTitle.toLowerCase();
            if (seenTitles.has(dedupeKey)) continue;
            seenTitles.add(dedupeKey);

            const normalizedDescription = item.description
                ? normalizeSingleLine(item.description, "").slice(0, MAX_TASK_SUGGESTION_DESCRIPTION_LENGTH)
                : "";

            const normalizedReason = item.reason
                ? normalizeSingleLine(item.reason, "").slice(0, 500)
                : "";

            suggestions.push({
                title: normalizedTitle,
                description: normalizedDescription || null,
                priority: normalizeSuggestionPriority(item.priority),
                dueAt: normalizeSuggestionDueAt(item.dueAt),
                confidence: normalizeSuggestionConfidence(item.confidence),
                reason: normalizedReason || null,
            });

            if (suggestions.length >= MAX_TASK_SUGGESTIONS) break;
        }

        try {
            await persistSelectionAiExecution({
                conversationInternalId: conversation.id,
                taskTitle: "Selection Task Suggestions",
                intent: "selection_task_suggestions",
                modelId,
                promptText: prompt,
                rawOutput,
                normalizedOutput: JSON.stringify({ suggestions }),
                usage: {
                    promptTokens: usage.promptTokens || 0,
                    completionTokens: usage.completionTokens || 0,
                    totalTokens: usage.totalTokens || 0,
                    thoughtsTokens: usage.thoughtsTokens || 0,
                    toolUsePromptTokens: usage.toolUsePromptTokens || 0,
                },
                latencyMs,
            });
        } catch (traceError) {
            console.warn("[suggestTasksFromSelection] Failed to persist AI usage trace:", traceError);
        }

        await persistTaskSuggestionFunnelEvent({
            type: TASK_SUGGESTION_FUNNEL_EVENT_TYPES.generateSucceeded,
            conversationInternalId: conversation.id,
            contactId: conversation.contactId,
            payload: {
                source: "selection_toolbar",
                selectedTextLength: text.length,
                modelId,
                suggestionCount: suggestions.length,
                latencyMs,
                promptTokens: usage.promptTokens || 0,
                completionTokens: usage.completionTokens || 0,
                totalTokens: usage.totalTokens || 0,
            },
        });

        return {
            success: true as const,
            suggestions,
            model: modelId,
            usage: {
                promptTokens: usage.promptTokens || 0,
                completionTokens: usage.completionTokens || 0,
                totalTokens: usage.totalTokens || 0,
            },
            latencyMs,
        };
    } catch (error: any) {
        console.error("[suggestTasksFromSelection] Error:", error);
        const errorMessage = error?.message || "Failed to suggest tasks from selection";

        if (conversationForTelemetry) {
            await persistTaskSuggestionFunnelEvent({
                type: TASK_SUGGESTION_FUNNEL_EVENT_TYPES.generateFailed,
                conversationInternalId: conversationForTelemetry.id,
                contactId: conversationForTelemetry.contactId,
                payload: {
                    source: "selection_toolbar",
                    selectedTextLength: text.length,
                    modelId: modelForTelemetry,
                    error: errorMessage,
                },
                status: "error",
                error: errorMessage,
            });
        }

        return { success: false as const, error: errorMessage };
    }
}

export async function applySuggestedTasksFromSelection(
    conversationId: string,
    suggestionsInput: Array<z.input<typeof ApplySelectionTaskSuggestionSchema>>
) {
    const sanitizedConversationId = String(conversationId || "").trim();
    if (!sanitizedConversationId) {
        return { success: false as const, error: "Missing conversation ID" };
    }

    const parsedSuggestions = ApplySelectionTaskSuggestionBatchSchema.safeParse(suggestionsInput || []);
    if (!parsedSuggestions.success) {
        return { success: false as const, error: "No valid task suggestions to apply" };
    }

    const suggestions = parsedSuggestions.data.map((item) => ({
        title: normalizeSingleLine(item.title, "").slice(0, MAX_TASK_SUGGESTION_TITLE_LENGTH),
        description: item.description
            ? normalizeSingleLine(item.description, "").slice(0, MAX_TASK_SUGGESTION_DESCRIPTION_LENGTH)
            : "",
        priority: normalizeSuggestionPriority(item.priority),
        dueAt: normalizeSuggestionDueAt(item.dueAt),
        confidence: normalizeSuggestionConfidence(item.confidence),
        reason: item.reason ? normalizeSingleLine(item.reason, "").slice(0, 500) : "",
    })).filter((item) => Boolean(item.title));

    if (!suggestions.length) {
        return { success: false as const, error: "No valid task suggestions to apply" };
    }

    let conversationForTelemetry: { id: string; contactId: string } | null = null;

    try {
        const location = await getAuthenticatedLocation();
        const actor = await resolveLocationActorContext(location.id);
        if (!actor.hasAccess) {
            return { success: false as const, error: "Unauthorized" };
        }
        const conversation = await resolveConversationForCrmLog(location.id, sanitizedConversationId);
        if (!conversation) {
            return { success: false as const, error: "Conversation not found" };
        }

        conversationForTelemetry = {
            id: conversation.id,
            contactId: conversation.contactId,
        };

        await persistTaskSuggestionFunnelEvent({
            type: TASK_SUGGESTION_FUNNEL_EVENT_TYPES.applyRequested,
            conversationInternalId: conversation.id,
            contactId: conversation.contactId,
            payload: {
                source: "selection_toolbar",
                selectedCount: suggestions.length,
                titles: suggestions.map((item) => item.title).slice(0, MAX_TASK_SUGGESTIONS),
            },
        });

        let createdCount = 0;
        const failed: Array<{ title: string; error: string }> = [];

        for (const suggestion of suggestions) {
            const result = await createContactTask({
                conversationId: conversation.id,
                title: suggestion.title,
                description: suggestion.description || undefined,
                dueAt: suggestion.dueAt || undefined,
                priority: suggestion.priority,
                assignedUserId: actor.userId || undefined,
                source: "ai_selection",
            });

            if (result?.success) {
                createdCount += 1;
                continue;
            }

            failed.push({
                title: suggestion.title,
                error: String(result?.error || "Unknown error"),
            });
        }

        await persistTaskSuggestionFunnelEvent({
            type: TASK_SUGGESTION_FUNNEL_EVENT_TYPES.applyCompleted,
            conversationInternalId: conversation.id,
            contactId: conversation.contactId,
            payload: {
                source: "selection_toolbar",
                selectedCount: suggestions.length,
                createdCount,
                failedCount: failed.length,
                failedTitles: failed.map((item) => item.title),
                failedErrors: failed
                    .map((item) => normalizeSingleLine(item.error, "Unknown error").slice(0, 180))
                    .filter(Boolean),
            },
        });

        return {
            success: true as const,
            selectedCount: suggestions.length,
            createdCount,
            failedCount: failed.length,
            failed,
        };
    } catch (error: any) {
        const errorMessage = error?.message || "Failed to apply task suggestions";
        console.error("[applySuggestedTasksFromSelection] Error:", error);

        if (conversationForTelemetry) {
            await persistTaskSuggestionFunnelEvent({
                type: TASK_SUGGESTION_FUNNEL_EVENT_TYPES.applyFailed,
                conversationInternalId: conversationForTelemetry.id,
                contactId: conversationForTelemetry.contactId,
                payload: {
                    source: "selection_toolbar",
                    selectedCount: suggestions.length,
                    error: errorMessage,
                },
                status: "error",
                error: errorMessage,
            });
        }

        return { success: false as const, error: errorMessage };
    }
}

export async function getTaskSuggestionFunnelMetrics(input?: z.input<typeof TaskSuggestionFunnelMetricsInputSchema>) {
    const parsedInput = TaskSuggestionFunnelMetricsInputSchema.safeParse(input);
    if (!parsedInput.success) {
        return { success: false as const, error: "Invalid metrics query" };
    }

    const location = await getAuthenticatedLocation();
    const config = parsedInput.data;
    const days = config?.days || 30;
    const scope: "location" | "conversation" = config?.scope || "location";
    const now = new Date();
    const since = new Date(now.getTime() - (days * 24 * 60 * 60 * 1000));

    let scopedConversationId: string | null = null;
    if (scope === "conversation") {
        const requestedConversationId = String(config?.conversationId || "").trim();
        if (!requestedConversationId) {
            return { success: false as const, error: "Conversation ID is required for conversation metrics" };
        }

        const conversation = await resolveConversationForCrmLog(location.id, requestedConversationId);
        if (!conversation) {
            return { success: false as const, error: "Conversation not found" };
        }

        scopedConversationId = conversation.id;
    }

    const rawEvents = await db.agentEvent.findMany({
        where: {
            type: { in: [...TASK_SUGGESTION_FUNNEL_EVENT_TYPE_VALUES] },
            processedAt: { gte: since },
            ...(scopedConversationId ? { conversationId: scopedConversationId } : {}),
        },
        select: {
            type: true,
            payload: true,
            error: true,
            processedAt: true,
            conversationId: true,
        },
        orderBy: { processedAt: "asc" },
    });

    let scopedEvents = rawEvents;
    if (!scopedConversationId) {
        const conversationIds = Array.from(new Set(
            rawEvents
                .map((item) => item.conversationId)
                .filter((item): item is string => Boolean(item))
        ));

        if (conversationIds.length > 0) {
            const allowed = await db.conversation.findMany({
                where: {
                    id: { in: conversationIds },
                    locationId: location.id,
                },
                select: { id: true },
            });
            const allowedIds = new Set(allowed.map((item) => item.id));
            scopedEvents = rawEvents.filter((item) => item.conversationId ? allowedIds.has(item.conversationId) : false);
        } else {
            scopedEvents = [];
        }
    }

    const totals = {
        generateRequested: 0,
        generateSucceeded: 0,
        generateFailed: 0,
        applyRequested: 0,
        applyCompleted: 0,
        applyFailed: 0,
        suggestionsGenerated: 0,
        selectedForApply: 0,
        tasksCreated: 0,
        tasksFailed: 0,
    };

    type DailyPoint = {
        date: string;
        generateRequested: number;
        generateSucceeded: number;
        generateFailed: number;
        applyRequested: number;
        applyCompleted: number;
        applyFailed: number;
        suggestionsGenerated: number;
        selectedForApply: number;
        tasksCreated: number;
        tasksFailed: number;
    };

    const ensureDailyPoint = (map: Map<string, DailyPoint>, date: string): DailyPoint => {
        const existing = map.get(date);
        if (existing) return existing;
        const created: DailyPoint = {
            date,
            generateRequested: 0,
            generateSucceeded: 0,
            generateFailed: 0,
            applyRequested: 0,
            applyCompleted: 0,
            applyFailed: 0,
            suggestionsGenerated: 0,
            selectedForApply: 0,
            tasksCreated: 0,
            tasksFailed: 0,
        };
        map.set(date, created);
        return created;
    };

    let generationLatencyTotalMs = 0;
    let generationLatencySamples = 0;
    const dailyMap = new Map<string, DailyPoint>();
    const failureMap = new Map<string, number>();

    for (const event of scopedEvents) {
        const payload = getPayloadObject(event.payload);
        const point = ensureDailyPoint(dailyMap, toIsoDayKey(event.processedAt));

        switch (event.type) {
            case TASK_SUGGESTION_FUNNEL_EVENT_TYPES.generateRequested: {
                totals.generateRequested += 1;
                point.generateRequested += 1;
                break;
            }
            case TASK_SUGGESTION_FUNNEL_EVENT_TYPES.generateSucceeded: {
                totals.generateSucceeded += 1;
                point.generateSucceeded += 1;

                const suggestionCount = Math.max(0, Math.round(getPayloadNumber(payload, "suggestionCount")));
                totals.suggestionsGenerated += suggestionCount;
                point.suggestionsGenerated += suggestionCount;

                const latencyMs = getPayloadNumber(payload, "latencyMs");
                if (latencyMs > 0) {
                    generationLatencyTotalMs += latencyMs;
                    generationLatencySamples += 1;
                }
                break;
            }
            case TASK_SUGGESTION_FUNNEL_EVENT_TYPES.generateFailed: {
                totals.generateFailed += 1;
                point.generateFailed += 1;
                break;
            }
            case TASK_SUGGESTION_FUNNEL_EVENT_TYPES.applyRequested: {
                totals.applyRequested += 1;
                point.applyRequested += 1;

                const selectedCount = Math.max(0, Math.round(getPayloadNumber(payload, "selectedCount")));
                totals.selectedForApply += selectedCount;
                point.selectedForApply += selectedCount;
                break;
            }
            case TASK_SUGGESTION_FUNNEL_EVENT_TYPES.applyCompleted: {
                totals.applyCompleted += 1;
                point.applyCompleted += 1;

                const createdCount = Math.max(0, Math.round(getPayloadNumber(payload, "createdCount")));
                const failedCount = Math.max(0, Math.round(getPayloadNumber(payload, "failedCount")));

                totals.tasksCreated += createdCount;
                totals.tasksFailed += failedCount;

                point.tasksCreated += createdCount;
                point.tasksFailed += failedCount;

                if (failedCount > 0) {
                    const failedErrors = payload.failedErrors;
                    if (Array.isArray(failedErrors) && failedErrors.length > 0) {
                        for (const rawError of failedErrors) {
                            const reason = normalizeSingleLine(String(rawError || ""), "Unknown error").slice(0, 180);
                            if (!reason) continue;
                            failureMap.set(reason, (failureMap.get(reason) || 0) + 1);
                        }
                    } else {
                        const fallbackReason = "One or more task creates failed";
                        failureMap.set(fallbackReason, (failureMap.get(fallbackReason) || 0) + 1);
                    }
                }
                break;
            }
            case TASK_SUGGESTION_FUNNEL_EVENT_TYPES.applyFailed: {
                totals.applyFailed += 1;
                point.applyFailed += 1;
                break;
            }
            default:
                break;
        }

        if (
            event.type === TASK_SUGGESTION_FUNNEL_EVENT_TYPES.generateFailed
            || event.type === TASK_SUGGESTION_FUNNEL_EVENT_TYPES.applyFailed
        ) {
            const reasonRaw = String(payload.error || event.error || "Unknown error");
            const reason = normalizeSingleLine(reasonRaw, "Unknown error").slice(0, 180);
            failureMap.set(reason, (failureMap.get(reason) || 0) + 1);
        }
    }

    const daily = Array.from(dailyMap.values())
        .sort((left, right) => left.date.localeCompare(right.date));

    const failures = Array.from(failureMap.entries())
        .map(([reason, count]) => ({ reason, count }))
        .sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason))
        .slice(0, 8);

    const rates = {
        generateSuccessRate: safeRatio(totals.generateSucceeded, totals.generateRequested),
        applyStartRate: safeRatio(totals.applyRequested, totals.generateSucceeded),
        applyCompletionRate: safeRatio(totals.applyCompleted, totals.applyRequested),
        suggestionToTaskConversion: safeRatio(totals.tasksCreated, totals.suggestionsGenerated),
        selectedToTaskConversion: safeRatio(totals.tasksCreated, totals.selectedForApply),
    };

    const averages = {
        suggestionsPerGeneration: safeRatio(totals.suggestionsGenerated, totals.generateSucceeded),
        tasksPerApply: safeRatio(totals.tasksCreated, totals.applyCompleted),
        generationLatencyMs: safeRatio(generationLatencyTotalMs, generationLatencySamples),
    };

    return {
        success: true as const,
        scope,
        window: {
            days,
            since: since.toISOString(),
            until: now.toISOString(),
        },
        totals,
        rates,
        averages,
        daily,
        failures,
        eventCount: scopedEvents.length,
    };
}

export async function runCustomSelectionPrompt(
    conversationId: string,
    selectedText: string,
    instruction: string,
    modelOverride?: string
) {
    const sanitizedConversationId = String(conversationId || "").trim();
    if (!sanitizedConversationId) {
        return { success: false, error: "Missing conversation ID" };
    }

    const text = trimSelectionText(selectedText);
    const cleanedInstruction = String(instruction || "").trim();
    if (!cleanedInstruction || cleanedInstruction.length < 3) {
        return { success: false, error: "Prompt instruction is too short" };
    }
    if (!text || text.length < 5) {
        return { success: false, error: "Selected text is too short" };
    }

    try {
        const modelId = typeof modelOverride === "string" && modelOverride.trim()
            ? modelOverride.trim()
            : getModelForTask("simple_generation");
        const startedAt = Date.now();
        const systemPrompt = [
            "You are an assistant for CRM operators.",
            "Follow the operator instruction strictly, using only the provided selected text as context.",
            "If the instruction asks for factual output, do not invent details that are not in context.",
            "Return plain text only, no markdown.",
            "",
            "Operator instruction:",
            cleanedInstruction,
            "",
            "Selected text context:",
            '"""',
            text,
            '"""',
        ].join("\n");

        const { text: rawOutput, usage } = await callLLMWithMetadata(modelId, systemPrompt, undefined, { temperature: 0.25 });
        const latencyMs = Date.now() - startedAt;
        const output = normalizeSingleLine(rawOutput, "No output generated.").slice(0, MAX_CUSTOM_OUTPUT_LENGTH);

        try {
            const location = await getAuthenticatedLocation();
            const conversation = await resolveConversationForCrmLog(location.id, sanitizedConversationId);
            if (conversation) {
                await persistSelectionAiExecution({
                    conversationInternalId: conversation.id,
                    taskTitle: "Selection Custom Prompt",
                    intent: "selection_custom",
                    modelId,
                    promptText: systemPrompt,
                    rawOutput,
                    normalizedOutput: output,
                    usage: {
                        promptTokens: usage.promptTokens || 0,
                        completionTokens: usage.completionTokens || 0,
                        totalTokens: usage.totalTokens || 0,
                        thoughtsTokens: usage.thoughtsTokens || 0,
                        toolUsePromptTokens: usage.toolUsePromptTokens || 0,
                    },
                    latencyMs,
                });
            }
        } catch (traceError) {
            console.warn("[runCustomSelectionPrompt] Failed to persist AI usage trace:", traceError);
        }

        return {
            success: true,
            output,
        };
    } catch (error: any) {
        console.error("[runCustomSelectionPrompt] Error:", error);
        return { success: false, error: error?.message || "Failed to run custom prompt" };
    }
}

export async function saveCustomSelectionToCrmLog(conversationId: string, outputText: string) {
    const sanitizedConversationId = String(conversationId || "").trim();
    if (!sanitizedConversationId) {
        return { success: false, error: "Missing conversation ID" };
    }

    const body = normalizeSingleLine(outputText, "");
    if (!body || body.length < 3) {
        return { success: false, error: "Custom output is too short to save" };
    }

    try {
        const persisted = await persistSelectionLogEntry({
            conversationId: sanitizedConversationId,
            entryBody: body,
        });
        if (!persisted.success) {
            return { success: false, error: persisted.error };
        }

        return { success: true, entry: persisted.entry, skipped: persisted.skipped ?? false };
    } catch (error: any) {
        console.error("[saveCustomSelectionToCrmLog] Error:", error);
        return { success: false, error: error?.message || "Failed to save custom output to CRM log" };
    }
}

type CreateParsedLeadOptions = {
    locationOverride?: any;
    skipAuthUserLookup?: boolean;
    preferredUserIdOverride?: string | null;
    parseTrace?: LeadAnalysisTrace;
};

function resolveLeadParserModelId(modelOverride?: string) {
    return typeof modelOverride === "string" && modelOverride.trim()
        ? modelOverride.trim()
        : GEMINI_DRAFT_FAST_DEFAULT;
}

async function parseLeadFromTextInternal(
    text: string,
    modelOverride?: string,
    locationOverride?: any
): Promise<LeadParseWithTraceResult> {
    await (locationOverride || getAuthenticatedLocationReadOnly({ requireGhlToken: false }));
    const normalizedInput = normalizeLeadParseInput(text);
    if (!normalizedInput || normalizedInput.length < 5) {
        return { success: false, error: "Text is too short" };
    }

    try {
        const prompt = [
            "You are an expert real estate lead parser.",
            "Extract structured lead data from the input text.",
            "Return a JSON object only (no markdown, no prose).",
            "Separate direct lead message content from operator/internal notes.",
            "Extract the person's real first name and last name when available.",
            "For contact.name, return only the person's plain real name when available.",
            "Do not return a structured CRM display name in the name fields.",
            "Set contact.role to exactly one of Lead, Owner, or Agent when inferable; otherwise default to Lead.",
            "Never drop useful lead context.",
            "If the pasted text is mainly CRM metadata, property portal data, listing details, lead overview fields, or agent instructions, do not treat it as a direct customer message.",
            "When there is no clear customer-written message, set messageContent to null and summarize the useful context in internalNotes.",
            "internalNotes must preserve any useful lead context such as goal, source, next action, property reference numbers, property type, area/city, price, plot size, bedrooms, and URLs when relevant.",
            "If multiple properties are mentioned, keep the property references in internalNotes even if property details are not repeated.",
            "If fields like Name, Tel, Email, Goal, Source, Notes, Next Action, Ref. No., price, property type, location, area, plot size, bedrooms, or portal URLs are present, treat them as metadata unless there is also a clear customer-written message.",
            "Write internalNotes as a concise CRM-style note with the most important facts an agent should see later.",
            "",
            "If the phone number lacks a country code, predict the most likely ISO 3166-1 alpha-2 country code (e.g., CY, IL, DE) based on the lead's location, language, or context in the text. If it cannot be reasonably predicted, set countryCode to null.",
            "JSON schema:",
            "{",
            '  "contact": { "name": string|null, "firstName": string|null, "lastName": string|null, "role": "Lead"|"Owner"|"Agent"|null, "phone": string|null, "countryCode": string|null, "email": string|null },',
            '  "requirements": { "budget": string|null, "location": string|null, "type": string|null, "bedrooms": string|null },',
            '  "messageContent": string|null,',
            '  "internalNotes": string|null,',
            '  "source": string|null',
            "}",
            "",
            "Input text:",
            '"""',
            normalizedInput,
            '"""',
        ].join("\n");

        const modelId = resolveLeadParserModelId(modelOverride);
        const start = Date.now();
        const { text: jsonStr, usage } = await callLLMWithMetadata(modelId, prompt, undefined, {
            jsonMode: true,
            temperature: 0,
            maxOutputTokens: LEAD_PARSE_MAX_OUTPUT_TOKENS,
            thinkingBudget: LEAD_PARSE_THINKING_BUDGET,
        });
        const end = Date.now();
        const costEstimate = calculateRunCostFromUsage(modelId, {
            promptTokens: usage.promptTokens,
            completionTokens: usage.completionTokens,
            totalTokens: usage.totalTokens,
            thoughtsTokens: usage.thoughtsTokens,
            toolUsePromptTokens: usage.toolUsePromptTokens
        });

        const cleanJson = jsonStr.replace(/```json/gi, "").replace(/```/g, "").trim();
        const parsed = parseJsonObjectFromModelOutput(jsonStr);
        const result = LeadParsingSchema.parse(parsed);
        const traceId = `trace_${Date.now()}`;
        const trace: LeadAnalysisTrace = {
            traceId,
            start,
            end,
            model: modelId,
            thoughtSummary: `Lead Analysis (${modelId}):\n- Extracted structured data from normalized text.\n- Identified Source: ${result.source || 'Unknown'}\n- Message Status: ${result.messageContent ? 'Has Message' : 'Notes Only'}`,
            llmRequest: {
                model: modelId,
                prompt,
                options: {
                    jsonMode: true,
                    maxOutputTokens: LEAD_PARSE_MAX_OUTPUT_TOKENS,
                    thinkingBudget: LEAD_PARSE_THINKING_BUDGET,
                }
            },
            llmResponse: {
                rawText: jsonStr,
                cleanJson,
                parsed: result,
                usage
            },
            estimatedCost: {
                usd: costEstimate.amount,
                method: costEstimate.method,
                confidence: costEstimate.confidence,
                breakdown: costEstimate.breakdown
            },
            promptTokens: usage.promptTokens,
            completionTokens: usage.completionTokens,
            totalTokens: usage.totalTokens
        };

        return {
            success: true,
            data: result,
            telemetry: {
                traceId,
                model: modelId,
                latencyMs: end - start,
            },
            trace,
            normalizedInput,
        };
    } catch (error: any) {
        console.error("parseLeadFromText Error:", error);
        return { success: false, error: error.message };
    }
}

function resolveInitialLeadChannelType(
    location: { evolutionInstanceId?: string | null },
    data: ParsedLeadData
): 'TYPE_WHATSAPP' | 'TYPE_SMS' | 'TYPE_EMAIL' {
    const phoneDigits = String(data.contact?.phone || '').replace(/\D/g, '');
    if (phoneDigits.length < 7 && data.contact?.email) {
        return 'TYPE_EMAIL';
    }
    if (phoneDigits.length >= 7 && location?.evolutionInstanceId) {
        return 'TYPE_WHATSAPP';
    }
    return 'TYPE_SMS';
}

async function applyMatchedPropertyToContact(args: {
    contactId: string;
    matchedProperty: NonNullable<ResolvedLeadPropertyMatch>;
    inferredStatus: "For Rent" | "For Sale" | null;
}) {
    const { contactId, matchedProperty, inferredStatus } = args;
    const contactForProperty = await db.contact.findUnique({
        where: { id: contactId },
        select: {
            propertiesInterested: true,
            requirementStatus: true,
            requirementDistrict: true,
            requirementPropertyLocations: true
        }
    });

    const nextInterested = Array.from(new Set([
        ...(contactForProperty?.propertiesInterested || []),
        matchedProperty.id
    ]));

    const statusFromProperty = inferRequirementStatusFromMatchedProperty(matchedProperty);
    const derivedStatus = inferredStatus || statusFromProperty;
    const propertyDistrict = normalizeRequirementDistrict(matchedProperty.propertyLocation || matchedProperty.city || null);

    const propertyPatch: any = {
        propertiesInterested: nextInterested
    };

    if (derivedStatus) {
        propertyPatch.requirementStatus = derivedStatus;
    }

    if ((!contactForProperty?.requirementDistrict || contactForProperty.requirementDistrict === "Any District") && propertyDistrict) {
        propertyPatch.requirementDistrict = propertyDistrict;
    }

    if (propertyDistrict) {
        propertyPatch.requirementPropertyLocations = Array.from(new Set([
            ...(contactForProperty?.requirementPropertyLocations || []),
            propertyDistrict
        ]));
    }

    await db.contact.update({
        where: { id: contactId },
        data: propertyPatch
    });
}

export async function parseLeadFromText(text: string, modelOverride?: string) {
    const parsed = await parseLeadFromTextInternal(text, modelOverride);
    if (!parsed.success) {
        return parsed;
    }
    return {
        success: true as const,
        data: parsed.data,
        telemetry: parsed.telemetry,
    };
}

export async function importLeadFromText(text: string, modelOverride?: string) {
    const location = await getAuthenticatedLocationReadOnly({ requireGhlToken: false });
    const totalStartedAt = Date.now();
    const parsed = await parseLeadFromTextInternal(text, modelOverride, location);
    if (!parsed.success) {
        return parsed;
    }

    const importStartedAt = Date.now();
    const imported = await createParsedLead(parsed.data, parsed.normalizedInput, {
        locationOverride: location,
        parseTrace: parsed.trace,
    });
    const totalLatencyMs = Date.now() - totalStartedAt;

    if (!imported.success) {
        return imported;
    }

    const importLatencyMs = Date.now() - importStartedAt;
    console.log("[PasteLeadFastPath] Parse+import completed", JSON.stringify({
        traceId: parsed.telemetry.traceId,
        model: parsed.telemetry.model,
        parseLatencyMs: parsed.telemetry.latencyMs,
        importLatencyMs,
        totalLatencyMs,
        conversationId: imported.internalConversationId || imported.conversationId || null,
        backgroundJobsQueued: imported.backgroundJobsQueued || [],
    }));

    return {
        ...imported,
        parseTelemetry: parsed.telemetry,
        parseLatencyMs: parsed.telemetry.latencyMs,
        importLatencyMs,
        totalLatencyMs,
    };
}

export async function createParsedLead(
    data: ParsedLeadData,
    originalText: string,
    options?: CreateParsedLeadOptions
) {
    const location = options?.locationOverride || await getAuthenticatedLocationReadOnly({ requireGhlToken: false });
    const importStartedAt = Date.now();
    const backgroundJobsQueued: string[] = [];

    let preferredUserId: string | null = options?.preferredUserIdOverride ?? null;
    if (!options?.skipAuthUserLookup && preferredUserId == null) {
        try {
            const { userId: clerkUserId } = await auth();
            const currentUser = clerkUserId
                ? await db.user.findUnique({ where: { clerkId: clerkUserId }, select: { id: true } })
                : null;
            preferredUserId = currentUser?.id || null;
        } catch (authError) {
            console.warn("[createParsedLead] auth() unavailable in current context, continuing without preferred user id");
            preferredUserId = null;
        }
    }

    try {
        if (data.contact && data.contact.phone) {
            const { formatted } = normalizeInternationalPhone(data.contact.phone, data.contact.countryCode);
            if (formatted) {
                data.contact.phone = formatted;
            }
        }

        // 1. Resolve or Create Contact
        let contactId: string | null = null;
        let isNewContact = false;
        let existingContactForMerge: {
            id: string;
            propertiesInterested: string[];
            requirementOtherDetails: string | null;
            requirementPropertyLocations: string[];
            requirementDistrict: string;
            requirementStatus: string;
        } | null = null;

        const leadResolutionText = [
            originalText,
            data.internalNotes,
            data.messageContent,
            data.requirements?.location,
            data.requirements?.budget,
            data.requirements?.type
        ]
            .filter(Boolean)
            .join("\n");

        const preferredChannelType = resolveInitialLeadChannelType(location, data);

        // Try to find by Phone
        if (data.contact?.phone) {
            // Clean phone
            const phone = data.contact.phone.replace(/\D/g, "");
            const existing = await db.contact.findFirst({
                where: {
                    locationId: location.id,
                    phone: { contains: phone.slice(-8) } // Simple suffix match
                }
            });
            if (existing) contactId = existing.id;
        }

        // Try to find by Email
        if (!contactId && data.contact?.email) {
            const existing = await db.contact.findFirst({
                where: { locationId: location.id, email: data.contact.email }
            });
            if (existing) contactId = existing.id;
        }

        if (contactId) {
            existingContactForMerge = await db.contact.findUnique({
                where: { id: contactId },
                select: {
                    id: true,
                    propertiesInterested: true,
                    requirementOtherDetails: true,
                    requirementPropertyLocations: true,
                    requirementDistrict: true,
                    requirementStatus: true
                }
            });
        }

        // Create or Update
        const contactData: any = {
            locationId: location.id,
            status: "New",
            leadSource: (data.source && String(data.source).trim()) ? String(data.source).trim() : "Manual Import"
        };

        if (data.contact?.name) contactData.name = data.contact.name;
        if (data.contact?.phone) contactData.phone = data.contact.phone;
        if (data.contact?.email) contactData.email = data.contact.email;

        const normalizedDistrict = normalizeRequirementDistrict(data.requirements?.location);
        const normalizedBedrooms = normalizeRequirementBedrooms(data.requirements?.bedrooms);
        const parsedBudget = parseBudgetRange(data.requirements?.budget);
        const normalizedMinPrice = mapToMinPriceOption(parsedBudget.min);
        const normalizedMaxPrice = mapToMaxPriceOption(parsedBudget.max);
        const inferredStatus = inferRequirementStatusFromLead(leadResolutionText, data.requirements?.budget);
        const matchedPropertyForName = await resolveLeadPropertyMatch(location.id, leadResolutionText);
        const parsedPersonName = splitLeadPersonName(data.contact);
        const inferredRole = inferLeadContactRole(leadResolutionText, data.contact?.role);
        const structuredDisplayName = buildStructuredLeadDisplayName({
            contact: data.contact,
            rawLeadText: leadResolutionText,
            inferredStatus,
            matchedProperty: matchedPropertyForName,
            requirements: data.requirements,
        });

        if (data.requirements) {
            if (normalizedMinPrice) contactData.requirementMinPrice = normalizedMinPrice;
            if (normalizedMaxPrice) contactData.requirementMaxPrice = normalizedMaxPrice;
            if (normalizedDistrict) contactData.requirementDistrict = normalizedDistrict;
            if (normalizedBedrooms) contactData.requirementBedrooms = normalizedBedrooms;
            if (data.requirements.type) contactData.requirementPropertyTypes = [data.requirements.type];
        }
        if (structuredDisplayName) contactData.name = structuredDisplayName;
        if (parsedPersonName.firstName) contactData.firstName = parsedPersonName.firstName;
        if (parsedPersonName.lastName) contactData.lastName = parsedPersonName.lastName;
        contactData.contactType = inferredRole;
        if (normalizedDistrict) contactData.requirementPropertyLocations = [normalizedDistrict];
        if (inferredStatus) contactData.requirementStatus = inferredStatus;
        if (data.internalNotes) contactData.requirementOtherDetails = data.internalNotes;

        const loadExistingContactForMerge = async (id: string) => {
            existingContactForMerge = await db.contact.findUnique({
                where: { id },
                select: {
                    id: true,
                    propertiesInterested: true,
                    requirementOtherDetails: true,
                    requirementPropertyLocations: true,
                    requirementDistrict: true,
                    requirementStatus: true
                }
            });
        };

        const updateExistingContact = async (id: string) => {
            if (!existingContactForMerge || existingContactForMerge.id !== id) {
                await loadExistingContactForMerge(id);
            }

            // Remove locationId, status, leadSource from update data to avoid overwriting existing state
            const { locationId, status, leadSource, ...updateData } = contactData;
            if (data.internalNotes) {
                updateData.requirementOtherDetails = mergeUniqueText(existingContactForMerge?.requirementOtherDetails, data.internalNotes);
            }
            if (Array.isArray(updateData.requirementPropertyLocations)) {
                updateData.requirementPropertyLocations = Array.from(new Set([
                    ...(existingContactForMerge?.requirementPropertyLocations || []),
                    ...updateData.requirementPropertyLocations
                ]));
            }

            await db.contact.update({
                where: { id },
                data: {
                    ...updateData,
                }
            });
        };

        if (contactId) {
            // Update existing
            await updateExistingContact(contactId);
        } else {
            // Create New
            if (data.internalNotes) contactData.notes = data.internalNotes;
            if (data.internalNotes) contactData.requirementOtherDetails = data.internalNotes;
            try {
                const newContact = await db.contact.create({ data: contactData });
                contactId = newContact.id;
                isNewContact = true;
            } catch (createErr: any) {
                const isUniqueConstraint =
                    createErr?.code === 'P2002' ||
                    String(createErr?.message || '').includes('Unique constraint failed');

                if (!isUniqueConstraint) {
                    throw createErr;
                }

                const duplicateMatchClauses: any[] = [];
                if (contactData.phone) duplicateMatchClauses.push({ phone: contactData.phone });
                if (contactData.email) duplicateMatchClauses.push({ email: contactData.email });

                const duplicateContact = duplicateMatchClauses.length > 0
                    ? await db.contact.findFirst({
                        where: {
                            locationId: location.id,
                            OR: duplicateMatchClauses,
                        },
                        select: { id: true }
                    })
                    : null;

                if (!duplicateContact?.id) {
                    throw createErr;
                }

                contactId = duplicateContact.id;
                isNewContact = false;
                await updateExistingContact(contactId);
            }
        }

        if (contactId) {
            backgroundJobsQueued.push("googleAutoSync");
            runDetachedTask(`paste_lead_google_autosync:${contactId}`, async () => {
                await runGoogleAutoSyncForContact({
                    locationId: location.id,
                    contactId,
                    source: 'LEAD_CAPTURE',
                    event: isNewContact ? 'create' : 'update',
                    preferredUserId
                });
            });
        }

        // 2. Ensure Conversation Exists
        let conversation = await db.conversation.findFirst({
            where: { locationId: location.id, contactId: contactId! }
        });
        let conversationWasCreated = false;

        if (!conversation) {
            // Create dummy GHL ID if needed, or use cuid
            const ghlId = `import_${Date.now()}`;
            conversation = await db.conversation.create({
                data: {
                    locationId: location.id,
                    contactId: contactId!,
                    ghlConversationId: ghlId,
                    status: 'open',
                    lastMessageAt: new Date(),
                    lastMessageType: preferredChannelType,
                    unreadCount: 0
                }
            });
            conversationWasCreated = true;
        } else if (
            preferredChannelType === 'TYPE_WHATSAPP' &&
            (!conversation.lastMessageType || String(conversation.lastMessageType).toUpperCase().includes('SMS'))
        ) {
            // Upgrade default composer channel for imported leads without overriding email threads.
            conversation = await db.conversation.update({
                where: { id: conversation.id },
                data: { lastMessageType: preferredChannelType }
            });
        }

        if (data.contact?.phone && preferredChannelType === 'TYPE_WHATSAPP') {
            backgroundJobsQueued.push("channelVerification");
            runDetachedTask(`paste_lead_channel_verify:${conversation.id}`, async () => {
                const resolvedType = await resolvePreferredChannelTypeForPhone(location, data.contact?.phone);
                if (resolvedType !== preferredChannelType) {
                    await db.conversation.update({
                        where: { id: conversation.id },
                        data: { lastMessageType: resolvedType }
                    });
                    console.log(`[PasteLeadFastPath] Adjusted conversation ${conversation.id} channel ${preferredChannelType} -> ${resolvedType}`);
                }
            });
        }

        if (contactId) {
            const parseTrace = options?.parseTrace;
            if (parseTrace) backgroundJobsQueued.push("tracePersistence");
            backgroundJobsQueued.push("propertyEnrichment");
            runDetachedTask(`paste_lead_post_import:${conversation.id}`, async () => {
                const matchedProperty = matchedPropertyForName || await resolveLeadPropertyMatch(location.id, leadResolutionText);
                if (matchedProperty) {
                    await applyMatchedPropertyToContact({
                        contactId: contactId!,
                        matchedProperty,
                        inferredStatus,
                    });
                }

                if (parseTrace) {
                    await persistLeadAnalysisTraceRecord({
                        conversationId: conversation.id,
                        locationId: conversation.locationId,
                        trace: parseTrace,
                        matchedProperty,
                    });
                }

                console.log("[PasteLeadFastPath] Background post-import complete", JSON.stringify({
                    conversationId: conversation.id,
                    matchedPropertyId: matchedProperty?.id || null,
                    tracePersisted: !!parseTrace,
                }));
            });
        }

        // 3. Handle Message & Orchestration
        if (data.messageContent) {
            // USER SENT A MESSAGE
            const messageCreatedAt = new Date();
            const message = await db.message.create({
                data: {
                    conversationId: conversation.id,
                    body: data.messageContent,
                    direction: 'inbound',
                    type: preferredChannelType,
                    status: 'received',
                    createdAt: messageCreatedAt,
                    source: data.source || 'paste_import'
                }
            });

            await updateConversationLastMessage({
                conversationId: conversation.id,
                messageBody: data.messageContent,
                messageType: preferredChannelType,
                messageDate: messageCreatedAt,
                direction: 'inbound'
            });

            // Trigger AI in background so import/save returns immediately.
            backgroundJobsQueued.push("orchestration");
            runDetachedTask(`paste_lead_orchestrate:${conversation.ghlConversationId}`, async () => {
                await orchestrateAction(conversation.ghlConversationId, contactId!);
            });

            const importLatencyMs = Date.now() - importStartedAt;
            console.log("[PasteLeadFastPath] Imported lead with inbound message", JSON.stringify({
                conversationId: conversation.id,
                ghlConversationId: conversation.ghlConversationId,
                contactId,
                importLatencyMs,
                backgroundJobsQueued,
            }));

            return {
                success: true,
                conversationId: conversation.ghlConversationId,
                internalConversationId: conversation.id,
                contactId,
                action: 'replied',
                backgroundJobsQueued,
            };
        } else {
            // NO MESSAGE (Just Notes)
            // Create a System Note in the thread
            await db.message.create({
                data: {
                    conversationId: conversation.id,
                    body: `[Lead Imported] Source: ${data.source || 'Manual'}\nNotes: ${data.internalNotes || originalText}`,
                    direction: 'system', // Use reserved direction specific to internal/system
                    type: 'TYPE_NOTE',
                    status: 'read', // Internal
                    createdAt: new Date(),
                    source: 'system'
                }
            });

            if (conversationWasCreated && preferredChannelType === 'TYPE_WHATSAPP' && conversation.lastMessageType !== 'TYPE_WHATSAPP') {
                await db.conversation.update({
                    where: { id: conversation.id },
                    data: { lastMessageType: 'TYPE_WHATSAPP' }
                });
            }

            const importLatencyMs = Date.now() - importStartedAt;
            console.log("[PasteLeadFastPath] Imported notes-only lead", JSON.stringify({
                conversationId: conversation.id,
                ghlConversationId: conversation.ghlConversationId,
                contactId,
                importLatencyMs,
                backgroundJobsQueued,
            }));

            return {
                success: true,
                conversationId: conversation.ghlConversationId,
                internalConversationId: conversation.id,
                contactId,
                action: 'imported',
                backgroundJobsQueued,
            };
        }
    } catch (e: any) {
        console.error("createParsedLead Error:", e);
        return { success: false, error: e.message };
    }
}

async function maybeGenerateLegacyCrmAutoFirstContactDraft(args: {
    location: any;
    contactId: string | null;
    internalConversationId: string | null;
    ghlConversationId: string | null;
    force?: boolean;
}) {
    const force = !!args.force;
    const enabled = !!args.location?.legacyCrmLeadEmailAutoDraftFirstContact;
    if (!enabled) {
        return { attempted: false, skipped: true, reason: "Auto-draft disabled in settings" };
    }

    if (!args.contactId || !args.internalConversationId || !args.ghlConversationId) {
        return { attempted: false, skipped: true, reason: "Missing conversation/contact identifiers for auto-draft" };
    }

    const existingOutbound = await db.message.count({
        where: {
            conversationId: args.internalConversationId,
            direction: 'outbound',
            NOT: [{ type: 'TYPE_NOTE' }]
        }
    });

    if (existingOutbound > 0 && !force) {
        return { attempted: false, skipped: true, reason: "Conversation already has outbound messages" };
    }

    let draftLocation = args.location;
    try {
        if (draftLocation?.ghlAccessToken || draftLocation?.ghlRefreshToken) {
            draftLocation = await refreshGhlAccessToken(draftLocation);
        }
    } catch (tokenError) {
        console.warn("[Legacy CRM Lead Email] Auto-draft token refresh failed; continuing with current token", tokenError);
    }

    const instruction = "This lead was imported automatically from a legacy CRM lead notification email. Draft a proactive first outreach message that introduces the agent, acknowledges the enquiry, references any property/goal context from the notes if present, and asks the best next-step qualifying questions. Do not mention automation.";

    try {
        const draftResult = await generateDraft({
            conversationId: args.ghlConversationId,
            contactId: args.contactId,
            locationId: args.location.id,
            accessToken: draftLocation?.ghlAccessToken || '',
            businessName: draftLocation?.name || undefined,
            instruction,
        } as any);

        const draftText = String(draftResult?.draft || "").trim();
        if (!draftText || /^error:/i.test(draftText)) {
            return {
                attempted: true,
                status: "failed",
                error: draftText || "Auto-draft returned empty content",
            };
        }

        return {
            attempted: true,
            status: "generated",
            draftPreview: draftText.slice(0, 220),
        };
    } catch (error: any) {
        return {
            attempted: true,
            status: "failed",
            error: error?.message || "Auto-draft generation failed",
        };
    }
}

export async function processLegacyCrmLeadEmailForLocation(args: {
    locationId: string;
    messageId: string;
    force?: boolean;
    runAutoDraftFromSettings?: boolean;
    triggerSource?: string;
}) {
    const force = !!args.force;

    if (!args.locationId || !args.messageId || args.messageId.trim().length < 3) {
        return { success: false, error: "locationId and messageId are required" };
    }

    const location = await db.location.findUnique({
        where: { id: args.locationId },
        select: {
            id: true,
            name: true,
            evolutionInstanceId: true,
            ghlAccessToken: true,
            ghlRefreshToken: true,
            ghlExpiresAt: true,
            legacyCrmLeadEmailEnabled: true,
            legacyCrmLeadEmailSenders: true,
            legacyCrmLeadEmailSenderDomains: true,
            legacyCrmLeadEmailSubjectPatterns: true,
            legacyCrmLeadEmailAutoDraftFirstContact: true,
        } as any
    });

    if (!location) {
        return { success: false, error: "Location not found" };
    }
    const locationId = String((location as any).id);

    const message = await db.message.findFirst({
        where: {
            OR: [
                { id: args.messageId.trim() },
                { emailMessageId: args.messageId.trim() },
            ],
            conversation: { is: { locationId } },
        },
        select: {
            id: true,
            conversationId: true,
            type: true,
            subject: true,
            body: true,
            emailFrom: true,
            emailTo: true,
            emailMessageId: true,
            createdAt: true,
            source: true,
            conversation: {
                select: {
                    id: true,
                    locationId: true,
                }
            }
        }
    });

    if (!message) {
        return { success: false, error: "Email message not found in this location" };
    }

    if (!String(message.type || "").toUpperCase().includes("EMAIL")) {
        return { success: false, error: "Selected message is not an email" };
    }

    const processingStore = (db as any).legacyCrmLeadEmailProcessing;
    if (!processingStore?.findUnique) {
        return {
            success: false,
            error: "Legacy CRM lead email processing model is unavailable. Run Prisma migration + generate first."
        };
    }

    const existingProcessing = await processingStore.findUnique({
        where: { messageId: message.id }
    });

    if (existingProcessing?.status === "processing" && !force) {
        return {
            success: true,
            skipped: true,
            inProgress: true,
            processing: existingProcessing
        };
    }

    if (existingProcessing?.status === "processed" && !force) {
        return {
            success: true,
            skipped: true,
            alreadyProcessed: true,
            processing: existingProcessing
        };
    }

    const parsed = parseLegacyCrmLeadNotificationEmail({
        subject: message.subject,
        emailFrom: message.emailFrom,
        body: message.body,
        configuredSenders: (location as any)?.legacyCrmLeadEmailSenders || [],
        configuredDomains: (location as any)?.legacyCrmLeadEmailSenderDomains || [],
        configuredSubjectPatterns: (location as any)?.legacyCrmLeadEmailSubjectPatterns || [],
    });

    const processingSeed = {
        locationId,
        senderEmail: parsed.senderEmail,
        subject: parsed.subject,
        classification: parsed.classification || null,
        legacyLeadUrl: parsed.leadUrl,
        legacyLeadId: parsed.leadId,
        extracted: {
            senderMatchMode: parsed.senderMatchMode,
            configuredDetectionEnabled: (location as any)?.legacyCrmLeadEmailEnabled ?? false,
            matched: parsed.matched,
            reason: parsed.reason || null,
            fields: parsed.fields,
            triggerSource: args.triggerSource || null,
            emailSource: message.source || null,
        },
        parsedLeadPayload: parsed.parsedLeadData || null,
    };

    await processingStore.upsert({
        where: { messageId: message.id },
        create: {
            messageId: message.id,
            status: "processing",
            attempts: 1,
            ...processingSeed,
            error: null,
        },
        update: {
            status: "processing",
            attempts: { increment: 1 },
            error: null,
            ...processingSeed,
        }
    });

    if (!parsed.matched || !parsed.parsedLeadData) {
        const ignored = await processingStore.update({
            where: { messageId: message.id },
            data: {
                status: "ignored",
                processedAt: new Date(),
                error: parsed.reason || null,
            }
        });

        return {
            success: true,
            skipped: true,
            reason: parsed.reason || "Not a recognized legacy CRM lead notification email",
            processing: ignored,
            parsed,
        };
    }

    try {
        const importResult = await createParsedLead(
            parsed.parsedLeadData,
            parsed.bodyText,
            { locationOverride: { ...(location as any), id: locationId }, skipAuthUserLookup: true }
        );

        if (!importResult?.success) {
            const failed = await processingStore.update({
                where: { messageId: message.id },
                data: {
                    status: "failed",
                    error: importResult?.error || "createParsedLead failed",
                }
            });
            return {
                success: false,
                error: importResult?.error || "Failed to import lead from email",
                processing: failed,
                parsed,
            };
        }

        const contactId = (importResult as any).contactId || null;
        const internalConversationId = (importResult as any).internalConversationId || null;
        const ghlConversationId = (importResult as any).conversationId || null;

        const contactPatch: any = {};
        if (parsed.fields.goal) contactPatch.leadGoal = parsed.fields.goal;
        if (parsed.fields.source) contactPatch.leadSource = parsed.fields.source;
        if (parsed.fields.nextAction) contactPatch.leadNextAction = parsed.fields.nextAction;
        const followUpDate = parseLegacyCrmFollowUpDate(parsed.fields.followUp);
        if (followUpDate) contactPatch.leadFollowUpDate = followUpDate;

        if (contactId && Object.keys(contactPatch).length > 0) {
            await db.contact.update({
                where: { id: contactId },
                data: contactPatch
            });
        }

        let autoDraftResult: any = null;
        if (args.runAutoDraftFromSettings && (location as any)?.legacyCrmLeadEmailAutoDraftFirstContact) {
            autoDraftResult = await maybeGenerateLegacyCrmAutoFirstContactDraft({
                location,
                contactId,
                internalConversationId,
                ghlConversationId,
                force,
            });
        }

        const processed = await processingStore.update({
            where: { messageId: message.id },
            data: {
                status: "processed",
                error: null,
                processedAt: new Date(),
                processedContactId: contactId,
                processedConversationId: internalConversationId || ghlConversationId || null,
                processResult: {
                    force,
                    triggerSource: args.triggerSource || null,
                    importResult,
                    contactPatch,
                    autoDraft: autoDraftResult,
                }
            }
        });

        return {
            success: true,
            parsed,
            importResult,
            autoDraft: autoDraftResult,
            processing: processed,
        };
    } catch (error: any) {
        const failed = await processingStore.update({
            where: { messageId: message.id },
            data: {
                status: "failed",
                error: error?.message || "Unexpected processing error",
            }
        });

        return {
            success: false,
            error: error?.message || "Unexpected processing error",
            processing: failed,
            parsed,
        };
    }
}

export async function processLegacyCrmLeadEmailAction(
    messageId: string,
    options?: { force?: boolean }
) {
    const location = await getAuthenticatedLocation();
    return processLegacyCrmLeadEmailForLocation({
        locationId: location.id,
        messageId,
        force: !!options?.force,
        runAutoDraftFromSettings: true,
        triggerSource: "manual_action",
    });
}
export async function searchConversations(query: string, options?: { limit?: number }) {
    try {
        const location = await getAuthenticatedLocationReadOnly();
        const traceId = createTraceId();
        const MAX_SEARCH_LIMIT = 50;
        const limit = Math.min(Math.max(Number(options?.limit || 20), 1), MAX_SEARCH_LIMIT);

        const q = String(query || "").trim().replace(/\s+/g, " ");
        if (!q) {
            return {
                success: true,
                traceId,
                conversations: [],
                total: 0,
                hasMore: false,
                nextCursor: null,
                pageSize: limit,
            };
        }

        const likeQuery = `%${q}%`;
        let rankedRows: Array<{ conversationId: string; score: number }> = [];
        try {
            rankedRows = await withServerTiming("conversations.search", {
                traceId,
                locationId: location.id,
                limit,
                queryLength: q.length,
            }, async () => db.$queryRaw<Array<{ conversationId: string; score: number }>>`
            WITH search_term AS (
                SELECT ${q}::text AS q, plainto_tsquery('simple', ${q}) AS tsq
            ),
            contact_hits AS (
                SELECT
                    c.id AS "conversationId",
                    GREATEST(
                        similarity(COALESCE(ct.name, ''), st.q),
                        similarity(COALESCE(ct.email, ''), st.q),
                        similarity(COALESCE(ct.phone, ''), st.q)
                    ) + 0.8 * ts_rank_cd(
                        to_tsvector(
                            'simple',
                            COALESCE(ct.name, '') || ' ' ||
                            COALESCE(ct."firstName", '') || ' ' ||
                            COALESCE(ct."lastName", '') || ' ' ||
                            COALESCE(ct.email, '') || ' ' ||
                            COALESCE(ct.phone, '') || ' ' ||
                            COALESCE(ct.notes, '') || ' ' ||
                            COALESCE(ct."requirementOtherDetails", '')
                        ),
                        st.tsq
                    ) AS score
                FROM "Conversation" c
                JOIN "Contact" ct ON ct.id = c."contactId"
                CROSS JOIN search_term st
                WHERE c."locationId" = ${location.id}
                  AND c."deletedAt" IS NULL
                  AND (
                    to_tsvector(
                        'simple',
                        COALESCE(ct.name, '') || ' ' ||
                        COALESCE(ct."firstName", '') || ' ' ||
                        COALESCE(ct."lastName", '') || ' ' ||
                        COALESCE(ct.email, '') || ' ' ||
                        COALESCE(ct.phone, '') || ' ' ||
                        COALESCE(ct.notes, '') || ' ' ||
                        COALESCE(ct."requirementOtherDetails", '')
                    ) @@ st.tsq
                    OR COALESCE(ct.name, '') ILIKE ${likeQuery}
                    OR COALESCE(ct.email, '') ILIKE ${likeQuery}
                    OR COALESCE(ct.phone, '') ILIKE ${likeQuery}
                  )
            ),
            conversation_hits AS (
                SELECT
                    c.id AS "conversationId",
                    0.7 + similarity(COALESCE(c."lastMessageBody", ''), st.q)
                    + 0.4 * ts_rank_cd(to_tsvector('simple', COALESCE(c."lastMessageBody", '')), st.tsq) AS score
                FROM "Conversation" c
                CROSS JOIN search_term st
                WHERE c."locationId" = ${location.id}
                  AND c."deletedAt" IS NULL
                  AND (
                    to_tsvector('simple', COALESCE(c."lastMessageBody", '')) @@ st.tsq
                    OR COALESCE(c."lastMessageBody", '') ILIKE ${likeQuery}
                  )
            ),
            message_hits AS (
                SELECT
                    m."conversationId" AS "conversationId",
                    MAX(
                        0.6 + similarity(COALESCE(m.body, ''), st.q)
                        + 0.35 * ts_rank_cd(to_tsvector('simple', COALESCE(m.body, '')), st.tsq)
                    ) AS score
                FROM "Message" m
                JOIN "Conversation" c ON c.id = m."conversationId"
                CROSS JOIN search_term st
                WHERE c."locationId" = ${location.id}
                  AND c."deletedAt" IS NULL
                  AND (
                    to_tsvector('simple', COALESCE(m.body, '')) @@ st.tsq
                    OR COALESCE(m.body, '') ILIKE ${likeQuery}
                  )
                GROUP BY m."conversationId"
            ),
            transcript_hits AS (
                SELECT
                    m."conversationId" AS "conversationId",
                    MAX(
                        0.5 + similarity(COALESCE(mt.text, ''), st.q)
                        + 0.3 * ts_rank_cd(to_tsvector('simple', COALESCE(mt.text, '')), st.tsq)
                    ) AS score
                FROM "MessageTranscript" mt
                JOIN "Message" m ON m.id = mt."messageId"
                JOIN "Conversation" c ON c.id = m."conversationId"
                CROSS JOIN search_term st
                WHERE c."locationId" = ${location.id}
                  AND c."deletedAt" IS NULL
                  AND (
                    to_tsvector('simple', COALESCE(mt.text, '')) @@ st.tsq
                    OR COALESCE(mt.text, '') ILIKE ${likeQuery}
                  )
                GROUP BY m."conversationId"
            ),
            combined AS (
                SELECT * FROM contact_hits
                UNION ALL
                SELECT * FROM conversation_hits
                UNION ALL
                SELECT * FROM message_hits
                UNION ALL
                SELECT * FROM transcript_hits
            )
            SELECT
                "conversationId",
                MAX(score) AS score
            FROM combined
            GROUP BY "conversationId"
            ORDER BY MAX(score) DESC
            LIMIT ${limit};
        `);
        } catch (rawSearchError) {
            console.warn("[searchConversations] Falling back to Prisma search path:", rawSearchError);
            const fallbackRows = await db.conversation.findMany({
                where: {
                    locationId: location.id,
                    deletedAt: null,
                    OR: [
                        { lastMessageBody: { contains: q, mode: "insensitive" } },
                        {
                            contact: {
                                OR: [
                                    { name: { contains: q, mode: "insensitive" } },
                                    { firstName: { contains: q, mode: "insensitive" } },
                                    { lastName: { contains: q, mode: "insensitive" } },
                                    { email: { contains: q, mode: "insensitive" } },
                                    { phone: { contains: q, mode: "insensitive" } },
                                    { notes: { contains: q, mode: "insensitive" } },
                                    { requirementOtherDetails: { contains: q, mode: "insensitive" } },
                                ],
                            },
                        },
                    ],
                },
                select: { id: true, lastMessageAt: true },
                orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
                take: limit,
            });
            rankedRows = fallbackRows.map((row, index) => ({
                conversationId: row.id,
                score: limit - index,
            }));
        }

        const rankedConversationIds = rankedRows.map((row) => String(row.conversationId));
        if (rankedConversationIds.length === 0) {
            return {
                success: true,
                traceId,
                conversations: [],
                total: 0,
                hasMore: false,
                nextCursor: null,
                pageSize: limit,
            };
        }

        const fetchedRows = await db.conversation.findMany({
            where: {
                id: { in: rankedConversationIds },
            },
            include: {
                contact: { select: { name: true, email: true, phone: true, ghlContactId: true, preferredLang: true } },
            },
        });

        const activeDeals = await db.dealContext.findMany({
            where: {
                locationId: location.id,
                stage: "ACTIVE",
                conversationIds: {
                    hasSome: fetchedRows.map((row) => row.ghlConversationId),
                },
            },
            select: { id: true, title: true, conversationIds: true },
        });

        const dealMap = new Map<string, { id: string; title: string }>();
        for (const deal of activeDeals) {
            for (const conversationId of deal.conversationIds) {
                dealMap.set(conversationId, { id: deal.id, title: deal.title });
            }
        }
        const locationDefaultReplyLanguage = await getLocationDefaultReplyLanguage(location.id);

        const rankIndex = new Map<string, number>();
        rankedConversationIds.forEach((id, idx) => rankIndex.set(id, idx));
        const sortedRows = fetchedRows.sort((a, b) => {
            const left = rankIndex.get(a.id) ?? Number.MAX_SAFE_INTEGER;
            const right = rankIndex.get(b.id) ?? Number.MAX_SAFE_INTEGER;
            if (left !== right) return left - right;
            return b.lastMessageAt.getTime() - a.lastMessageAt.getTime();
        });

        return {
            success: true,
            traceId,
            conversations: sortedRows.map((row) => mapConversationRowToUi(row, location, dealMap, locationDefaultReplyLanguage)),
            total: sortedRows.length,
            hasMore: false,
            nextCursor: null,
            pageSize: limit,
        };

    } catch (error: any) {
        console.error("[searchConversations] error:", error);
        return {
            success: false,
            error: error.message || "Search failed",
            conversations: [],
            total: 0,
            hasMore: false,
            nextCursor: null,
            pageSize: 0
        };
    }
}

type SuggestViewingsContextInput = {
    anchorMessageId?: string | null;
    clientNowIso?: string | null;
    clientTimeZone?: string | null;
};

type ViewingDateResolutionSource = "llm" | "deterministic" | "fallback";
type ViewingPropertyResolutionSource = "exact_ref" | "exact_slug" | "none";

function parseClientNowIso(rawIso?: string | null): Date | null {
    const trimmed = String(rawIso || "").trim();
    if (!trimmed) return null;
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
}

function countSources(values: string[]): Record<string, number> {
    return values.reduce<Record<string, number>>((acc, value) => {
        const key = String(value || "unknown");
        acc[key] = (acc[key] || 0) + 1;
        return acc;
    }, {});
}

async function resolveViewingAnchorDate(args: {
    conversationInternalId: string;
    anchorMessageId?: string | null;
    clientNowIso?: string | null;
}) {
    const desiredMessageId = String(args.anchorMessageId || "").trim();
    if (desiredMessageId) {
        const anchorMessage = await db.message.findFirst({
            where: {
                id: desiredMessageId,
                conversationId: args.conversationInternalId,
            },
            select: { id: true, createdAt: true },
        });

        if (anchorMessage?.createdAt) {
            return {
                anchorDate: anchorMessage.createdAt,
                anchorSource: "message" as const,
                anchorMessageId: anchorMessage.id,
            };
        }
    }

    const clientNow = parseClientNowIso(args.clientNowIso);
    if (clientNow) {
        return {
            anchorDate: clientNow,
            anchorSource: "client_now" as const,
            anchorMessageId: null,
        };
    }

    return {
        anchorDate: new Date(),
        anchorSource: "server_now" as const,
        anchorMessageId: null,
    };
}

async function resolveExactViewingPropertyMatch(locationId: string, sourceText: string): Promise<{
    propertyId: string | null;
    source: ViewingPropertyResolutionSource;
}> {
    const refs = extractPropertyRefsFromText(sourceText);
    if (refs.length > 0) {
        const refMatch = await db.property.findFirst({
            where: {
                locationId,
                OR: refs.map((reference) => ({
                    reference: { equals: reference, mode: "insensitive" },
                })),
            },
            select: { id: true },
        });
        if (refMatch?.id) {
            return { propertyId: refMatch.id, source: "exact_ref" };
        }
    }

    const slugCandidates = Array.from(new Set([
        ...extractPropertySlugsFromUrls(sourceText),
        ...extractPropertySlugCandidatesFromText(sourceText),
    ])).slice(0, 30);

    if (slugCandidates.length > 0) {
        const slugMatch = await db.property.findFirst({
            where: {
                locationId,
                OR: slugCandidates.map((slug) => ({
                    slug: { equals: slug, mode: "insensitive" },
                })),
            },
            select: { id: true },
        });
        if (slugMatch?.id) {
            return { propertyId: slugMatch.id, source: "exact_slug" };
        }
    }

    return { propertyId: null, source: "none" };
}

const SelectionViewingSuggestionSchema = z.object({
    propertyDescription: z.string().describe("The name, title, reference, or description of the property being viewed."),
    propertyId: z.string().optional().nullable().describe("Resolved property ID for exact reference/slug matches. Null if no deterministic match."),
    date: z.string().optional().nullable().describe("The date of the viewing, in ISO 8601 format (YYYY-MM-DD). If no clear date is mentioned, leave null."),
    time: z.string().optional().nullable().describe("The time of the viewing, in HH:mm format (24-hour). If no clear time is mentioned, leave null."),
    duration: z.coerce.number().int().min(15).max(480).multipleOf(15).optional().nullable().describe("Viewing duration in minutes using 15-minute increments. Default to 30 when not specified."),
    notes: z.string().optional().nullable().describe("Any additional notes or context about the viewing, such as the person attending or specific requirements."),
});

const SelectionViewingSuggestionEnvelopeSchema = z.object({
    suggestions: z.array(SelectionViewingSuggestionSchema).max(MAX_TASK_SUGGESTIONS),
});

export type SelectionViewingSuggestion = z.infer<typeof SelectionViewingSuggestionSchema>;

const VIEWING_DURATION_DEFAULT = 30;
const VIEWING_DURATION_STEP = 15;
const VIEWING_DURATION_MIN = 15;
const VIEWING_DURATION_MAX = 480;

function normalizeViewingDurationMinutes(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return VIEWING_DURATION_DEFAULT;
    const snapped = Math.round(parsed / VIEWING_DURATION_STEP) * VIEWING_DURATION_STEP;
    return Math.min(VIEWING_DURATION_MAX, Math.max(VIEWING_DURATION_MIN, snapped));
}

export async function suggestViewingsFromSelection(
    conversationId: string,
    selectionText: string,
    requestedModelId?: string,
    contextInput?: SuggestViewingsContextInput
) {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
        return { success: false, error: "Unauthorized" as const };
    }

    const trimmedText = trimSelectionText(selectionText, MAX_SELECTION_TEXT_LENGTH);
    if (!trimmedText) {
        return { success: false, error: "No text provided" as const };
    }

    if (trimmedText.split(/\s+/).length < 2) {
        return { success: false, error: "Selection is too short to suggest viewings." as const };
    }

    const location = await getAuthenticatedLocationReadOnly({ requireGhlToken: false });
    const conversation = await db.conversation.findFirst({
        where: {
            id: conversationId,
            locationId: location.id,
        },
        select: {
            id: true,
            contactId: true,
            contact: {
                select: {
                    name: true,
                    firstName: true,
                    email: true,
                    phone: true,
                    propertiesInterested: true,
                    requirementDistrict: true,
                    requirementBedrooms: true,
                    requirementPropertyTypes: true,
                    requirementPropertyLocations: true,
                    requirementCondition: true,
                    requirementMinPrice: true,
                    requirementMaxPrice: true,
                    requirementOtherDetails: true,
                }
            }
        }
    });

    if (!conversation) {
        return { success: false, error: "Conversation not found" as const };
    }

    const context = contextInput || {};
    const clientTimeZone = normalizeIanaTimeZone(context.clientTimeZone);
    const anchorContext = await resolveViewingAnchorDate({
        conversationInternalId: conversation.id,
        anchorMessageId: context.anchorMessageId,
        clientNowIso: context.clientNowIso,
    });
    const anchorDateIso = formatIsoDateInTimeZone(anchorContext.anchorDate, clientTimeZone);
    const anchorTomorrowIso = shiftIsoDate(anchorDateIso, 1) || anchorDateIso;

    const modelId = requestedModelId || getModelForTask("suggest_viewings");

    await persistViewingsSuggestionFunnelEvent({
        type: VIEWINGS_SUGGESTION_FUNNEL_EVENT_TYPES.generateRequested,
        conversationInternalId: conversation.id,
        contactId: conversation.contactId,
        payload: {
            source: "selection_toolbar",
            selectedTextLength: trimmedText.length,
            modelId,
            anchorSource: anchorContext.anchorSource,
            anchorMessageId: anchorContext.anchorMessageId,
            anchorDateIso,
            clientTimeZone,
        },
    });

    const systemPrompt = `You are an AI assistant helping a real estate agent extract property viewing appointments from conversation text.
Given a snippet of text, your job is to identify any properties the client wants to view, along with the date and time if specified.
Extract the property description, date (YYYY-MM-DD), time (HH:mm), and any relevant notes.
If multiple viewings are mentioned, extract them all.
Return a maximum of ${MAX_TASK_SUGGESTIONS} suggestions.

DATE RESOLUTION RULES:
- Relative dates must be converted to absolute dates using this anchor timezone and date:
  - Timezone: ${clientTimeZone}
  - Anchor date ("today"): ${anchorDateIso}
  - "tomorrow": ${anchorTomorrowIso}
- For weekday names (e.g. Monday), resolve to the next upcoming weekday after the anchor date.
- Never return relative words like "today" or "tomorrow" in the date field.

OUTPUT FORMAT:
You must return a valid JSON object matching this schema:
{
  "suggestions": [
    {
      "propertyDescription": "string",
      "propertyId": "string or null",
      "date": "YYYY-MM-DD or null",
      "time": "HH:mm or null",
      "notes": "string or null",
      "duration": "number or null"
    }
  ]
}`;

    const interestedPropIds = conversation.contact?.propertiesInterested || [];
    let interestedPropertiesText = "None explicitly specified in profile.";
    if (interestedPropIds.length > 0) {
        const props = await db.property.findMany({
            where: { id: { in: interestedPropIds } },
            select: { title: true, reference: true, city: true }
        });
        if (props.length > 0) {
            interestedPropertiesText = props.map(p => `- ${p.title} (Ref: ${p.reference || 'N/A'}, City: ${p.city || 'Unknown'})`).join("\n");
        }
    }

    const reqs = conversation.contact ? [
        conversation.contact.requirementDistrict?.includes("Any") ? null : `District: ${conversation.contact.requirementDistrict}`,
        conversation.contact.requirementBedrooms?.includes("Any") ? null : `Bedrooms: ${conversation.contact.requirementBedrooms}`,
        conversation.contact.requirementPropertyTypes?.length ? `Types: ${conversation.contact.requirementPropertyTypes.join(", ")}` : null,
        conversation.contact.requirementPropertyLocations?.length ? `Locations: ${conversation.contact.requirementPropertyLocations.join(", ")}` : null,
        conversation.contact.requirementMinPrice !== "Any" || conversation.contact.requirementMaxPrice !== "Any"
            ? `Price Range: ${conversation.contact.requirementMinPrice} - ${conversation.contact.requirementMaxPrice}` : null,
        conversation.contact.requirementCondition?.includes("Any") ? null : `Condition: ${conversation.contact.requirementCondition}`,
        conversation.contact.requirementOtherDetails ? `Other Notes: ${conversation.contact.requirementOtherDetails}` : null,
    ].filter(Boolean).join("\n") || "No specific requirements recorded." : "No specific requirements recorded.";

    const promptText = `Extract viewing suggestions from the following text snippet.

Contact Context:
Name: ${conversation.contact?.name || conversation.contact?.firstName || 'Unknown'}

Contact's Interested Properties:
${interestedPropertiesText}

Contact's Real Estate Requirements:
${reqs}

Anchor Context:
- Anchor Source: ${anchorContext.anchorSource}
- Anchor Message ID: ${anchorContext.anchorMessageId || "none"}
- Anchor Date (today): ${anchorDateIso}
- Tomorrow Date: ${anchorTomorrowIso}
- Timezone: ${clientTimeZone}

Text Snippet:
"""
${trimmedText}
"""`;

    try {
        const startMs = Date.now();
        const result = await callLLMWithMetadata(
            modelId,
            systemPrompt,
            promptText,
            { jsonMode: true, temperature: 0.2 }
        );
        const latencyMs = Date.now() - startMs;

        const rawJsonRaw = String(result.text || "").trim();
        let rawJson = rawJsonRaw;
        if (rawJsonRaw.startsWith("\`\`\`json")) {
            rawJson = rawJsonRaw.replace(/^\`\`\`json/, "").replace(/\`\`\`$/, "").trim();
        }

        let parsedData: unknown;
        try {
            parsedData = JSON.parse(rawJson);
        } catch (parseError) {
            console.error("[suggestViewings] JSON parse error:", parseError, "Raw output:", rawJson);
            throw new Error("AI returned invalid JSON formatting.");
        }

        const validation = SelectionViewingSuggestionEnvelopeSchema.safeParse(parsedData);
        if (!validation.success) {
            console.error("[suggestViewings] Schema validation error:", validation.error);
            throw new Error("AI returned data that didn't match the expected schema.");
        }

        const resolvedSuggestions = await Promise.all(validation.data.suggestions.map(async (rawSuggestion) => {
            const sourceText = [
                rawSuggestion.propertyDescription,
                rawSuggestion.notes,
                trimmedText,
            ].filter(Boolean).join("\n");

            const propertyMatch = await resolveExactViewingPropertyMatch(location.id, sourceText);
            const llmDate = normalizeViewingDate(rawSuggestion.date);

            let date = llmDate;
            let dateResolutionSource: ViewingDateResolutionSource = llmDate ? "llm" : "fallback";
            if (!date) {
                const deterministicDate = resolveRelativeViewingDateFromText({
                    text: sourceText,
                    anchorDate: anchorContext.anchorDate,
                    timeZone: clientTimeZone,
                });
                if (deterministicDate) {
                    date = deterministicDate;
                    dateResolutionSource = "deterministic";
                }
            }

            const time = normalizeViewingTime(rawSuggestion.time) || extractClockTimeFromText(sourceText);

            return {
                suggestion: {
                    propertyDescription: String(rawSuggestion.propertyDescription || "").trim(),
                    propertyId: propertyMatch.propertyId,
                    date: date || null,
                    time: time || null,
                    duration: normalizeViewingDurationMinutes(rawSuggestion.duration),
                    notes: rawSuggestion.notes || null,
                },
                dateResolutionSource,
                propertyResolutionSource: propertyMatch.source,
            };
        }));

        const dateResolutionSources = resolvedSuggestions.map((item) => item.dateResolutionSource);
        const propertyResolutionSources = resolvedSuggestions.map((item) => item.propertyResolutionSource);
        const normalizedSuggestions = resolvedSuggestions.map((item) => item.suggestion);
        await persistSelectionAiExecution({
            conversationInternalId: conversation.id,
            taskTitle: "Suggest Viewings from Selection",
            intent: "extract_viewings",
            modelId,
            promptText: `${systemPrompt}\n\n${promptText}`,
            rawOutput: rawJsonRaw,
            normalizedOutput: JSON.stringify({
                suggestions: normalizedSuggestions,
                dateResolutionSources,
                propertyResolutionSources,
                anchorSource: anchorContext.anchorSource,
                anchorDateIso,
                clientTimeZone,
            }),
            usage: {
                promptTokens: result.usage.promptTokens,
                completionTokens: result.usage.completionTokens,
                totalTokens: result.usage.totalTokens,
            },
        });

        await persistViewingsSuggestionFunnelEvent({
            type: VIEWINGS_SUGGESTION_FUNNEL_EVENT_TYPES.generateSucceeded,
            conversationInternalId: conversation.id,
            contactId: conversation.contactId,
            payload: {
                source: "selection_toolbar",
                suggestionCount: normalizedSuggestions.length,
                modelId,
                latencyMs,
                anchorSource: anchorContext.anchorSource,
                anchorDateIso,
                clientTimeZone,
                dateResolutionSourceCounts: countSources(dateResolutionSources),
                propertyResolutionSourceCounts: countSources(propertyResolutionSources),
            },
        });

        return {
            success: true as const,
            suggestions: normalizedSuggestions,
            contactId: conversation.contactId,
        };

    } catch (error: any) {
        console.error("[suggestViewings] Failed:", error);
        if (conversation) {
            await persistViewingsSuggestionFunnelEvent({
                type: VIEWINGS_SUGGESTION_FUNNEL_EVENT_TYPES.generateFailed,
                conversationInternalId: conversation.id,
                contactId: conversation.contactId,
                payload: {
                    source: "selection_toolbar",
                    error: error?.message || "Failed to generate viewing suggestions",
                },
                status: "error",
                error: error?.message || "Failed to generate viewing suggestions",
            });
        }
        return {
            success: false as const,
            error: error?.message || "Failed to generate viewing suggestions",
        };
    }
}

const ApplySelectionViewingSuggestionSchema = z.object({
    propertyId: z.string().min(1),
    propertyDescription: z.string(),
    userId: z.string().min(1),
    date: z.string().min(1),
    time: z.string().optional().nullable(),
    scheduledAtIso: z.string().optional().nullable(),
    scheduledLocal: z.string().optional().nullable(),
    scheduledTimeZone: z.string().optional().nullable(),
    duration: z.coerce.number().int().min(15).max(480).multipleOf(15).default(30),
    notes: z.string().optional().nullable(),
});

const ApplySelectionViewingSuggestionBatchSchema = z.array(ApplySelectionViewingSuggestionSchema).min(1).max(MAX_TASK_SUGGESTIONS);

export type ApplySuggestedViewingWarning = {
    description: string;
    queuedProviders: string[];
    skippedProviders: ViewingSyncProviderDecision[];
};

export async function applySuggestedViewingsFromSelection(
    conversationId: string,
    contactId: string,
    suggestionsInput: Array<z.input<typeof ApplySelectionViewingSuggestionSchema>>
) {
    const { createViewing } = await import("@/app/(main)/admin/contacts/actions");

    const sanitizedConversationId = String(conversationId || "").trim();
    if (!sanitizedConversationId || !contactId) {
        return { success: false as const, error: "Missing conversation or contact ID" };
    }

    const parsedSuggestions = ApplySelectionViewingSuggestionBatchSchema.safeParse(suggestionsInput || []);
    if (!parsedSuggestions.success) {
        return { success: false as const, error: "No valid viewing suggestions to apply" };
    }

    const suggestions = parsedSuggestions.data;

    let conversationForTelemetry: { id: string; contactId: string } | null = null;

    try {
        const location = await getAuthenticatedLocation();
        const conversation = await resolveConversationForCrmLog(location.id, sanitizedConversationId);
        if (!conversation) {
            return { success: false as const, error: "Conversation not found" };
        }

        conversationForTelemetry = {
            id: conversation.id,
            contactId: conversation.contactId,
        };

        await persistViewingsSuggestionFunnelEvent({
            type: VIEWINGS_SUGGESTION_FUNNEL_EVENT_TYPES.applyRequested,
            conversationInternalId: conversation.id,
            contactId: conversation.contactId,
            payload: {
                source: "selection_toolbar",
                selectedCount: suggestions.length,
            },
        });

        let createdCount = 0;
        const failed: Array<{ description: string; error: string }> = [];
        const warnings: ApplySuggestedViewingWarning[] = [];

        for (const suggestion of suggestions) {
            const formData = new FormData();
            formData.append('contactId', contactId);
            formData.append('propertyId', suggestion.propertyId);
            formData.append('userId', suggestion.userId);

            const scheduledLocalFromSuggestion = String(suggestion.scheduledLocal || "").trim();
            const scheduledTimeZoneFromSuggestion = String(suggestion.scheduledTimeZone || "").trim();
            const derivedLocal = (
                scheduledLocalFromSuggestion ||
                (suggestion.date && suggestion.time ? `${suggestion.date}T${suggestion.time}` : "")
            ).trim();

            let scheduledAtIso = String(suggestion.scheduledAtIso || "").trim();
            if (scheduledAtIso) {
                const parsedScheduledAt = new Date(scheduledAtIso);
                if (Number.isNaN(parsedScheduledAt.getTime())) {
                    scheduledAtIso = "";
                }
            }

            if (derivedLocal) {
                formData.append('scheduledLocal', derivedLocal);
            }
            if (scheduledTimeZoneFromSuggestion) {
                formData.append('scheduledTimeZone', scheduledTimeZoneFromSuggestion);
            }
            if (scheduledAtIso) {
                formData.append('scheduledAtIso', scheduledAtIso);
            }

            // Backward-compatible fallback field consumed by hardened parser as a secondary source.
            formData.append('date', scheduledAtIso || derivedLocal || new Date().toISOString());
            formData.append('duration', String(suggestion.duration || 30));
            formData.append('notes', suggestion.notes || '');
            formData.append('duration', String(normalizeViewingDurationMinutes(suggestion.duration)));

            const result = await createViewing(null, formData);

            if (result?.success) {
                createdCount += 1;
                if ((result.skippedProviders?.length || 0) > 0) {
                    warnings.push({
                        description: suggestion.propertyDescription,
                        queuedProviders: Array.isArray(result.queuedProviders) ? result.queuedProviders : [],
                        skippedProviders: Array.isArray(result.skippedProviders) ? result.skippedProviders : [],
                    });
                }
                continue;
            }

            failed.push({
                description: suggestion.propertyDescription,
                error: String(result?.message || "Unknown error"),
            });
        }

        await persistViewingsSuggestionFunnelEvent({
            type: VIEWINGS_SUGGESTION_FUNNEL_EVENT_TYPES.applyCompleted,
            conversationInternalId: conversation.id,
            contactId: conversation.contactId,
            payload: {
                source: "selection_toolbar",
                selectedCount: suggestions.length,
                createdCount,
                failedCount: failed.length,
                warningCount: warnings.length,
                failedDescriptions: failed.map((item) => item.description),
                failedErrors: failed
                    .map((item) => normalizeSingleLine(item.error, "Unknown error").slice(0, 180))
                    .filter(Boolean),
                warningDescriptions: warnings.map((item) => item.description),
                warningReasons: warnings
                    .flatMap((item) => item.skippedProviders.map((provider) => `${provider.provider}:${provider.reason}`))
                    .slice(0, 12),
            },
        });

        return {
            success: true as const,
            selectedCount: suggestions.length,
            createdCount,
            failedCount: failed.length,
            failed,
            warnings,
        };
    } catch (error: any) {
        const errorMessage = error?.message || "Failed to apply viewing suggestions";
        console.error("[applySuggestedViewingsFromSelection] Error:", error);

        if (conversationForTelemetry) {
            await persistViewingsSuggestionFunnelEvent({
                type: VIEWINGS_SUGGESTION_FUNNEL_EVENT_TYPES.applyFailed,
                conversationInternalId: conversationForTelemetry.id,
                contactId: conversationForTelemetry.contactId,
                payload: {
                    source: "selection_toolbar",
                    selectedCount: suggestions.length,
                    error: errorMessage,
                },
                status: "error",
                error: errorMessage,
            });
        }

        return { success: false as const, error: errorMessage };
    }
}

const VIEWINGS_SUGGESTION_FUNNEL_EVENT_TYPES = {
    generateRequested: "viewings_suggestion.generate.requested",
    generateSucceeded: "viewings_suggestion.generate.succeeded",
    generateFailed: "viewings_suggestion.generate.failed",
    applyRequested: "viewings_suggestion.apply.requested",
    applyCompleted: "viewings_suggestion.apply.completed",
    applyFailed: "viewings_suggestion.apply.failed",
} as const;

const VIEWINGS_SUGGESTION_FUNNEL_EVENT_TYPE_VALUES = Object.values(VIEWINGS_SUGGESTION_FUNNEL_EVENT_TYPES);
export type ViewingsSuggestionFunnelEventType = typeof VIEWINGS_SUGGESTION_FUNNEL_EVENT_TYPES[keyof typeof VIEWINGS_SUGGESTION_FUNNEL_EVENT_TYPES];

export async function persistViewingsSuggestionFunnelEvent(args: {
    type: ViewingsSuggestionFunnelEventType;
    conversationInternalId: string;
    contactId: string;
    payload: Record<string, unknown>;
    status?: "processed" | "error";
    error?: string | null;
}) {
    try {
        await db.agentEvent.create({
            data: {
                type: args.type,
                payload: args.payload as any,
                conversationId: args.conversationInternalId,
                contactId: args.contactId,
                status: args.status || "processed",
                error: args.error || null,
            },
        });
    } catch (eventError) {
        console.warn("[viewingsSuggestionFunnel] Failed to persist event:", args.type, eventError);
    }
}

const ViewingsSuggestionFunnelMetricsInputSchema = z.object({
    days: z.number().int().min(1).max(180).optional(),
    scope: z.enum(["location", "conversation"]).default("location"),
    conversationId: z.string().trim().optional(),
}).optional();

export async function getViewingsSuggestionFunnelMetrics(input?: z.input<typeof ViewingsSuggestionFunnelMetricsInputSchema>) {
    const parsedInput = ViewingsSuggestionFunnelMetricsInputSchema.safeParse(input);
    if (!parsedInput.success) {
        return { success: false as const, error: "Invalid metrics query" };
    }

    const location = await getAuthenticatedLocation();
    const config = parsedInput.data;
    const days = config?.days || 30;
    const scope: "location" | "conversation" = config?.scope || "location";
    const now = new Date();
    const since = new Date(now.getTime() - (days * 24 * 60 * 60 * 1000));

    let scopedConversationId: string | null = null;
    if (scope === "conversation") {
        const requestedConversationId = String(config?.conversationId || "").trim();
        if (!requestedConversationId) {
            return { success: false as const, error: "Conversation ID is required for conversation metrics" };
        }

        const conversation = await resolveConversationForCrmLog(location.id, requestedConversationId);
        if (!conversation) {
            return { success: false as const, error: "Conversation not found" };
        }

        scopedConversationId = conversation.id;
    }

    const rawEvents = await db.agentEvent.findMany({
        where: {
            type: { in: [...VIEWINGS_SUGGESTION_FUNNEL_EVENT_TYPE_VALUES] },
            processedAt: { gte: since },
            ...(scopedConversationId ? { conversationId: scopedConversationId } : {}),
        },
        select: {
            type: true,
            payload: true,
            error: true,
            processedAt: true,
            conversationId: true,
        },
        orderBy: { processedAt: "asc" },
    });

    let scopedEvents = rawEvents;
    if (!scopedConversationId) {
        const conversationIds = Array.from(new Set(
            rawEvents
                .map((item) => item.conversationId)
                .filter((item): item is string => Boolean(item))
        ));

        if (conversationIds.length > 0) {
            const allowed = await db.conversation.findMany({
                where: {
                    id: { in: conversationIds },
                    locationId: location.id,
                },
                select: { id: true },
            });
            const allowedIds = new Set(allowed.map((item) => item.id));
            scopedEvents = rawEvents.filter((item) => item.conversationId ? allowedIds.has(item.conversationId) : false);
        } else {
            scopedEvents = [];
        }
    }

    const totals = {
        generateRequested: 0,
        generateSucceeded: 0,
        generateFailed: 0,
        applyRequested: 0,
        applyCompleted: 0,
        applyFailed: 0,
        suggestionsGenerated: 0,
        selectedForApply: 0,
        viewingsCreated: 0,
        viewingsFailed: 0,
    };

    type DailyPoint = {
        date: string;
        generateRequested: number;
        generateSucceeded: number;
        generateFailed: number;
        applyRequested: number;
        applyCompleted: number;
        applyFailed: number;
        suggestionsGenerated: number;
        selectedForApply: number;
        viewingsCreated: number;
        viewingsFailed: number;
    };

    const ensureDailyPoint = (map: Map<string, DailyPoint>, date: string): DailyPoint => {
        const existing = map.get(date);
        if (existing) return existing;
        const created: DailyPoint = {
            date,
            generateRequested: 0,
            generateSucceeded: 0,
            generateFailed: 0,
            applyRequested: 0,
            applyCompleted: 0,
            applyFailed: 0,
            suggestionsGenerated: 0,
            selectedForApply: 0,
            viewingsCreated: 0,
            viewingsFailed: 0,
        };
        map.set(date, created);
        return created;
    };

    let generationLatencyTotalMs = 0;
    let generationLatencySamples = 0;
    const dailyMap = new Map<string, DailyPoint>();
    const failureMap = new Map<string, number>();

    for (const event of scopedEvents) {
        const payload = getPayloadObject(event.payload);
        const point = ensureDailyPoint(dailyMap, toIsoDayKey(event.processedAt));

        switch (event.type) {
            case VIEWINGS_SUGGESTION_FUNNEL_EVENT_TYPES.generateRequested: {
                totals.generateRequested += 1;
                point.generateRequested += 1;
                break;
            }
            case VIEWINGS_SUGGESTION_FUNNEL_EVENT_TYPES.generateSucceeded: {
                totals.generateSucceeded += 1;
                point.generateSucceeded += 1;

                const suggestionCount = Math.max(0, Math.round(getPayloadNumber(payload, "suggestionCount")));
                totals.suggestionsGenerated += suggestionCount;
                point.suggestionsGenerated += suggestionCount;

                const latencyMs = getPayloadNumber(payload, "latencyMs");
                if (latencyMs > 0) {
                    generationLatencyTotalMs += latencyMs;
                    generationLatencySamples += 1;
                }
                break;
            }
            case VIEWINGS_SUGGESTION_FUNNEL_EVENT_TYPES.generateFailed: {
                totals.generateFailed += 1;
                point.generateFailed += 1;
                break;
            }
            case VIEWINGS_SUGGESTION_FUNNEL_EVENT_TYPES.applyRequested: {
                totals.applyRequested += 1;
                point.applyRequested += 1;

                const selectedCount = Math.max(0, Math.round(getPayloadNumber(payload, "selectedCount")));
                totals.selectedForApply += selectedCount;
                point.selectedForApply += selectedCount;
                break;
            }
            case VIEWINGS_SUGGESTION_FUNNEL_EVENT_TYPES.applyCompleted: {
                totals.applyCompleted += 1;
                point.applyCompleted += 1;

                const createdCount = Math.max(0, Math.round(getPayloadNumber(payload, "createdCount")));
                const failedCount = Math.max(0, Math.round(getPayloadNumber(payload, "failedCount")));

                totals.viewingsCreated += createdCount;
                point.viewingsCreated += createdCount;
                totals.viewingsFailed += failedCount;
                point.viewingsFailed += failedCount;

                if (failedCount > 0) {
                    const failedErrors = payload.failedErrors;
                    if (Array.isArray(failedErrors) && failedErrors.length > 0) {
                        for (const rawError of failedErrors) {
                            const reason = normalizeSingleLine(String(rawError || ""), "Unknown error").slice(0, 180);
                            if (!reason) continue;
                            failureMap.set(reason, (failureMap.get(reason) || 0) + 1);
                        }
                    } else {
                        const fallbackReason = "One or more viewing creates failed";
                        failureMap.set(fallbackReason, (failureMap.get(fallbackReason) || 0) + 1);
                    }
                }
                break;
            }
            case VIEWINGS_SUGGESTION_FUNNEL_EVENT_TYPES.applyFailed: {
                totals.applyFailed += 1;
                point.applyFailed += 1;
                break;
            }
        }

        if (
            event.type === VIEWINGS_SUGGESTION_FUNNEL_EVENT_TYPES.generateFailed
            || event.type === VIEWINGS_SUGGESTION_FUNNEL_EVENT_TYPES.applyFailed
        ) {
            const reasonRaw = String(payload.error || event.error || "Unknown error");
            const reason = normalizeSingleLine(reasonRaw, "Unknown error").slice(0, 180);
            failureMap.set(reason, (failureMap.get(reason) || 0) + 1);
        }
    }

    const rates = {
        generateSuccessRate: safeRatio(totals.generateSucceeded, totals.generateRequested),
        applyStartRate: safeRatio(totals.applyRequested, totals.generateSucceeded),
        applySuccessRate: safeRatio(totals.applyCompleted, totals.applyRequested),
        selectedToViewingConversion: safeRatio(totals.viewingsCreated, totals.selectedForApply),
    };

    const averages = {
        suggestionsPerGeneration: safeRatio(totals.suggestionsGenerated, totals.generateSucceeded),
        viewingsPerApply: safeRatio(totals.viewingsCreated, totals.applyCompleted),
        generationLatencyMs: generationLatencySamples > 0 ? (generationLatencyTotalMs / generationLatencySamples) : 0,
    };

    const daily = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));
    const failures = Array.from(failureMap.entries())
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

    return {
        success: true as const,
        totals,
        rates,
        averages,
        daily,
        failures,
    };
}

export async function getDropdownsForViewingsSuggestion() {
    try {
        const location = await getAuthenticatedLocationReadOnly();
        if (!location?.id) return { properties: [], users: [] };

        const [properties, users] = await Promise.all([
            db.property.findMany({
                where: { locationId: location.id },
                select: { id: true, title: true, reference: true, unitNumber: true },
                orderBy: { reference: 'asc' },
            }),
            db.user.findMany({
                where: { locations: { some: { id: location.id } } },
                select: { id: true, name: true, email: true, timeZone: true },
                orderBy: { name: 'asc' },
            })
        ]);
        const fallbackTimeZone = (location as any).timeZone || null;
        const usersWithTimeZone = users.map((user) => ({
            ...user,
            effectiveTimeZone: user.timeZone || fallbackTimeZone,
        }));
        return { properties, users: usersWithTimeZone };
    } catch (error) {
        console.error("Failed to fetch dropdowns for viewings suggestion:", error);
        return { properties: [], users: [] };
    }
}

export async function fetchConversationActivityLog(conversationId: string) {
    const location = await getAuthenticatedLocationReadOnly();
    if (!location?.id) return [];

    const timeline = await assembleTimelineEvents({
        mode: "chat",
        locationId: location.id,
        conversationId,
        includeMessages: false,
        includeActivities: true,
    });

    return timeline.events
        .filter((event) => event.kind === "activity")
        .map((event) => ({
        id: event.id,
        type: 'activity',
        createdAt: event.createdAt,
        action: event.action,
        changes: event.changes,
        user: event.user || null,
    }));
}

export async function addConversationActivityEntry(conversationId: string, entryText: string, dateIso: string) {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) throw new Error("Unauthorized");

    const location = await getAuthenticatedLocationReadOnly();

    const user = await db.user.findUnique({
        where: { clerkId: clerkUserId },
        select: { id: true, firstName: true, name: true, email: true }
    });

    if (!user) throw new Error("User not found");

    const conversation = await db.conversation.findFirst({
        where: {
            locationId: location.id,
            OR: [
                { id: conversationId },
                { ghlConversationId: conversationId },
            ]
        },
        select: { id: true, contactId: true, ghlConversationId: true }
    });

    if (!conversation?.contactId) throw new Error("Conversation not found");

    const actorFirstName = deriveFirstName(user.firstName, user.name, user.email);
    const entry = formatCrmLogEntry(actorFirstName, entryText, new Date(dateIso));

    await db.contactHistory.create({
        data: {
            contactId: conversation.contactId,
            userId: user.id,
            action: 'MANUAL_ENTRY',
            changes: {
                date: dateIso,
                entry
            }
        }
    });

    revalidatePath(`/admin/contacts/${conversation.contactId}/view`);
    revalidatePath(`/admin/conversations?id=${encodeURIComponent(conversation.ghlConversationId)}`);
    invalidateConversationReadCaches(conversation.ghlConversationId);
    emitConversationRealtimeEvent({
        locationId: location.id,
        conversationId: conversation.ghlConversationId,
        type: "activity.created",
    });

    return { success: true };
}

type ListSuggestedResponsesInput = {
    conversationId?: string | null;
    dealId?: string | null;
    status?: "pending" | "accepted" | "rejected" | "sent" | "expired" | "all";
    limit?: number;
};

function getComposerChannelFromMessageType(lastMessageType?: string | null): 'SMS' | 'Email' | 'WhatsApp' {
    const normalized = String(lastMessageType || "").toUpperCase();
    if (normalized.includes("EMAIL")) return "Email";
    if (normalized.includes("WHATSAPP")) return "WhatsApp";
    return "SMS";
}

export async function listSuggestedResponses(input: ListSuggestedResponsesInput) {
    const location = await getAuthenticatedLocationReadOnly({ requireGhlToken: false });

    const requestedConversationId = String(input?.conversationId || "").trim();
    const requestedDealId = String(input?.dealId || "").trim();
    const status = input?.status || "pending";
    const limit = Math.max(1, Math.min(100, Number(input?.limit || 30)));

    let scopedConversationInternalId: string | null = null;
    if (requestedConversationId) {
        const conversation = await db.conversation.findFirst({
            where: {
                locationId: location.id,
                OR: [
                    { id: requestedConversationId },
                    { ghlConversationId: requestedConversationId },
                ],
            },
            select: { id: true },
        });
        if (!conversation) return [];
        scopedConversationInternalId = conversation.id;
    }

    let dealConversationInternalIds: string[] = [];
    if (requestedDealId) {
        const deal = await db.dealContext.findFirst({
            where: {
                id: requestedDealId,
                locationId: location.id,
            },
            select: {
                id: true,
                conversationIds: true,
            },
        });

        if (!deal) return [];

        const dealConversations = await db.conversation.findMany({
            where: {
                locationId: location.id,
                ghlConversationId: { in: deal.conversationIds || [] },
            },
            select: { id: true },
        });
        dealConversationInternalIds = dealConversations.map((item) => item.id);
    }

    const filterBlocks: Prisma.AiSuggestedResponseWhereInput[] = [];
    if (scopedConversationInternalId) {
        filterBlocks.push({ conversationId: scopedConversationInternalId });
    }
    if (requestedDealId) {
        filterBlocks.push({ dealId: requestedDealId });
        if (dealConversationInternalIds.length > 0) {
            filterBlocks.push({ conversationId: { in: dealConversationInternalIds } });
        }
    }

    if (filterBlocks.length === 0) {
        return [];
    }

    const rows = await db.aiSuggestedResponse.findMany({
        where: {
            locationId: location.id,
            ...(status === "all" ? {} : { status }),
            OR: filterBlocks,
        },
        include: {
            conversation: {
                select: {
                    id: true,
                    ghlConversationId: true,
                    lastMessageType: true,
                },
            },
            contact: {
                select: {
                    id: true,
                    name: true,
                    email: true,
                    phone: true,
                },
            },
            decision: {
                select: {
                    id: true,
                    selectedSkillId: true,
                    selectedObjective: true,
                    selectedScore: true,
                    holdReason: true,
                    scoreBreakdown: true,
                    source: true,
                },
            },
        },
        orderBy: { createdAt: "desc" },
        take: limit,
    });

    return rows.map((row) => ({
        id: row.id,
        body: row.body,
        source: row.source,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        conversationId: row.conversation?.ghlConversationId || row.conversation?.id || null,
        contactId: row.contactId || row.contact?.id || null,
        contactName: row.contact?.name || null,
        contactEmail: row.contact?.email || null,
        contactPhone: row.contact?.phone || null,
        dealId: row.dealId || null,
        traceId: row.traceId || null,
        decisionId: row.decisionId || row.decision?.id || null,
        metadata: row.metadata || null,
        decision: row.decision ? {
            id: row.decision.id,
            selectedSkillId: row.decision.selectedSkillId || null,
            selectedObjective: row.decision.selectedObjective || null,
            selectedScore: row.decision.selectedScore || null,
            holdReason: row.decision.holdReason || null,
            source: row.decision.source || null,
            scoreBreakdown: row.decision.scoreBreakdown || null,
        } : null,
    }));
}

export async function acceptSuggestedResponse(
    id: string,
    options?: {
        mode?: "insertOnly" | "sendNow";
        insertOnly?: boolean;
        sendNow?: boolean;
    }
) {
    const location = await getAuthenticatedLocationReadOnly({ requireGhlToken: false });
    const actor = await resolveLocationActorContext(location.id);
    if (!actor.hasAccess) {
        return { success: false as const, error: "Unauthorized" };
    }

    const mode = (options?.mode === "sendNow" || options?.sendNow === true)
        ? "sendNow"
        : "insertOnly";
    const trimmedId = String(id || "").trim();
    if (!trimmedId) {
        return { success: false as const, error: "Missing suggested response ID." };
    }

    const suggestion = await db.aiSuggestedResponse.findFirst({
        where: {
            id: trimmedId,
            locationId: location.id,
        },
        include: {
            conversation: {
                select: {
                    id: true,
                    ghlConversationId: true,
                    contactId: true,
                    lastMessageType: true,
                },
            },
        },
    });

    if (!suggestion) {
        return { success: false as const, error: "Suggested response not found." };
    }

    if (suggestion.status === "rejected" || suggestion.status === "expired") {
        return { success: false as const, error: `Cannot accept a ${suggestion.status} suggestion.` };
    }

    const acceptedAt = new Date();
    if (mode === "insertOnly" && suggestion.status !== "accepted" && suggestion.status !== "sent") {
        await db.aiSuggestedResponse.update({
            where: { id: suggestion.id },
            data: {
                status: "accepted",
                acceptedAt,
                acceptedByUserId: actor.userId || null,
            },
        });
    }

    if (mode === "sendNow") {
        if (!suggestion.conversation?.ghlConversationId) {
            return { success: false as const, error: "Suggestion is not linked to an active conversation." };
        }

        const sendType = getComposerChannelFromMessageType(suggestion.conversation.lastMessageType);
        const targetContactId = suggestion.contactId || suggestion.conversation.contactId;
        const sendResult = await sendReply(
            suggestion.conversation.ghlConversationId,
            targetContactId,
            suggestion.body,
            sendType
        );

        if (!sendResult?.success) {
            return {
                success: false as const,
                error: String((sendResult as any)?.error || "Failed to send accepted suggestion."),
            };
        }

        await db.aiSuggestedResponse.update({
            where: { id: suggestion.id },
            data: {
                status: "sent",
                sentAt: new Date(),
                acceptedAt: suggestion.acceptedAt || acceptedAt,
                acceptedByUserId: suggestion.acceptedByUserId || actor.userId || null,
            },
        });
    }

    if (suggestion.conversation?.ghlConversationId) {
        invalidateConversationReadCaches(suggestion.conversation.ghlConversationId);
        emitConversationRealtimeEvent({
            locationId: location.id,
            conversationId: suggestion.conversation.ghlConversationId,
            type: "suggested_response.accepted",
            payload: { id: suggestion.id, mode },
        });
    }

    return {
        success: true as const,
        mode,
        body: suggestion.body,
        id: suggestion.id,
        status: mode === "sendNow" ? "sent" : "accepted",
    };
}

export async function rejectSuggestedResponse(id: string, reason?: string | null) {
    const location = await getAuthenticatedLocationReadOnly({ requireGhlToken: false });
    const actor = await resolveLocationActorContext(location.id);
    if (!actor.hasAccess) {
        return { success: false as const, error: "Unauthorized" };
    }

    const trimmedId = String(id || "").trim();
    if (!trimmedId) {
        return { success: false as const, error: "Missing suggested response ID." };
    }

    const suggestion = await db.aiSuggestedResponse.findFirst({
        where: {
            id: trimmedId,
            locationId: location.id,
        },
        include: {
            conversation: {
                select: {
                    ghlConversationId: true,
                },
            },
        },
    });

    if (!suggestion) {
        return { success: false as const, error: "Suggested response not found." };
    }

    const normalizedReason = String(reason || "").trim().slice(0, 500) || "Not a fit";

    await db.aiSuggestedResponse.update({
        where: { id: suggestion.id },
        data: {
            status: "rejected",
            rejectedAt: new Date(),
            rejectedByUserId: actor.userId || null,
            rejectedReason: normalizedReason,
        },
    });

    if (suggestion.conversation?.ghlConversationId) {
        invalidateConversationReadCaches(suggestion.conversation.ghlConversationId);
        emitConversationRealtimeEvent({
            locationId: location.id,
            conversationId: suggestion.conversation.ghlConversationId,
            type: "suggested_response.rejected",
            payload: { id: suggestion.id },
        });
    }

    return { success: true as const, id: suggestion.id };
}

export async function updateAiAutomationConfig(locationId: string, config: unknown) {
    const targetLocationId = String(locationId || "").trim();
    if (!targetLocationId) {
        return { success: false as const, error: "Missing location ID." };
    }

    const actor = await resolveLocationActorContext(targetLocationId);
    if (!actor.hasAccess || !actor.isAdmin) {
        return { success: false as const, error: "Unauthorized: admin access is required." };
    }

    const parsed = AiAutomationConfigSchema.safeParse(config ?? {});
    if (!parsed.success) {
        return {
            success: false as const,
            error: parsed.error.issues[0]?.message || "Invalid automation configuration.",
            issues: parsed.error.issues.map((issue) => ({
                path: issue.path.join("."),
                message: issue.message,
            })),
        };
    }

    const existingDoc = await settingsService.getDocument<any>({
        scopeType: "LOCATION",
        scopeId: targetLocationId,
        domain: SETTINGS_DOMAINS.LOCATION_AI,
    });
    const existingPayload = (existingDoc?.payload && typeof existingDoc.payload === "object")
        ? existingDoc.payload
        : {};

    const mergedPayload = {
        ...existingPayload,
        automationConfig: parsed.data,
    };

    const savedDoc = await settingsService.upsertDocument({
        scopeType: "LOCATION",
        scopeId: targetLocationId,
        domain: SETTINGS_DOMAINS.LOCATION_AI,
        payload: mergedPayload,
        actorUserId: actor.userId || undefined,
    });

    const location = await db.location.findUnique({
        where: { id: targetLocationId },
        select: { id: true, timeZone: true },
    });
    if (!location) {
        return { success: false as const, error: "Location not found." };
    }

    if (!parsed.data.enabled) {
        await db.aiAutomationSchedule.updateMany({
            where: { locationId: targetLocationId },
            data: { enabled: false },
        });
    } else {
        const cadenceMinutesBase = cadenceToDays(parsed.data.followUpCadence) * 24 * 60;
        const now = new Date();

        for (const templateKey of parsed.data.enabledTemplates) {
            const cadenceMinutes = templateKey === "listing_alert"
                ? 60
                : cadenceMinutesBase;
            const schedulePolicy = (parsed.data.schedulePolicies?.[templateKey] && typeof parsed.data.schedulePolicies[templateKey] === "object")
                ? parsed.data.schedulePolicies[templateKey]
                : {};

            await db.aiAutomationSchedule.upsert({
                where: {
                    locationId_triggerType_templateKey: {
                        locationId: targetLocationId,
                        triggerType: templateKey,
                        templateKey,
                    },
                },
                create: {
                    locationId: targetLocationId,
                    name: `Automation: ${templateKey}`,
                    enabled: true,
                    cadenceMinutes,
                    triggerType: templateKey,
                    templateKey,
                    timezone: location.timeZone || "UTC",
                    quietHours: parsed.data.quietHours as any,
                    policy: schedulePolicy as any,
                    nextRunAt: now,
                },
                update: {
                    enabled: true,
                    cadenceMinutes,
                    timezone: location.timeZone || "UTC",
                    quietHours: parsed.data.quietHours as any,
                    policy: schedulePolicy as any,
                },
            });
        }

        await db.aiAutomationSchedule.updateMany({
            where: {
                locationId: targetLocationId,
                templateKey: { notIn: parsed.data.enabledTemplates },
            },
            data: {
                enabled: false,
            },
        });
    }

    revalidatePath("/admin/settings/ai");

    return {
        success: true as const,
        version: savedDoc.version,
        config: parsed.data,
    };
}

type ListAiDecisionsInput = {
    locationId?: string | null;
    status?: string | null;
    skillId?: string | null;
    since?: string | null;
    limit?: number;
    conversationId?: string | null;
    dealId?: string | null;
    contactId?: string | null;
};

type ListAiRuntimeJobsInput = {
    locationId?: string | null;
    status?: string | null;
    since?: string | null;
    limit?: number;
};

export async function listSkillPolicies(locationId?: string | null) {
    const fallbackLocation = await getAuthenticatedLocationReadOnly({ requireGhlToken: false });
    const targetLocationId = String(locationId || fallbackLocation.id || "").trim();
    if (!targetLocationId) return [];

    const actor = await resolveLocationActorContext(targetLocationId);
    if (!actor.hasAccess) return [];

    const rows = await db.aiSkillPolicy.findMany({
        where: { locationId: targetLocationId },
        orderBy: [{ enabled: "desc" }, { objective: "asc" }, { skillId: "asc" }],
    });

    return rows.map((row) => {
        const parsed = AiSkillPolicySchema.safeParse({
            locationId: row.locationId,
            skillId: row.skillId,
            enabled: row.enabled,
            objective: row.objective,
            channelPolicy: row.channelPolicy || {},
            contactSegments: row.contactSegments || {},
            decisionPolicy: row.decisionPolicy || {},
            compliancePolicy: row.compliancePolicy || {},
            stylePolicy: row.stylePolicy || {},
            researchPolicy: row.researchPolicy || {},
            humanApprovalRequired: row.humanApprovalRequired,
            version: row.version,
            metadata: row.metadata || {},
        });

        return {
            id: row.id,
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
            ...(parsed.success ? parsed.data : {
                locationId: row.locationId,
                skillId: row.skillId,
                enabled: row.enabled,
                objective: row.objective,
                channelPolicy: row.channelPolicy || {},
                contactSegments: row.contactSegments || {},
                decisionPolicy: row.decisionPolicy || {},
                compliancePolicy: row.compliancePolicy || {},
                stylePolicy: row.stylePolicy || {},
                researchPolicy: row.researchPolicy || {},
                humanApprovalRequired: row.humanApprovalRequired,
                version: row.version,
                metadata: row.metadata || {},
            }),
        };
    });
}

export async function upsertSkillPolicy(locationId: string, skillId: string, policy: unknown) {
    const targetLocationId = String(locationId || "").trim();
    const targetSkillId = String(skillId || "").trim();
    if (!targetLocationId || !targetSkillId) {
        return { success: false as const, error: "Missing locationId or skillId." };
    }

    const actor = await resolveLocationActorContext(targetLocationId);
    if (!actor.hasAccess || !actor.isAdmin) {
        return { success: false as const, error: "Unauthorized: admin access required." };
    }

    const parsed = AiSkillPolicySchema.safeParse({
        ...(policy && typeof policy === "object" ? policy as Record<string, unknown> : {}),
        locationId: targetLocationId,
        skillId: targetSkillId,
    });

    if (!parsed.success) {
        return {
            success: false as const,
            error: parsed.error.issues[0]?.message || "Invalid skill policy payload.",
            issues: parsed.error.issues.map((issue) => ({
                path: issue.path.join("."),
                message: issue.message,
            })),
        };
    }

    const saved = await db.aiSkillPolicy.upsert({
        where: {
            locationId_skillId: {
                locationId: targetLocationId,
                skillId: targetSkillId,
            },
        },
        create: {
            locationId: targetLocationId,
            skillId: targetSkillId,
            enabled: parsed.data.enabled,
            objective: parsed.data.objective,
            channelPolicy: parsed.data.channelPolicy as any,
            contactSegments: parsed.data.contactSegments as any,
            decisionPolicy: parsed.data.decisionPolicy as any,
            compliancePolicy: parsed.data.compliancePolicy as any,
            stylePolicy: parsed.data.stylePolicy as any,
            researchPolicy: parsed.data.researchPolicy as any,
            humanApprovalRequired: parsed.data.humanApprovalRequired,
            version: parsed.data.version,
            metadata: (parsed.data.metadata || {}) as any,
        },
        update: {
            enabled: parsed.data.enabled,
            objective: parsed.data.objective,
            channelPolicy: parsed.data.channelPolicy as any,
            contactSegments: parsed.data.contactSegments as any,
            decisionPolicy: parsed.data.decisionPolicy as any,
            compliancePolicy: parsed.data.compliancePolicy as any,
            stylePolicy: parsed.data.stylePolicy as any,
            researchPolicy: parsed.data.researchPolicy as any,
            humanApprovalRequired: parsed.data.humanApprovalRequired,
            version: { increment: 1 },
            metadata: (parsed.data.metadata || {}) as any,
        },
    });

    revalidatePath("/admin/settings/ai");

    return {
        success: true as const,
        id: saved.id,
        skillId: saved.skillId,
        version: saved.version,
    };
}

export async function listAiDecisions(input?: ListAiDecisionsInput) {
    const fallbackLocation = await getAuthenticatedLocationReadOnly({ requireGhlToken: false });
    const targetLocationId = String(input?.locationId || fallbackLocation.id || "").trim();
    if (!targetLocationId) return [];
    const actor = await resolveLocationActorContext(targetLocationId);
    if (!actor.hasAccess) return [];

    const limit = Math.max(1, Math.min(200, Number(input?.limit || 60)));
    const status = String(input?.status || "").trim() || null;
    const skillId = String(input?.skillId || "").trim() || null;
    const sinceRaw = String(input?.since || "").trim();
    const sinceDate = sinceRaw ? new Date(sinceRaw) : null;

    const conversationIdRaw = String(input?.conversationId || "").trim();
    let conversationId: string | null = null;
    if (conversationIdRaw) {
        const conversation = await db.conversation.findFirst({
            where: {
                locationId: targetLocationId,
                OR: [{ id: conversationIdRaw }, { ghlConversationId: conversationIdRaw }],
            },
            select: { id: true },
        });
        conversationId = conversation?.id || null;
        if (!conversationId) return [];
    }

    const contactIdRaw = String(input?.contactId || "").trim();
    let contactId: string | null = null;
    if (contactIdRaw) {
        const contact = await db.contact.findFirst({
            where: {
                locationId: targetLocationId,
                OR: [{ id: contactIdRaw }, { ghlContactId: contactIdRaw }],
            },
            select: { id: true },
        });
        contactId = contact?.id || null;
        if (!contactId) return [];
    }

    const dealId = String(input?.dealId || "").trim() || null;
    if (dealId) {
        const deal = await db.dealContext.findFirst({
            where: { id: dealId, locationId: targetLocationId },
            select: { id: true },
        });
        if (!deal) return [];
    }

    const rows = await db.aiDecision.findMany({
        where: {
            locationId: targetLocationId,
            ...(status ? { status } : {}),
            ...(skillId ? { selectedSkillId: skillId } : {}),
            ...(sinceDate && Number.isFinite(sinceDate.getTime()) ? { createdAt: { gte: sinceDate } } : {}),
            ...(conversationId ? { conversationId } : {}),
            ...(contactId ? { contactId } : {}),
            ...(dealId ? { dealId } : {}),
        },
        include: {
            policy: {
                select: {
                    id: true,
                    skillId: true,
                    objective: true,
                    enabled: true,
                    version: true,
                },
            },
            conversation: {
                select: {
                    id: true,
                    ghlConversationId: true,
                },
            },
            contact: {
                select: {
                    id: true,
                    name: true,
                },
            },
            runtimeJobs: {
                orderBy: { createdAt: "desc" },
                take: 3,
                select: {
                    id: true,
                    status: true,
                    attemptCount: true,
                    maxAttempts: true,
                    scheduledAt: true,
                    processedAt: true,
                    traceId: true,
                    lastError: true,
                },
            },
            suggestedResponses: {
                orderBy: { createdAt: "desc" },
                take: 2,
                select: {
                    id: true,
                    status: true,
                    body: true,
                    traceId: true,
                    createdAt: true,
                },
            },
        },
        orderBy: { createdAt: "desc" },
        take: limit,
    });

    return rows.map((row) => ({
        id: row.id,
        locationId: row.locationId,
        policyId: row.policyId,
        selectedSkillId: row.selectedSkillId,
        selectedObjective: row.selectedObjective,
        selectedScore: row.selectedScore,
        status: row.status,
        source: row.source,
        dueAt: row.dueAt?.toISOString() || null,
        holdReason: row.holdReason || null,
        rejectedReason: row.rejectedReason || null,
        scoreBreakdown: row.scoreBreakdown || null,
        decisionContext: row.decisionContext || null,
        traceId: row.traceId || null,
        policyVersion: row.policyVersion || null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        conversationId: row.conversation?.ghlConversationId || row.conversation?.id || row.conversationId || null,
        contactId: row.contact?.id || row.contactId || null,
        contactName: row.contact?.name || null,
        dealId: row.dealId || null,
        policy: row.policy ? {
            id: row.policy.id,
            skillId: row.policy.skillId,
            objective: row.policy.objective,
            enabled: row.policy.enabled,
            version: row.policy.version,
        } : null,
        runtimeJobs: row.runtimeJobs.map((job) => ({
            id: job.id,
            status: job.status,
            attemptCount: job.attemptCount,
            maxAttempts: job.maxAttempts,
            scheduledAt: job.scheduledAt.toISOString(),
            processedAt: job.processedAt ? job.processedAt.toISOString() : null,
            traceId: job.traceId || null,
            lastError: job.lastError || null,
        })),
        suggestedResponses: row.suggestedResponses.map((suggestion) => ({
            id: suggestion.id,
            status: suggestion.status,
            body: suggestion.body,
            traceId: suggestion.traceId || null,
            createdAt: suggestion.createdAt.toISOString(),
        })),
    }));
}

export async function listAiRuntimeJobs(input?: ListAiRuntimeJobsInput) {
    const fallbackLocation = await getAuthenticatedLocationReadOnly({ requireGhlToken: false });
    const targetLocationId = String(input?.locationId || fallbackLocation.id || "").trim();
    if (!targetLocationId) return [];

    const actor = await resolveLocationActorContext(targetLocationId);
    if (!actor.hasAccess) return [];

    const limit = Math.max(1, Math.min(200, Number(input?.limit || 60)));
    const status = String(input?.status || "").trim() || null;
    const sinceRaw = String(input?.since || "").trim();
    const sinceDate = sinceRaw ? new Date(sinceRaw) : null;

    const rows = await db.aiRuntimeJob.findMany({
        where: {
            locationId: targetLocationId,
            ...(status ? { status } : {}),
            ...(sinceDate && Number.isFinite(sinceDate.getTime()) ? { createdAt: { gte: sinceDate } } : {}),
        },
        include: {
            decision: {
                select: {
                    id: true,
                    selectedSkillId: true,
                    selectedObjective: true,
                    selectedScore: true,
                    holdReason: true,
                    source: true,
                    traceId: true,
                },
            },
        },
        orderBy: [{ scheduledAt: "asc" }, { createdAt: "desc" }],
        take: limit,
    });

    return rows.map((row) => ({
        id: row.id,
        locationId: row.locationId,
        decisionId: row.decisionId,
        status: row.status,
        attemptCount: row.attemptCount,
        maxAttempts: row.maxAttempts,
        scheduledAt: row.scheduledAt.toISOString(),
        processedAt: row.processedAt ? row.processedAt.toISOString() : null,
        lockedAt: row.lockedAt ? row.lockedAt.toISOString() : null,
        lockedBy: row.lockedBy || null,
        lastError: row.lastError || null,
        traceId: row.traceId || null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        decision: row.decision
            ? {
                id: row.decision.id,
                selectedSkillId: row.decision.selectedSkillId || null,
                selectedObjective: row.decision.selectedObjective || null,
                selectedScore: row.decision.selectedScore ?? null,
                holdReason: row.decision.holdReason || null,
                source: row.decision.source || null,
                traceId: row.decision.traceId || null,
            }
            : null,
    }));
}

export async function simulateSkillDecision(input: {
    locationId?: string | null;
    conversationId?: string | null;
    dealId?: string | null;
    contactId?: string | null;
}) {
    const fallbackLocation = await getAuthenticatedLocationReadOnly({ requireGhlToken: false });
    const targetLocationId = String(input?.locationId || fallbackLocation.id || "").trim();
    if (!targetLocationId) {
        return { success: false as const, error: "Missing location ID." };
    }

    const actor = await resolveLocationActorContext(targetLocationId);
    if (!actor.hasAccess) {
        return { success: false as const, error: "Unauthorized." };
    }

    let resolvedConversationId = String(input?.conversationId || "").trim() || null;
    const resolvedDealId = String(input?.dealId || "").trim() || null;
    const resolvedContactId = String(input?.contactId || "").trim() || null;

    if (!resolvedConversationId && resolvedDealId) {
        const deal = await db.dealContext.findFirst({
            where: { id: resolvedDealId, locationId: targetLocationId },
            select: { conversationIds: true },
        });
        if (deal?.conversationIds?.length) {
            const conversation = await db.conversation.findFirst({
                where: {
                    locationId: targetLocationId,
                    ghlConversationId: { in: deal.conversationIds },
                },
                select: { id: true },
                orderBy: { lastMessageAt: "desc" },
            });
            if (conversation?.id) {
                resolvedConversationId = conversation.id;
            }
        }
    }

    const simulation = await simulateSkillDecisionRuntime({
        locationId: targetLocationId,
        conversationId: resolvedConversationId,
        contactId: resolvedContactId,
        dealId: resolvedDealId,
    });

    return simulation;
}

export async function runAiRuntimeNow(locationId: string, options?: { plannerOnly?: boolean; batchSize?: number; source?: "automation" | "semi_auto" | "manual" | "mission" }) {
    const targetLocationId = String(locationId || "").trim();
    if (!targetLocationId) {
        return { success: false as const, error: "Missing location ID." };
    }

    const actor = await resolveLocationActorContext(targetLocationId);
    if (!actor.hasAccess || !actor.isAdmin) {
        return { success: false as const, error: "Unauthorized: admin access required." };
    }

    try {
        const stats = await runAiRuntimeCron({
            locationId: targetLocationId,
            plannerOnly: !!options?.plannerOnly,
            batchSize: Math.max(1, Math.min(300, Number(options?.batchSize || 80))),
            source: options?.source || "automation",
        });

        revalidatePath("/admin/settings/ai");
        return { success: true as const, stats };
    } catch (error: any) {
        return { success: false as const, error: error?.message || "Failed to run AI runtime." };
    }
}

export async function runAiSkillDecisionNow(input: {
    locationId: string;
    conversationId: string;
    contactId: string;
    dealId?: string | null;
    source?: "automation" | "semi_auto" | "manual" | "mission";
    objectiveHint?: "nurture" | "book_viewing" | "revive" | "listing_alert" | "deal_progress";
    forceSkillId?: string;
    contextSummary?: string;
    extraInstruction?: string;
    executeImmediately?: boolean;
}) {
    const targetLocationId = String(input.locationId || "").trim();
    const actor = await resolveLocationActorContext(targetLocationId);
    if (!actor.hasAccess) {
        return { success: false as const, error: "Unauthorized." };
    }

    return runAiSkillDecision({
        locationId: targetLocationId,
        conversationId: String(input.conversationId || "").trim(),
        contactId: String(input.contactId || "").trim(),
        dealId: input.dealId || null,
        source: input.source || "manual",
        objectiveHint: input.objectiveHint,
        forceSkillId: input.forceSkillId,
        contextSummary: input.contextSummary,
        extraInstruction: input.extraInstruction,
        executeImmediately: input.executeImmediately ?? true,
    });
}
