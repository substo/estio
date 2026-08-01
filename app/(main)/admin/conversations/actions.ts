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
import { syncMessageFromWebhook } from "@/lib/ghl/sync";
import { checkGHLSMSStatus } from "@/lib/ghl/sms";
import { buildUnavailableProviderCostEstimate, calculateRunCost, calculateRunCostFromUsage } from "@/lib/ai/pricing";
import { securelyRecordAiUsage, securelyRecordConversationAiUsage } from "@/lib/ai/usage-metering";
import { normalizeReplyLanguage } from "@/lib/ai/reply-language-options";
import { getLocationDefaultReplyLanguage } from "@/lib/ai/location-reply-language";
import { z } from "zod";
import { getModelForTask } from "@/lib/ai/model-router";
import { callLLM, callLLMWithMetadata } from "@/lib/ai/llm";
import { resolveReplyTranslationModel } from "@/lib/conversations/reply-translation-model";
import { GEMINI_DRAFT_FAST_DEFAULT, GEMINI_FLASH_LITE_LATEST_ALIAS, GEMINI_FLASH_LATEST_ALIAS, GEMINI_FLASH_STABLE_FALLBACK } from "@/lib/ai/models";
import { auth } from "@clerk/nextjs/server";
import { Prisma } from "@prisma/client";
import { revalidatePath, revalidateTag, unstable_cache } from "next/cache";
import { createHash, randomUUID } from "crypto";
import { runGoogleAutoSyncForContact } from "@/lib/google/automation";
import { createContactTask } from "@/app/(main)/admin/tasks/actions";
import { isLocalDateTimeWithoutZone } from "@/lib/tasks/datetime-local";
import { createTraceId, logPerformanceMetric, withServerTiming } from "@/lib/observability/performance";
import { getConversationFeatureFlags } from "@/lib/feature-flags";
import { publishConversationRealtimeEvent } from "@/lib/realtime/conversation-events";
import { withResilience } from "@/lib/external/resilience";
import { assembleTimelineEvents } from "@/lib/conversations/timeline-events";
import {
    fetchMessagesForResolvedConversation as loadMessagesForResolvedConversation,
    type FetchMessagesOptions,
} from "@/lib/conversations/message-loading";
import {
    isUsableMessageTranslationText,
} from "@/lib/conversations/translation-output";
import { validateReplyTranslationCompleteness } from "@/lib/conversations/translation-completeness";
import {
    resolveConversationLanguageContext,
    type ConversationLanguageContextInput,
} from "@/lib/conversations/language-context";
import { recordConversationLanguageEvidence } from "@/lib/conversations/language-profile";
import {
    getDraftOutputLengthInstruction,
    normalizeDraftOutputLength,
    type DraftOutputLength,
} from "@/lib/ai/draft-output-length";
import {
    deleteManualActivityEntry as deleteManualActivityEntryRow,
    updateManualActivityEntry as updateManualActivityEntryRow,
} from "@/lib/contacts/manual-activity-entries";
import { loadConversationWorkspaceCore } from "@/lib/conversations/workspace-core-loading";
import {
    buildConversationDeltaCursorFromRows,
    decodeConversationCursor,
    decodeConversationDeltaCursor,
    encodeConversationDeltaCursor,
    getCachedConversationListSnapshot,
    hydrateRankedConversationRows,
    mapConversationListSnapshotRows,
    queryConversationListDelta,
    queryConversationListSnapshot,
    type ConversationListStatus,
} from "@/lib/conversations/conversation-list-loading";
import { analyzeConversationSearchQuery } from "@/lib/conversations/conversation-search-query";
import {
    enrichContactContextContact,
    getCachedActiveLeadSourceNames,
    getCachedConversationWorkspaceCoreMetadata,
    getCachedConversationWorkspaceSidebarMetadata,
    getContactContextInclude,
    queryConversationWorkspaceCoreMetadata,
    queryConversationWorkspaceMetadata,
} from "@/lib/conversations/workspace-metadata-loading";
import {
    buildConversationReferenceWhere,
    getLegacyConversationAlias,
    isLikelyGhlConversationId,
    resolveConversationReference,
} from "@/lib/conversations/identity";
import { mapConversationRowToUi } from "@/lib/conversations/conversation-row-mapper";
import {
    resolveConversationLifecycleTargets,
} from "@/lib/conversations/conversation-lifecycle-access";
import { LATEST_MESSAGE_METADATA_SELECT } from "@/lib/conversations/latest-message-metadata";
import { buildVisibleMessageSourceWhere } from "@/lib/conversations/internal-message-visibility";
import { collectDealConversationReferences, syncDealConversationLinks } from "@/lib/deals/conversation-links";
import { settingsService } from "@/lib/settings/service";
import { SETTINGS_DOMAINS, SETTINGS_SECRET_KEYS } from "@/lib/settings/constants";
import {
    AiAutomationConfigSchema,
    cadenceToDays,
} from "@/lib/ai/automation/config";
import {
    AiSkillPolicySchema,
} from "@/lib/ai/runtime/config";
import { REAL_ESTATE_COORDINATOR_LIFECYCLE_PROMPT } from "@/lib/ai/prompts/coordinator-lifecycle";
import {
    buildConversationalMessagingContract,
    detectLanguageFromText,
} from "@/lib/ai/prompts/communication-policy";
import {
    runAiRuntimeCron,
    runAiSkillDecision,
    simulateSkillDecision as simulateSkillDecisionRuntime,
} from "@/lib/ai/runtime/engine";
import { recordAgentFeedback } from "@/lib/ai/agent-feedback";
import { createLearningSessionFromAgentFeedback } from "@/lib/ai/agent-learning";
import { resolveManualDraftSkillRouting } from "@/lib/ai/manual-draft-routing";
import {
    approveLearningProposal,
    createCurrentPromptVersion,
    dismissLearningProposal,
    ensureLocationAiPromptVersion,
    listLearningProposals,
    listLocationAiPromptVersions,
    revertLocationAiPrompt,
    submitManualAgentLearningProposal,
} from "@/lib/ai/location-learning";
import {
    approveRequirementProposal,
    generateRequirementProposal,
    listPendingRequirementProposals,
    queueRequirementProposalForNewActivity,
    rejectRequirementProposal,
    resolveContactPropertyEvidence,
} from "@/lib/ai/requirements-intelligence/service";
import {
    approveContactVerificationProposal,
    listPendingContactVerificationProposals,
    markContactVerified,
    rejectContactVerificationProposal,
    verifyContactProfile,
} from "@/lib/ai/contact-verification/service";
import {
    processActivityNotePropertyFeedback,
} from "@/lib/property-match-campaigns/feedback-service";
import { clearContactPropertyInteractionsForSource } from "@/lib/property-match-campaigns/profile-service";
import { withProfileVerificationInvalidation } from "@/lib/contacts/profile-verification";
import {
    buildCampaignDraftInstruction,
    canCandidateDraftOrSend,
    cancelPropertyMatchCampaignBatch,
    createPropertyMatchCampaign,
    createPropertyMatchCampaignFromSource,
    deletePropertyMatchCampaign,
    findPriorPropertyShareForCandidate,
    getPropertyMatchCampaignDetail,
    listContactPropertyRecommendations,
    listPropertyMatchCampaigns,
    markPropertyMatchCandidateAlreadyShared,
    markPropertyMatchCandidateSent,
    processPropertyMatchCampaignBatch,
    retryPropertyMatchCampaignAiErrors,
    savePropertyMatchCandidateDraft,
    savePropertyMatchCandidateGeneratedDraft,
    sortPropertyMatchSearchRows,
    updatePropertyMatchCampaign,
    updatePropertyMatchCampaignProcessingConfig,
    updatePropertyMatchCandidateReview,
} from "@/lib/property-match-campaigns/service";
import { extractPropertyUrlContext } from "@/lib/conversations/property-url-context";
import {
    buildWhatsAppOutboundUploadKey,
    createWhatsAppMediaUploadUrl as createWhatsAppMediaUploadSignedUrl,
    headWhatsAppMediaObject,
} from "@/lib/whatsapp/media-r2";
import { processNormalizedMessage } from "@/lib/whatsapp/sync";
import { enqueueWhatsAppOutbound } from "@/lib/whatsapp/outbound-enqueue";
import {
    fetchWhatsAppWebBridgeChats,
    fetchWhatsAppWebBridgeMessages,
    buildWhatsAppWebBridgeSessionId,
    getWhatsAppWebBridgeHealth,
    getWhatsAppWebBridgeSession,
    getReadyWhatsAppWebBridgeSession,
    getWhatsAppWebBridgeConversationChatId,
    isResolvedWhatsAppWebBridgeChatAvailable,
    isResolvedWhatsAppWebBridgeChatVerificationUnknown,
    normalizeWhatsAppWebChatId,
    parseWhatsAppWebChatIdentity,
    resolveWhatsAppWebBridgeChatForPhone,
    restartWhatsAppWebBridgeSession,
    startWhatsAppWebBridgeSession,
    upsertWhatsAppWebBridgeSession,
} from "@/lib/whatsapp/web-bridge";
import { buildWhatsAppWebBridgeHistoryChatCandidates } from "@/lib/whatsapp/web-bridge-chat-inventory";
import { ingestWhatsAppWebBridgeMediaAttachment } from "@/lib/whatsapp/web-bridge-media";
import { resolveInboundWhatsAppContactIdentity } from "@/lib/whatsapp/web-bridge-message-identity";
import {
    getStaleWebBridgeNonReadyReason,
    getWhatsAppWebBridgeStatusForLocation,
    isStaleWebBridgeQrStatus,
    resolveLocationWhatsAppProviderMode,
} from "@/lib/conversations/whatsapp-web-bridge-status";
import {
    markWhatsAppWebBridgeMediaRefetchAttemptFailed,
    startWhatsAppWebBridgeMediaRefetchAttempt,
    updateWebBridgeMediaSyncMetadata,
} from "@/lib/whatsapp/web-bridge-media-refetch";
import {
    enqueueWhatsAppMediaRefetchJob,
    initWhatsAppMediaRefetchWorker,
} from "@/lib/queue/whatsapp-media-refetch";
import { hasOpenWhatsAppCustomerServiceWindow } from "@/lib/whatsapp/customer-window";
import {
    getHighConfidenceWebBridgeResolvedPhone,
    hasValidatedWebBridgePhoneIdentity,
    invalidateValidatedWebBridgePhoneIdentity,
    recordValidatedWebBridgePhoneIdentity,
} from "@/lib/whatsapp/web-bridge-identity";
import { getWhatsAppWebBridgeBody } from "@/lib/whatsapp/webhook-normalizers";
import type { WhatsAppTransport, WhatsAppTemplateComponent } from "@/lib/whatsapp/client";
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
import {
    enqueueGhlContactSync,
    enqueueGhlConversationMirror,
    enqueueGhlStatusSync,
    enqueueGoogleContactSync,
} from "@/lib/integrations/provider-outbox-enqueue";
import {
    classifyOutboundSendFailure,
    getSmsFallbackAvailability,
} from "@/lib/conversations/outbound-send-failure";
import {
    availableChannel,
    resolveWebBridgeWhatsAppChannelCapability,
    unavailableChannel,
    type ConversationChannelCapabilities,
} from "@/lib/conversations/channel-capabilities";
import { resolveSmsRelayAvailabilityForLocation } from "@/lib/sms-relay/availability";
import { getGhlIntegrationDisabledReason, isGhlIntegrationEnabled } from "@/lib/ghl/integration-gate";
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
import {
    getNewConversationPhoneInputError,
    matchesNewConversationContact,
    matchesNewConversationRecord,
} from "./_components/new-conversation-dialog-helpers";
import { applyPropertyInterestToContact } from "@/lib/leads/contact-property-interest";
import { enqueuePasteLeadPropertyImport, getPendingPasteLeadPropertyImports } from "@/lib/queue/paste-lead-property-import";
import { mapToRequirementPriceOption } from "@/lib/contacts/requirement-price-options";
import {
    extractLegacyCrmRefCandidates,
    getOldCrmImportCapabilityForUser,
} from "@/lib/crm/old-crm-import";
import {
    parseLegacyCrmLeadNotificationEmail,
    processLegacyCrmLeadEmailForLocation as processLegacyCrmLeadEmailForLocationService,
} from "@/lib/conversations/legacy-crm-lead-email-processing";
import { createParsedLeadForLocation } from "@/lib/conversations/lead-import-service";
import {
    createPasteLeadStatus,
    createPasteLeadStatusRecorder,
    type PasteLeadImportStatus,
} from "@/lib/conversations/paste-lead-status";

import {
    extractPropertyRefsFromLeadText,
    extractBedroomSummary,
    abbreviatePropertyType,
    normalizeWhitespace,
    splitLeadPersonName,
    inferLeadContactRole,
    formatLeadGoalLabel,
    shouldUseMatchedPropertyTitle,
    buildStructuredLeadPropertySummary,
    buildStructuredLeadDisplayName,
} from "@/lib/contacts/name-builder";

const MAX_SELECTION_TEXT_LENGTH = 12000;
const MAX_CUSTOM_OUTPUT_LENGTH = 2200;
const CRM_LOG_DEDUPE_RECENT_LIMIT = 30;
const LEAD_PARSE_MAX_INPUT_LENGTH = 8000;
const LEAD_PARSE_MAX_OUTPUT_TOKENS = 2500;
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
const NOTE_IMPROVEMENT_MAX_OUTPUT_TOKENS = {
    activity: 420,
    viewing: 180,
} as const;
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

function createActionTimer(scope: string) {
    const startedAt = Date.now();
    let lastAt = startedAt;

    return {
        mark(label: string) {
            const now = Date.now();
            console.log(`[${scope}] timing ${label}: +${now - lastAt}ms (${now - startedAt}ms total)`);
            lastAt = now;
        },
        total() {
            console.log(`[${scope}] timing total: ${Date.now() - startedAt}ms`);
        },
    };
}

function queueGhlConversationStatusSync(args: {
    locationId: string;
    conversations: Array<{ id: string; contactId?: string | null }>;
    payload: Record<string, any>;
}) {
    if (!args.conversations.length) return;

    runDetachedTask(`conversation_status_sync:${args.payload.estioStatus || "status"}:${args.conversations.length}`, async () => {
        await Promise.allSettled(args.conversations.map((conversation) => enqueueGhlStatusSync({
            locationId: args.locationId,
            conversationId: conversation.id,
            contactId: conversation.contactId || null,
            payload: {
                ...args.payload,
                source: args.payload.source || "conversation_status_action",
            },
        })));
    });
}

const DEFAULT_TRANSLATION_TARGET_LANGUAGE = "en";
const MESSAGE_TRANSLATION_MODEL = GEMINI_DRAFT_FAST_DEFAULT;
const MESSAGE_TRANSLATION_MAX_OUTPUT_TOKENS = 2048;
const REPLY_TRANSLATION_MAX_OUTPUT_TOKENS = 2048;
const MESSAGE_TRANSLATION_STATUS = {
    completed: "completed",
    failed: "failed",
} as const;
const THREAD_TRANSLATION_CONCURRENCY = 4;

async function mapWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
    const results = new Array<R>(items.length);
    let nextIndex = 0;
    const workerCount = Math.min(Math.max(1, concurrency), items.length);

    await Promise.all(Array.from({ length: workerCount }, async () => {
        while (nextIndex < items.length) {
            const index = nextIndex;
            nextIndex += 1;
            results[index] = await worker(items[index], index);
        }
    }));

    return results;
}

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

async function getLatestInboundConversationText(conversationId: string): Promise<string | null> {
    const latestInbound = await db.message.findFirst({
        where: {
            conversationId,
            direction: "inbound",
            body: { not: null },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { body: true, type: true },
    });
    const raw = String(latestInbound?.body || "").trim();
    if (!raw) return null;
    return String(latestInbound?.type || "").toUpperCase().includes("EMAIL")
        ? stripHtmlToText(raw)
        : raw;
}

async function resolveCustomerSendLanguage(args: {
    conversation: {
        id: string;
        replyLanguageOverride?: string | null;
        currentLanguage?: string | null;
        contact?: { preferredLang?: string | null } | null;
    };
    locationId: string;
    requestedTargetLanguage?: string | null;
    fallbackLanguage?: string | null;
}) {
    const requested = normalizeReplyLanguage(args.requestedTargetLanguage);
    if (requested) return requested;

    const locationDefaultLanguage = await getLocationDefaultReplyLanguage(
        args.locationId,
        args.fallbackLanguage || DEFAULT_TRANSLATION_TARGET_LANGUAGE
    );

    const latestInboundText = await getLatestInboundConversationText(args.conversation.id);
    const context = resolveConversationLanguageContext({
        manualOverrideLanguage: args.conversation.replyLanguageOverride || null,
        contactPreferredLanguage: args.conversation.contact?.preferredLang || null,
        conversationCurrentLanguage: args.conversation.currentLanguage || null,
        latestInboundText,
        locationDefaultLanguage,
        fallbackLanguage: locationDefaultLanguage,
    } satisfies ConversationLanguageContextInput);

    return context.sendLanguage;
}

function buildTranslationSourceHash(sourceText: string): string {
    return createHash("sha256").update(String(sourceText || "").trim(), "utf8").digest("hex");
}

function buildManualOutboundTranslationPayload(args: {
    sourceText?: string | null;
    translatedText?: string | null;
    targetLanguage?: string | null;
    detectedSourceLanguage?: string | null;
}) {
    const sourceText = String(args.sourceText || "").trim();
    const translatedText = String(args.translatedText || "").trim();
    if (!sourceText || !translatedText || sourceText === translatedText) {
        return { translation: null, translations: [] };
    }

    const variant = {
        targetLanguage: normalizeTranslationTargetLanguage(args.targetLanguage || null),
        sourceLanguage: normalizeReplyLanguage(args.detectedSourceLanguage || null),
        sourceText,
        translatedText,
        status: MESSAGE_TRANSLATION_STATUS.completed,
        provider: "manual_send_preview",
        model: "manual_send_preview",
        updatedAt: new Date().toISOString(),
    };

    return {
        translation: {
            active: variant,
            available: [variant],
            viewDefault: "original" as const,
        },
        translations: [variant],
    };
}

function serializeMessageTranslationCache(entry: {
    id: string;
    targetLanguage: string;
    detectedSourceLanguage?: string | null;
    sourceText?: string | null;
    translatedText?: string | null;
    provider?: string | null;
    model?: string | null;
    updatedAt?: Date | string | null;
}) {
    return {
        id: entry.id,
        targetLanguage: entry.targetLanguage,
        sourceLanguage: entry.detectedSourceLanguage || null,
        sourceText: entry.sourceText || "",
        translatedText: entry.translatedText || "",
        status: MESSAGE_TRANSLATION_STATUS.completed,
        provider: entry.provider || null,
        model: entry.model || null,
        updatedAt: entry.updatedAt ? new Date(entry.updatedAt).toISOString() : null,
    };
}

async function runMessageTranslationLLM(args: {
    sourceText: string;
    targetLanguage: string;
    modelOverride?: string;
}) {
    const modelId = String(args.modelOverride || "").trim() || MESSAGE_TRANSLATION_MODEL;
    const systemPrompt = [
        "You are a fast translation assistant for enterprise SaaS conversation inboxes.",
        "Translate the source text to the requested target language.",
        "Preserve meaning, tone, business intent, names, prices, dates, URLs, and line breaks.",
        "Do not add or remove factual content.",
        "Return only the translated message text. Do not return JSON, markdown, labels, or explanation.",
    ].join("\n");
    const userPrompt = [
        `Target language (BCP-47): ${args.targetLanguage}`,
        "Source text:",
        String(args.sourceText || ""),
    ].join("\n\n");

    const { text, usage, provider } = await callLLMWithMetadata(
        modelId,
        systemPrompt,
        userPrompt,
        { jsonMode: false, temperature: 0, maxOutputTokens: MESSAGE_TRANSLATION_MAX_OUTPUT_TOKENS }
    );
    const detectedSourceLanguage = normalizeReplyLanguage(detectLanguageFromText(args.sourceText));

    return {
        translatedText: normalizePlainTranslationOutput(text),
        detectedSourceLanguage,
        confidence: detectedSourceLanguage ? 0.75 : null,
        provider,
        model: modelId,
        usage,
    };
}

function normalizePlainTranslationOutput(text: string): string {
    return String(text || "")
        .replace(/^```(?:text)?\s*/i, "")
        .replace(/\s*```$/i, "")
        .replace(/^["“](.*)["”]$/s, "$1")
        .trim();
}

async function runReplyTranslationLLM(args: {
    sourceText: string;
    targetLanguage: string;
    modelOverride?: string;
    locationId: string;
}) {
    const modelId = String(args.modelOverride || "").trim() || GEMINI_FLASH_LITE_LATEST_ALIAS;
    const systemPrompt = [
        "You are a fast translation assistant for real-estate WhatsApp/SMS/email replies.",
        "Translate the agent's draft into the requested customer language.",
        "Preserve meaning, facts, URLs, prices, names, dates, tone, and line breaks.",
        "Return only the translated message text. Do not return JSON, markdown, labels, or explanation.",
    ].join("\n");
    const userPrompt = [
        `Target language (BCP-47): ${args.targetLanguage}`,
        "Agent draft:",
        String(args.sourceText || ""),
    ].join("\n\n");

    const { text, usage, provider } = await callLLMWithMetadata(
        modelId,
        systemPrompt,
        userPrompt,
        {
            jsonMode: false,
            temperature: 0,
            maxOutputTokens: REPLY_TRANSLATION_MAX_OUTPUT_TOKENS,
            locationId: args.locationId,
        }
    );

    return {
        translatedText: normalizePlainTranslationOutput(text),
        detectedSourceLanguage: null as string | null,
        confidence: null as number | null,
        provider,
        model: modelId,
        usage,
    };
}

function normalizeUsageProvider(provider: string | null | undefined): string {
    const normalized = String(provider || "").trim().toLowerCase();
    if (!normalized || normalized === "google") return "google_gemini";
    return normalized;
}

function isUnpricedTextProvider(provider: string): boolean {
    return provider === "openai" || provider === "chatgpt_subscription";
}

function getTextProviderToolName(provider: string): string {
    if (provider === "openai") return "openai.responses.create";
    if (provider === "chatgpt_subscription") return "codex.exec";
    return "gemini.generateContent";
}

async function resolveConversationTranslationModel(locationId: string): Promise<string> {
    const aiDoc = await settingsService.getDocument<any>({
        scopeType: "LOCATION",
        scopeId: locationId,
        domain: SETTINGS_DOMAINS.LOCATION_AI,
    }).catch(() => null);
    const configuredFromDoc = String(aiDoc?.payload?.googleAiModelTranslation || "").trim();
    if (configuredFromDoc) return configuredFromDoc;

    const siteConfig = await db.siteConfig.findUnique({
        where: { locationId },
        select: { googleAiModelTranslation: true } as any,
    }).catch(() => null);
    const configuredFromLegacy = String((siteConfig as any)?.googleAiModelTranslation || "").trim();
    if (configuredFromLegacy) return configuredFromLegacy;

    return GEMINI_FLASH_LITE_LATEST_ALIAS;
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
                data: withProfileVerificationInvalidation({
                    ...(participant.lidJid && !existing.lid ? { lid: participant.lidJid } : {}),
                    ...(trustedPhone && !existing.phone ? { phone: trustedPhone } : {}),
                    ...(!existing.name && draftName ? { name: draftName } : {}),
                }),
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
                data: withProfileVerificationInvalidation({
                    ...(participant.lidJid && !existingExact.lid ? { lid: participant.lidJid } : {}),
                    ...(trustedPhone && !existingExact.phone ? { phone: trustedPhone } : {}),
                    ...(!existingExact.name && draftName ? { name: draftName } : {}),
                }),
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
        where: buildConversationReferenceWhere(locationId, conversationId),
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
    revalidatePath(`/admin/conversations?id=${encodeURIComponent(conversation.id)}`);
    invalidateConversationReadCaches(conversation.id);

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
    provider?: string | null;
    promptText: string;
    rawOutput: string;
    normalizedOutput: string;
    usage: SelectionUsage;
    latencyMs?: number | null;
}) {
    const location = await getAuthenticatedLocationReadOnly();
    const provider = normalizeUsageProvider(args.provider);

    const estimatedCost = isUnpricedTextProvider(provider)
        ? buildUnavailableProviderCostEstimate(provider, args.usage)
        : calculateRunCostFromUsage(args.modelId, {
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
                        provider,
                        method: estimatedCost.method,
                        confidence: estimatedCost.confidence,
                        note: estimatedCost.note,
                        breakdown: estimatedCost.breakdown,
                    },
                },
            ],
            toolCalls: [
                {
                    tool: getTextProviderToolName(provider),
                    arguments: {
                        provider,
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
        provider,
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
    const requireGhlToken = options?.requireGhlToken === true;
    const location = await getLocationContext();
    if (!location) {
        throw new Error("Unauthorized");
    }
    if (requireGhlToken && !location.ghlAccessToken) {
        throw new Error("Unauthorized or GHL not connected");
    }
    return location;
}

async function getAuthenticatedLocationActorFastReadOnly(options?: { requireGhlToken?: boolean }) {
    const requireGhlToken = options?.requireGhlToken === true;
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
        throw new Error("Unauthorized");
    }

    const user = await db.user.findUnique({
        where: { clerkId: clerkUserId },
        select: {
            id: true,
            locations: { take: 1 },
        },
    });
    const location = user?.locations?.[0] || null;
    if (!user || !location) {
        throw new Error("Unauthorized");
    }
    if (requireGhlToken && !location.ghlAccessToken) {
        throw new Error("Unauthorized or GHL not connected");
    }

    return {
        location,
        actor: {
            clerkUserId,
            userId: user.id,
            isAdmin: false,
            hasAccess: true,
            roleSource: "location_role" as const,
        },
    };
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

function invalidateConversationReadCaches(
    conversationId?: string | null,
    options?: { skipPath?: boolean }
) {
    revalidateTag("conversations:list");
    revalidateTag("conversations:workspace");
    revalidateTag("conversations:workspace:core");
    revalidateTag("conversations:workspace:sidebar");
    revalidateTag("conversations:transcript-eligibility");
    if (conversationId && !options?.skipPath) {
        revalidatePath(`/admin/conversations?id=${encodeURIComponent(conversationId)}`);
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
        const flags = getConversationFeatureFlags(location.id, { locationSmsRelayEnabled: !!(location as any).smsRelayEnabled });

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

            const conversations = await mapConversationListSnapshotRows({
                rows: snapshot.rows,
                location,
                dealMapEntries: snapshot.dealMapEntries,
            });
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

export async function fetchMessages(
    conversationId: string,
    options?: FetchMessagesOptions
) {
    const startedAtMs = Date.now();
    const timings: Record<string, number> = {};
    const markTiming = (key: string, sinceMs: number) => {
        timings[key] = Date.now() - sinceMs;
    };
    const ensureHistory = !!options?.ensureHistory;
    const authStartedAtMs = Date.now();
    const location = ensureHistory
        ? await getAuthenticatedLocationExternal()
        : await getAuthenticatedLocationReadOnly();
    markTiming("auth_ms", authStartedAtMs);

    const conversationStartedAtMs = Date.now();
    const conversation = await db.conversation.findFirst({
        where: buildConversationReferenceWhere(location.id, conversationId),
        include: { contact: true, syncRecords: true }
    });
    markTiming("conversation_ms", conversationStartedAtMs);

    return loadMessagesForResolvedConversation({
        requestedConversationId: conversationId,
        location,
        conversation,
        options,
        reusedConversationContext: false,
        initialTimings: timings,
        startedAtMs,
        dependencies: {
            resolveTranscriptVisibilityAccess,
            parseLegacyCrmLeadNotificationEmail,
        },
    });
}

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

type ConversationWorkspaceCoreOptions = Pick<ConversationWorkspaceOptions, "includeMessages" | "includeActivity" | "messageLimit" | "activityLimit"> & {
    activityBeforeCursor?: string | null;
    messageMetadataMode?: "full" | "firstPaint";
    refreshMode?: "initial_hydration" | "active_refresh" | "deferred_activity" | "prefetch" | "default";
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
        const flags = getConversationFeatureFlags(location.id, { locationSmsRelayEnabled: !!(location as any).smsRelayEnabled });

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
        const refreshMode = options?.refreshMode || "default";
        const messageMetadataMode = options?.messageMetadataMode === "firstPaint" ? "firstPaint" : "full";
        const activityRefreshMode = includeActivity
            ? (includeMessages ? "with_messages" : "activity_only")
            : "skipped";

        return await withServerTiming("conversations.workspace_core", {
            traceId,
            locationId: location.id,
            conversationId: trimmedConversationId,
            includeMessages,
            includeActivity,
            messageLimit,
            activityLimit,
            activityRefreshMode,
            refreshMode,
            messageMetadataMode,
            reusedConversationContext: includeMessages,
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

            return loadConversationWorkspaceCore({
                traceId,
                location,
                conversationId: trimmedConversationId,
                metadata,
                includeMessages,
                includeActivity,
                messageLimit,
                activityLimit,
                refreshMode,
                messageMetadataMode,
                activityBeforeCursor: options?.activityBeforeCursor || null,
                dependencies: {
                    resolveTranscriptVisibilityAccess,
                    parseLegacyCrmLeadNotificationEmail,
                    getTranscriptEligibility: getWhatsAppTranscriptOnDemandEligibility,
                },
            });
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
        const flags = getConversationFeatureFlags(location.id, { locationSmsRelayEnabled: !!(location as any).smsRelayEnabled });

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
        const normalizedStatus: Exclude<ConversationListStatus, "tasks"> = status === "tasks" ? "active" : status;
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
            const delta = await queryConversationListDelta({
                location,
                status: normalizedStatus,
                cursor: parsedCursor,
                limit,
                activeConversationId,
            });

            return {
                success: true as const,
                traceId,
                status: normalizedStatus,
                deltas: delta.deltas,
                cursor: delta.cursor,
                changedCount: delta.changedCount,
                activeConversationChanged: delta.activeConversationChanged,
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
        const conversation = await db.conversation.findFirst({
            where: buildConversationReferenceWhere(location.id, String(conversationId || "").trim()),
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

export async function refetchWhatsAppMediaAttachment(
    conversationId: string,
    messageId: string,
    options?: {
        deleteStoredObject?: boolean;
        maxScan?: number;
        batchSize?: number;
    }
) {
    const location = await getAuthenticatedLocationReadOnly({ requireGhlToken: false });

    const conversation = await db.conversation.findFirst({
        where: buildConversationReferenceWhere(location.id, conversationId),
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

    if (String(message.source || "") === "whatsapp_web_bridge") {
        const job = await startWhatsAppWebBridgeMediaRefetchAttempt({
            locationId: location.id,
            conversationId: conversation.id,
            messageId: message.id,
            deleteStoredObject: options?.deleteStoredObject,
            limit: options?.maxScan ? Math.min(Math.max(Number(options.maxScan), 1), 100) : undefined,
        });

        try {
            await initWhatsAppMediaRefetchWorker();
            const queued = await enqueueWhatsAppMediaRefetchJob(job);
            if (!queued.accepted) {
                await markWhatsAppWebBridgeMediaRefetchAttemptFailed({
                    ...job,
                    error: "Media re-fetch queue did not accept the job.",
                });
                return { success: false as const, error: "Media re-fetch queue did not accept the job." };
            }

            return {
                success: true as const,
                queued: true as const,
                attemptId: job.attemptId,
                jobId: queued.jobId,
                message: "Media re-fetch started. It will continue in the background.",
                warnings: [] as string[],
            };
        } catch (error: any) {
            const errorMessage = error?.message || "Failed to queue media re-fetch.";
            await markWhatsAppWebBridgeMediaRefetchAttemptFailed({
                ...job,
                error: errorMessage,
            });
            return { success: false as const, error: errorMessage };
        }
    }

    return {
        success: false as const,
        error: "This message came from a retired provider. Stored attachments remain readable, but missing media can no longer be re-fetched.",
    };
}

async function queryTranscriptOnDemandEligibilityBase(locationId: string, conversationId: string) {
    const [enabled, conversation] = await Promise.all([
        isWhatsAppTranscriptOnDemandEnabledForLocation(locationId),
        db.conversation.findFirst({
            where: buildConversationReferenceWhere(locationId, conversationId),
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

        const conversation = await db.conversation.findFirst({
            where: buildConversationReferenceWhere(location.id, conversationId),
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

export async function syncWhatsAppHistory(conversationId: string, limit: number = 20, ignoreDuplicates: boolean = false, _offset: number = 0) {
    const location = await getAuthenticatedLocationReadOnly({ requireGhlToken: false });

    const conversation = await db.conversation.findFirst({
        where: buildConversationReferenceWhere(location.id, conversationId),
        include: { contact: true, syncRecords: true }
    });

    if (!conversation) return { success: false, error: "Conversation not found" };
    if (!conversation.contact?.phone && !conversation.contact?.lid) {
        return { success: false, error: "Contact has no phone number or WhatsApp identity" };
    }

    try {
        const existingBridgeSync = (conversation.syncRecords || []).find((sync: any) =>
            String(sync.provider || "") === "whatsapp_web_bridge" && sync.providerConversationId
        );
        let resolvedChatId: string | null = null;
        let identityResolutionSource: string | null = null;
        if (conversation.contact?.phone) {
            try {
                const resolved = await resolveWhatsAppWebBridgeChatForPhone({
                    locationId: location.id,
                    phone: conversation.contact.phone,
                });
                if (isResolvedWhatsAppWebBridgeChatAvailable(resolved)) {
                    resolvedChatId = String(resolved.chatId || "").trim() || null;
                    identityResolutionSource = String(resolved.source || "resolved");
                }
            } catch {
                // Existing provider/LID/phone candidates remain safe fallbacks.
            }
        }
        const chatIds = buildWhatsAppWebBridgeHistoryChatCandidates({
            providerConversationId: existingBridgeSync?.providerConversationId,
            contactLid: conversation.contact?.lid,
            contactPhone: conversation.contact?.phone,
            resolvedChatId,
        });
        if (chatIds.length === 0) {
            return { success: false, error: "Web Bridge history sync needs a contact phone number or WhatsApp identity." };
        }

        const result = { imported: 0, skipped: 0, errors: 0, processed: 0 };
        let completedCandidates = 0;
        const boundedLimit = Math.min(Math.max(Number(limit || 30), 1), 100);
        for (const chatId of chatIds) {
            try {
                const candidateResult = await importWebBridgeRecentMessagesForContact({
                    locationId: location.id,
                    phone: conversation.contact.phone,
                    chatId,
                    canonicalContactId: conversation.contact.id,
                    canonicalConversationId: conversation.id,
                    canonicalPhone: conversation.contact.phone,
                    contactName: conversation.contact.name,
                    limit: boundedLimit,
                    stopAfterDuplicates: ignoreDuplicates ? Number.MAX_SAFE_INTEGER : 5,
                });
                result.imported += candidateResult.imported;
                result.skipped += candidateResult.skipped;
                result.errors += candidateResult.errors;
                result.processed += candidateResult.processed;
                completedCandidates++;
                if (candidateResult.processed > 0) break;
            } catch {
                result.errors++;
            }
        }
        if (completedCandidates === 0) {
            return { success: false, error: "WhatsApp history could not be read from any known contact identity." };
        }

        if (result.imported > 0) {
            invalidateConversationReadCaches(conversationId);
        }
        return {
            success: true,
            count: result.imported,
            processed: result.processed,
            skipped: result.skipped,
            errors: result.errors,
            candidates: chatIds.length,
            candidatesTried: completedCandidates,
            identityResolved: Boolean(resolvedChatId),
            identityResolutionSource,
            provider: "web_bridge",
        };
    } catch (error: any) {
        console.error("syncWhatsAppHistory error:", error);
        return { success: false, error: error.message || "Failed to sync WhatsApp Web Bridge history." };
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
const WHATSAPP_VIDEO_MIME_TYPES = new Set([
    "video/mp4",
    "video/webm",
    "video/quicktime",
    "video/x-matroska",
    "video/3gpp",
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
const MAX_WHATSAPP_VIDEO_BYTES = 16 * 1024 * 1024;
const MAX_WHATSAPP_DOCUMENT_BYTES = 100 * 1024 * 1024;

type WhatsAppMediaKind = "image" | "audio" | "video" | "document";
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
    if (WHATSAPP_VIDEO_MIME_TYPES.has(normalizedContentType)) return "video";
    if (WHATSAPP_DOCUMENT_MIME_TYPES.has(normalizedContentType)) return "document";

    const target = String(fileName || "").toLowerCase();
    if (target.match(/\.(jpg|jpeg|png|webp|gif|heic|heif)$/)) return "image";
    if (target.match(/\.(ogg|opus|mp3|m4a|webm|wav|aac)$/)) return "audio";
    if (target.match(/\.(mp4|mov|m4v|mkv|3gp)$/)) return "video";
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
    const conversation = await db.conversation.findFirst({
        where: buildConversationReferenceWhere(args.locationId, args.conversationId),
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
    if (kind === "video") return WHATSAPP_VIDEO_MIME_TYPES.has(normalizedContentType);
    if (kind === "document") return WHATSAPP_DOCUMENT_MIME_TYPES.has(normalizedContentType);
    return false;
}

function getWhatsAppMediaMaxSize(kind: WhatsAppMediaKind) {
    if (kind === "image") return MAX_WHATSAPP_IMAGE_BYTES;
    if (kind === "audio") return MAX_WHATSAPP_AUDIO_BYTES;
    if (kind === "video") return MAX_WHATSAPP_VIDEO_BYTES;
    return MAX_WHATSAPP_DOCUMENT_BYTES;
}

async function resolveWhatsAppOutboundTransport(locationId: string, explicit?: WhatsAppTransport | null): Promise<{
    transport: WhatsAppTransport;
    cloudConfigured: boolean;
    webBridgeConfigured: boolean;
}> {
    const [integrationDoc, hasCloudSecret] = await Promise.all([
        settingsService.getDocument<any>({
            scopeType: "LOCATION",
            scopeId: locationId,
            domain: SETTINGS_DOMAINS.LOCATION_INTEGRATIONS,
        }).catch(() => null),
        settingsService.hasSecret({
            scopeType: "LOCATION",
            scopeId: locationId,
            domain: SETTINGS_DOMAINS.LOCATION_INTEGRATIONS,
            secretKey: SETTINGS_SECRET_KEYS.WHATSAPP_ACCESS_TOKEN,
        }).catch(() => false),
    ]);
    const integrationPayload = integrationDoc?.payload || {};

    if (explicit) {
        const row = await db.location.findUnique({
            where: { id: locationId },
            select: { whatsappPhoneNumberId: true, whatsappAccessToken: true },
        });
        const webBridgeConfigured = Boolean(await getReadyWhatsAppWebBridgeSession(locationId).catch(() => null));
        return {
            transport: explicit,
            cloudConfigured: Boolean((integrationPayload.whatsappPhoneNumberId || row?.whatsappPhoneNumberId) && (hasCloudSecret || row?.whatsappAccessToken)),
            webBridgeConfigured,
        };
    }

    const row = await db.location.findUnique({
        where: { id: locationId },
        select: {
            whatsappPhoneNumberId: true,
            whatsappAccessToken: true,
            whatsappProviderMode: true,
            twilioAccountSid: true,
            twilioWhatsAppFrom: true,
        } as any,
    });

    const rawMode = String(integrationPayload.whatsappProviderMode || (row as any)?.whatsappProviderMode || "web_bridge");
    const mode = rawMode === "evolution_linked" ? "web_bridge" : rawMode;
    const cloudConfigured = Boolean((integrationPayload.whatsappPhoneNumberId || row?.whatsappPhoneNumberId) && (hasCloudSecret || row?.whatsappAccessToken));
    const twilioConfigured = Boolean((integrationPayload.twilioAccountSid || row?.twilioAccountSid) && (integrationPayload.twilioWhatsAppFrom || row?.twilioWhatsAppFrom));
    const webBridgeConfigured = Boolean(await getReadyWhatsAppWebBridgeSession(locationId).catch(() => null));

    if (mode === "web_bridge") {
        return { transport: "web_bridge", cloudConfigured, webBridgeConfigured };
    }
    if (mode === "twilio_fallback" && twilioConfigured) {
        return { transport: "twilio", cloudConfigured, webBridgeConfigured };
    }
    if (cloudConfigured) {
        return { transport: "cloud_api", cloudConfigured, webBridgeConfigured };
    }
    if (webBridgeConfigured) {
        return { transport: "web_bridge", cloudConfigured, webBridgeConfigured };
    }
    if (twilioConfigured) {
        return { transport: "twilio", cloudConfigured, webBridgeConfigured };
    }
    return { transport: "cloud_api", cloudConfigured, webBridgeConfigured };
}

function requireTemplateWindowForCloud(contact: { whatsappCustomerServiceExpiresAt?: Date | null }, transport: WhatsAppTransport) {
    if (transport !== "cloud_api") return null;
    if (hasOpenWhatsAppCustomerServiceWindow(contact.whatsappCustomerServiceExpiresAt || null)) return null;
    return {
        success: false as const,
        error: "This WhatsApp conversation is outside the 24-hour customer service window. Send an approved template instead.",
        errorCode: "WHATSAPP_TEMPLATE_REQUIRED" as const,
    };
}

export async function createWhatsAppMediaUploadUrl(
    conversationId: string,
    contactId: string,
    file: { fileName: string; contentType: string; size: number }
) {
    const location = await getAuthenticatedLocationReadOnly({ requireGhlToken: false });
    const transportState = await resolveWhatsAppOutboundTransport(location.id);
    if (transportState.transport === "web_bridge" && !transportState.webBridgeConfigured) {
        return { success: false, error: "WhatsApp Web Bridge is selected but not connected. Scan the QR code in WhatsApp settings first." };
    }
    if (!transportState.cloudConfigured && !transportState.webBridgeConfigured) {
        return { success: false, error: "WhatsApp is not connected." };
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
        const kindLabel = mediaKind === "image" ? "Image" : mediaKind === "audio" ? "Audio" : mediaKind === "video" ? "Video" : "Document";
        return { success: false, error: `${kindLabel} is too large. Max size is ${Math.floor(maxSize / (1024 * 1024))}MB.` };
    }

    const conversation = await db.conversation.findFirst({
        where: buildConversationReferenceWhere(location.id, conversationId),
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
        clientSentAt?: string | null;
    }
) {
    const location = await getAuthenticatedLocationReadOnly({ requireGhlToken: false });

    const cleanCaption = String(options?.caption || "").trim();

    try {
        console.info(JSON.stringify({
            scope: "whatsapp_send_lifecycle",
            event: "sendWhatsAppMediaReply_started",
            at: new Date().toISOString(),
            clientMessageId: options?.clientMessageId || null,
            conversationId,
            kind: options?.kind || (upload as any)?.kind || null,
        }));
        const transportState = await resolveWhatsAppOutboundTransport(location.id);
        if (transportState.transport === "web_bridge" && !transportState.webBridgeConfigured) {
            return { success: false, error: "WhatsApp Web Bridge is selected but not connected. Scan the QR code in WhatsApp settings first." };
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
                    : mediaKind === "video"
                        ? (cleanCaption || "[Video]")
                        : (cleanCaption || "[Image]");

        const conversation = await db.conversation.findFirst({
            where: buildConversationReferenceWhere(location.id, conversationId),
            select: { id: true, locationId: true, contactId: true }
        });
        if (!conversation || conversation.locationId !== location.id) {
            return { success: false, error: "Conversation not found." };
        }

        if (!objectKey.startsWith("whatsapp/web-bridge/v1/") && !objectKey.startsWith("whatsapp/cloud/v1/")) {
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
            select: { id: true, phone: true, ghlContactId: true, name: true, whatsappCustomerServiceExpiresAt: true } as any
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

        const windowError = requireTemplateWindowForCloud(contact as any, transportState.transport);
        if (windowError) return windowError;

        const enqueueResult = await enqueueWhatsAppOutbound({
            locationId: location.id,
            conversationInternalId: conversation.id,
            conversationGhlId: conversation.id,
            contactId: contact.id,
            body: previewBody,
            kind: mediaKind,
            source: "app_user",
            transport: transportState.transport,
            clientMessageId: options?.clientMessageId || null,
            caption: cleanCaption || null,
            attachment: {
                objectKey,
                contentType,
                fileName,
                size,
            },
        });
        const clientSentAtMs = Date.parse(String(options?.clientSentAt || ""));
        if (Number.isFinite(clientSentAtMs)) {
            console.info(JSON.stringify({
                scope: "whatsapp_send_lifecycle",
                event: "sendWhatsAppMediaReply_ack_ready",
                at: new Date().toISOString(),
                clientMessageId: enqueueResult.clientMessageId,
                messageId: enqueueResult.messageId,
                outboxJobId: enqueueResult.outboxJobId,
                client_to_action_ms: Date.now() - clientSentAtMs,
                typingDelayMs: enqueueResult.typing.delayMs,
                scheduledAt: enqueueResult.scheduledAt,
                dispatchMode: enqueueResult.dispatchMode,
            }));
        }

        invalidateConversationReadCaches(conversation.id);
        emitConversationRealtimeEvent({
            locationId: location.id,
            conversationId: conversation.id,
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
                scheduledAt: enqueueResult.scheduledAt,
                typingDelayMs: enqueueResult.typing.delayMs,
                typingDelayReason: enqueueResult.typing.reason,
                transport: enqueueResult.transport,
                stoSecureDelivery: enqueueResult.stoSecureDelivery,
                outboxStatus: enqueueResult.outboxStatus,
            },
        });
        return {
            success: true as const,
            queued: true as const,
            messageId: enqueueResult.messageId,
            clientMessageId: enqueueResult.clientMessageId,
            outboxJobId: enqueueResult.outboxJobId,
            scheduledAt: enqueueResult.scheduledAt,
            typingDelayMs: enqueueResult.typing.delayMs,
            typingDelayReason: enqueueResult.typing.reason,
            transport: enqueueResult.transport,
            stoSecureDelivery: enqueueResult.stoSecureDelivery,
            outboxStatus: enqueueResult.outboxStatus,
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

export async function sendWhatsAppTemplateReply(
    conversationId: string,
    contactId: string,
    templatePayload: {
        name: string;
        language: string;
        category?: string | null;
        components?: WhatsAppTemplateComponent[] | null;
        bodyPreview?: string | null;
        pricingIntent?: string | null;
    },
    options?: { clientMessageId?: string | null }
) {
    try {
        const location = await getAuthenticatedLocationReadOnly({ requireGhlToken: false });
        const transportState = await resolveWhatsAppOutboundTransport(location.id, "cloud_api");
        if (!transportState.cloudConfigured) {
            return { success: false, error: "WhatsApp Cloud API is not connected." };
        }

        const templateName = String(templatePayload?.name || "").trim();
        const templateLanguage = String(templatePayload?.language || "").trim();
        if (!templateName || !templateLanguage) {
            return { success: false, error: "Template name and language are required." };
        }

        const conversation = await db.conversation.findFirst({
            where: buildConversationReferenceWhere(location.id, conversationId),
            select: { id: true, locationId: true, contactId: true },
        });
        if (!conversation || conversation.locationId !== location.id) {
            return { success: false, error: "Conversation not found." };
        }

        const contact = await db.contact.findFirst({
            where: {
                OR: [{ ghlContactId: contactId }, { id: contactId }],
                locationId: location.id,
            },
            select: { id: true, phone: true, name: true },
        });
        if (!contact) return { success: false, error: "Contact not found in database." };
        if (conversation.contactId !== contact.id) return { success: false, error: "Conversation/contact mismatch." };
        if (!contact.phone) return { success: false, error: "Contact does not have a phone number. Please add a phone number to this contact." };
        if (contact.phone.includes("*")) {
            return { success: false, error: `${contact.name || "This contact"}'s phone number is masked. You cannot send WhatsApp templates to masked numbers.` };
        }

        const normalizedPhone = contact.phone.replace(/\D/g, "");
        if (normalizedPhone.length < 10) {
            return { success: false, error: `${contact.name || "This contact"}'s phone number appears to be missing a country code.` };
        }

        const enqueueResult = await enqueueWhatsAppOutbound({
            locationId: location.id,
            conversationInternalId: conversation.id,
            conversationGhlId: conversation.id,
            contactId: contact.id,
            body: String(templatePayload.bodyPreview || `[Template: ${templateName}]`),
            kind: "template",
            source: "app_user",
            transport: "cloud_api",
            clientMessageId: options?.clientMessageId || null,
            templateName,
            templateLanguage,
            templateCategory: templatePayload.category || null,
            templateComponents: templatePayload.components || [],
            pricingIntent: templatePayload.pricingIntent || templatePayload.category || null,
        });

        invalidateConversationReadCaches(conversation.id);
        emitConversationRealtimeEvent({
            locationId: location.id,
            conversationId: conversation.id,
            type: "message.outbound",
            payload: {
                channel: "whatsapp",
                mode: "template",
                queued: true,
                messageId: enqueueResult.messageId,
                clientMessageId: enqueueResult.clientMessageId,
                outboxJobId: enqueueResult.outboxJobId,
                queueAccepted: enqueueResult.queueAccepted,
                dispatchMode: enqueueResult.dispatchMode,
                scheduledAt: enqueueResult.scheduledAt,
                typingDelayMs: enqueueResult.typing.delayMs,
                typingDelayReason: enqueueResult.typing.reason,
                transport: enqueueResult.transport,
                outboxStatus: enqueueResult.outboxStatus,
            },
        });

        return {
            success: true as const,
            queued: true as const,
            messageId: enqueueResult.messageId,
            clientMessageId: enqueueResult.clientMessageId,
            outboxJobId: enqueueResult.outboxJobId,
            scheduledAt: enqueueResult.scheduledAt,
            typingDelayMs: enqueueResult.typing.delayMs,
            typingDelayReason: enqueueResult.typing.reason,
            transport: enqueueResult.transport,
            outboxStatus: enqueueResult.outboxStatus,
            queueAccepted: enqueueResult.queueAccepted,
            dispatchMode: enqueueResult.dispatchMode,
            warning: enqueueResult.warning,
            errorCode: enqueueResult.errorCode,
        };
    } catch (err: any) {
        console.error("WhatsApp template enqueue failed:", err);
        return { success: false, error: `WhatsApp template queue failed: ${err.message || "Unknown error"}` };
    }
}

type SendReplyAgentFeedbackPayload = {
    sourceFeature?: string | null;
    sourceAction?: string | null;
    aiOutput?: string | null;
    humanOutput?: string | null;
    agentExecutionId?: string | null;
    aiDecisionId?: string | null;
    traceId?: string | null;
    skillId?: string | null;
    model?: string | null;
    reasoning?: string | null;
    routeReason?: string | null;
    requiresHumanApproval?: boolean | null;
    metadata?: Record<string, unknown> | null;
} | null;

async function recordSendAgentFeedback(args: {
    locationId: string;
    conversationId: string;
    contactId: string;
    sentBody: string;
    channel: string;
    agentFeedback?: SendReplyAgentFeedbackPayload;
}) {
    const feedback = args.agentFeedback;
    if (!feedback?.aiOutput) return;

    try {
        const conversation = await db.conversation.findFirst({
            where: buildConversationReferenceWhere(args.locationId, args.conversationId),
            select: { id: true, contactId: true },
        });
        if (!conversation?.id) return;

        const contact = await db.contact.findFirst({
            where: {
                locationId: args.locationId,
                OR: [
                    { id: args.contactId },
                    { ghlContactId: args.contactId },
                    { id: conversation.contactId },
                ],
            },
            select: { id: true },
        });

        await recordAgentFeedback({
            locationId: args.locationId,
            conversationId: conversation.id,
            contactId: contact?.id || conversation.contactId || null,
            sourceFeature: feedback.sourceFeature || "ai_draft",
            sourceAction: feedback.sourceAction || "send",
            agentExecutionId: feedback.agentExecutionId || null,
            aiDecisionId: feedback.aiDecisionId || null,
            traceId: feedback.traceId || null,
            skillId: feedback.skillId || null,
            model: feedback.model || null,
            aiOutput: feedback.aiOutput,
            humanOutput: feedback.humanOutput || args.sentBody,
            outcome: "sent",
            metadata: {
                ...(feedback.metadata || {}),
                channel: args.channel,
                sentBody: args.sentBody,
                reasoning: feedback.reasoning || feedback.metadata?.reasoning || null,
                routeReason: feedback.routeReason || feedback.metadata?.routeReason || null,
                requiresHumanApproval: feedback.requiresHumanApproval ?? feedback.metadata?.requiresHumanApproval ?? null,
            },
        });
    } catch (error: any) {
        console.warn("[sendReply] Failed to record agent feedback:", error?.message || error);
    }
}

export async function sendReply(
    conversationId: string,
    contactId: string,
    messageBody: string,
    type: 'SMS' | 'Email' | 'WhatsApp' | 'SMS_RELAY',
    options?: {
        clientMessageId?: string;
        clientSentAt?: string | null;
        translationSourceText?: string | null;
        translationTargetLanguage?: string | null;
        translationDetectedSourceLanguage?: string | null;
        agentFeedback?: SendReplyAgentFeedbackPayload;
        retryMessageId?: string | null;
    }
) {
    try {
        if (type === "WhatsApp") {
            console.info(JSON.stringify({
                scope: "whatsapp_send_lifecycle",
                event: "sendReply_started",
                at: new Date().toISOString(),
                clientMessageId: options?.clientMessageId || null,
                conversationId,
            }));
            const location = await getAuthenticatedLocationReadOnly({ requireGhlToken: false });
            const transportState = await resolveWhatsAppOutboundTransport(location.id);
            if (transportState.transport === "web_bridge" && !transportState.webBridgeConfigured) {
                return { success: false, error: "WhatsApp Web Bridge is selected but not connected. Scan the QR code in WhatsApp settings first." };
            }
            if (!transportState.cloudConfigured && !transportState.webBridgeConfigured) {
                return { success: false, error: "WhatsApp is not connected." };
            }

            const normalizedBody = String(messageBody || "").trim();
            if (!normalizedBody) {
                return { success: false, error: "Message body cannot be empty." };
            }
            const requestedTranslationSourceText = String(options?.translationSourceText || "").trim();
            if (requestedTranslationSourceText && requestedTranslationSourceText !== normalizedBody) {
                const completeness = validateReplyTranslationCompleteness({
                    sourceText: requestedTranslationSourceText,
                    translatedText: normalizedBody,
                });
                if (!completeness.ok) {
                    console.warn("[sendReply] Rejected incomplete WhatsApp translation:", {
                        conversationId,
                        clientMessageId: options?.clientMessageId || null,
                        reason: completeness.reason || "incomplete_translation",
                        sourceChars: requestedTranslationSourceText.length,
                        translatedChars: normalizedBody.length,
                    });
                    return {
                        success: false,
                        error: "Translation looked incomplete. Please preview again before sending.",
                        errorCode: "incomplete_translation",
                    };
                }
            }

            const conversation = await db.conversation.findFirst({
                where: buildConversationReferenceWhere(location.id, conversationId),
                select: { id: true, locationId: true, contactId: true, ghlConversationId: true },
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
                select: { id: true, phone: true, name: true, whatsappCustomerServiceExpiresAt: true } as any,
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

            const windowError = requireTemplateWindowForCloud(contact as any, transportState.transport);
            if (windowError) return windowError;

            const enqueueResult = await enqueueWhatsAppOutbound({
                locationId: location.id,
                conversationInternalId: conversation.id,
                conversationGhlId: conversation.id,
                contactId: contact.id,
                body: normalizedBody,
                kind: "text",
                source: "app_user",
                transport: transportState.transport,
                clientMessageId: options?.clientMessageId || null,
                retryMessageId: options?.retryMessageId || null,
            });
            const clientSentAtMs = Date.parse(String(options?.clientSentAt || ""));
            if (Number.isFinite(clientSentAtMs)) {
                console.info(JSON.stringify({
                    scope: "whatsapp_send_lifecycle",
                    event: "sendReply_ack_ready",
                    at: new Date().toISOString(),
                    clientMessageId: enqueueResult.clientMessageId,
                    messageId: enqueueResult.messageId,
                    outboxJobId: enqueueResult.outboxJobId,
                    client_to_action_ms: Date.now() - clientSentAtMs,
                    typingDelayMs: enqueueResult.typing.delayMs,
                    scheduledAt: enqueueResult.scheduledAt,
                    dispatchMode: enqueueResult.dispatchMode,
                }));
            }

            const translationSourceText = requestedTranslationSourceText;
            const translationTargetLanguage = normalizeTranslationTargetLanguage(options?.translationTargetLanguage || null);
            const outboundTranslationPayload = buildManualOutboundTranslationPayload({
                sourceText: translationSourceText,
                translatedText: normalizedBody,
                targetLanguage: translationTargetLanguage,
                detectedSourceLanguage: options?.translationDetectedSourceLanguage || null,
            });
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

            invalidateConversationReadCaches(conversation.id);
            emitConversationRealtimeEvent({
                locationId: location.id,
                conversationId: conversation.id,
                type: "message.outbound",
                payload: {
                    channel: "whatsapp",
                    mode: "text",
                    queued: true,
                    messageId: enqueueResult.messageId,
                    clientMessageId: enqueueResult.clientMessageId,
                    body: normalizedBody,
                    translation: outboundTranslationPayload.translation,
                    translations: outboundTranslationPayload.translations,
                    outboxJobId: enqueueResult.outboxJobId,
                    queueAccepted: enqueueResult.queueAccepted,
                    dispatchMode: enqueueResult.dispatchMode,
                    scheduledAt: enqueueResult.scheduledAt,
                    typingDelayMs: enqueueResult.typing.delayMs,
                    typingDelayReason: enqueueResult.typing.reason,
                    transport: enqueueResult.transport,
                    stoSecureDelivery: enqueueResult.stoSecureDelivery,
                    outboxStatus: enqueueResult.outboxStatus,
                },
            });

            await recordSendAgentFeedback({
                locationId: location.id,
                conversationId: conversation.id,
                contactId: contact.id,
                sentBody: normalizedBody,
                channel: "WhatsApp",
                agentFeedback: options?.agentFeedback || null,
            });

            return {
                success: true as const,
                queued: true as const,
                messageId: enqueueResult.messageId,
                clientMessageId: enqueueResult.clientMessageId,
                body: normalizedBody,
                translation: outboundTranslationPayload.translation,
                translations: outboundTranslationPayload.translations,
                outboxJobId: enqueueResult.outboxJobId,
                scheduledAt: enqueueResult.scheduledAt,
                typingDelayMs: enqueueResult.typing.delayMs,
                typingDelayReason: enqueueResult.typing.reason,
                transport: enqueueResult.transport,
                stoSecureDelivery: enqueueResult.stoSecureDelivery,
                outboxStatus: enqueueResult.outboxStatus,
                queueAccepted: enqueueResult.queueAccepted,
                dispatchMode: enqueueResult.dispatchMode,
                warning: enqueueResult.warning,
                errorCode: enqueueResult.errorCode,
            };
        }

        if (type === "SMS_RELAY") {
            const location = await getAuthenticatedLocationReadOnly({ requireGhlToken: false });
            const { sendSmsRelayMessage } = await import("@/lib/sms-relay/send");
            const result = await sendSmsRelayMessage({
                locationId: location.id,
                conversationId,
                contactId,
                messageBody,
                clientMessageId: options?.clientMessageId || null,
            });
            if (result.success) {
                invalidateConversationReadCaches(conversationId);
                await recordSendAgentFeedback({
                    locationId: location.id,
                    conversationId,
                    contactId,
                    sentBody: messageBody,
                    channel: "SMS_RELAY",
                    agentFeedback: options?.agentFeedback || null,
                });
            }
            return result;
        }

        const location = await getAuthenticatedLocation();
        if (!location?.ghlAccessToken) {
            throw new Error("Unauthorized");
        }

        const localConversation = await db.conversation.findFirst({
            where: buildConversationReferenceWhere(location.id, conversationId),
            include: {
                contact: {
                    select: {
                        id: true,
                        name: true,
                        phone: true,
                        email: true,
                        ghlContactId: true,
                    },
                },
            },
        });
        if (!localConversation) {
            return { success: false, error: "Conversation not found." };
        }

        const localContact = localConversation.contact?.id === contactId || localConversation.contact?.ghlContactId === contactId
            ? localConversation.contact
            : await db.contact.findFirst({
                where: {
                    OR: [
                        { ghlContactId: contactId },
                        { id: contactId },
                    ],
                    locationId: location.id,
                },
                select: { id: true, name: true, phone: true, email: true, ghlContactId: true },
            });

        if (!localContact) {
            return { success: false, error: "Contact not found in database." };
        }
        if (localConversation.contactId !== localContact.id) {
            return { success: false, error: "Conversation/contact mismatch." };
        }

        let remoteContactId = localContact.ghlContactId || null;
        if (!remoteContactId && location.ghlLocationId) {
            const { ensureRemoteContact } = await import("@/lib/crm/contact-sync");
            remoteContactId = await ensureRemoteContact(localContact.id, location.ghlLocationId, location.ghlAccessToken);
        }
        if (!remoteContactId) {
            return { success: false, error: "Contact is not connected to GHL and could not be mirrored." };
        }

        if (type === "SMS") {
            const smsEligibility = await checkSmsPhoneEligibility(
                {
                    id: location.id,
                    ghlAccessToken: location.ghlAccessToken,
                    ghlLocationId: location.ghlLocationId,
                },
                localContact.phone,
                {
                    contactName: localContact.name,
                }
            );

            if (smsEligibility.status !== "eligible") {
                return {
                    success: false,
                    error: smsEligibility.reason || "SMS is not configured for this location.",
                    errorCode: smsEligibility.status === "unknown" ? "sms_not_verified" : "sms_not_configured",
                };
            }
        }

        if (type === "Email" && !String(localContact.email || "").trim()) {
            return {
                success: false,
                error: `${localContact.name || "This contact"} does not have an email address.`,
                errorCode: "missing_email",
            };
        }

        const payload: any = {
            contactId: remoteContactId,
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

        let localMessageId: string | null = null;
        if (res?.messageId) {
            const messageId = res.messageId;
            const remoteConversationId = String(res.conversationId || localConversation.ghlConversationId || "").trim() || null;
            const createdAt = new Date();
            const storedMessage = await db.message.upsert({
                where: { ghlMessageId: messageId },
                create: {
                    conversationId: localConversation.id,
                    ghlMessageId: messageId,
                    body: type === "Email" ? payload.html : payload.message,
                    type: type === "Email" ? "TYPE_EMAIL" : "TYPE_SMS",
                    direction: "outbound",
                    status: "sent",
                    source: "ghl",
                    createdAt,
                    updatedAt: createdAt,
                },
                update: {
                    conversationId: localConversation.id,
                    body: type === "Email" ? payload.html : payload.message,
                    type: type === "Email" ? "TYPE_EMAIL" : "TYPE_SMS",
                    direction: "outbound",
                    status: "sent",
                    source: "ghl",
                },
                select: { id: true },
            });
            localMessageId = storedMessage.id;

            await updateConversationLastMessage({
                conversationId: localConversation.id,
                messageBody: type === "Email" ? payload.html : payload.message,
                messageType: type === "Email" ? "TYPE_EMAIL" : "TYPE_SMS",
                messageDate: createdAt,
                direction: "outbound",
            });

            if (remoteConversationId && isLikelyGhlConversationId(remoteConversationId)) {
                await (db as any).conversationSync.upsert({
                    where: {
                        conversationId_provider_providerAccountId: {
                            conversationId: localConversation.id,
                            provider: "ghl",
                            providerAccountId: location.ghlLocationId || "default",
                        },
                    },
                    create: {
                        conversationId: localConversation.id,
                        locationId: location.id,
                        provider: "ghl",
                        providerAccountId: location.ghlLocationId || "default",
                        providerConversationId: remoteConversationId,
                        status: "synced",
                        lastSyncedAt: new Date(),
                    },
                    update: {
                        providerConversationId: remoteConversationId,
                        status: "synced",
                        lastSyncedAt: new Date(),
                        lastError: null,
                    },
                }).catch((error: any) => {
                    console.warn("[sendReply] Failed to persist GHL conversation sync:", error?.message || error);
                });
            }

            await (db as any).messageSync.upsert({
                where: {
                    messageId_provider_providerAccountId: {
                        messageId: storedMessage.id,
                        provider: "ghl",
                        providerAccountId: location.ghlLocationId || "default",
                    },
                },
                create: {
                    messageId: storedMessage.id,
                    conversationId: localConversation.id,
                    locationId: location.id,
                    provider: "ghl",
                    providerAccountId: location.ghlLocationId || "default",
                    providerMessageId: messageId,
                    providerThreadId: remoteConversationId,
                    status: "synced",
                    lastSyncedAt: new Date(),
                },
                update: {
                    providerMessageId: messageId,
                    providerThreadId: remoteConversationId,
                    status: "synced",
                    lastSyncedAt: new Date(),
                    lastError: null,
                },
            }).catch((error: any) => {
                console.warn("[sendReply] Failed to persist GHL message sync:", error?.message || error);
            });

            const translationSourceText = String(options?.translationSourceText || "").trim();
            const translationTargetLanguage = normalizeTranslationTargetLanguage(options?.translationTargetLanguage || null);
            if (translationSourceText && translationSourceText !== messageBody) {
                if (localMessageId) {
                        const sourceHash = buildTranslationSourceHash(translationSourceText);
                        await (db as any).messageTranslationCache.create({
                            data: {
                                messageId: localMessageId,
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

        invalidateConversationReadCaches(localConversation.id);
        emitConversationRealtimeEvent({
            locationId: location.id,
            conversationId: localConversation.id,
            type: "message.outbound",
            payload: { channel: type.toLowerCase() },
        });
        await recordSendAgentFeedback({
            locationId: location.id,
            conversationId: localConversation.id,
            contactId: localContact.id,
            sentBody: messageBody,
            channel: type,
            agentFeedback: options?.agentFeedback || null,
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
    draftLanguage?: string | null;
    baseDraft?: string | null;
    channel?: "SMS" | "Email" | "WhatsApp" | "SMS_RELAY" | null;
    outputLength?: DraftOutputLength;
    ignorePendingPropertyImport?: boolean;
};

function logAIDraftTiming(event: string, fields: Record<string, unknown> = {}) {
    console.info("[AI Draft Timing]", JSON.stringify({
        event,
        ts: new Date().toISOString(),
        ...fields,
    }));
}

function getElapsedMs(startedAt: number) {
    return Date.now() - startedAt;
}

async function prepareAIDraftRequest(args: {
    eventPrefix: "generateAIDraft" | "generateComposerAIDraft";
    conversationId: string;
    contactId: string;
    model?: string;
}) {
    const { eventPrefix, conversationId, contactId, model } = args;
    const authStartedAt = Date.now();
    const location = await getAuthenticatedLocationReadOnly({ requireGhlToken: false });
    logAIDraftTiming(`${eventPrefix}_auth_end`, {
        conversationId,
        elapsedMs: getElapsedMs(authStartedAt),
    });

    const explicitModel = typeof model === "string" && model.trim() ? model.trim() : undefined;

    const contactSyncStartedAt = Date.now();
    const existingContact = await db.contact.findFirst({
        where: { OR: [{ id: contactId }, { ghlContactId: contactId }], locationId: location.id },
        select: { id: true, ghlContactId: true }
    });

    if (location.ghlAccessToken && existingContact?.ghlContactId) {
        await ensureLocalContactSynced(existingContact.ghlContactId, location.id, location.ghlAccessToken);
    } else if (location.ghlAccessToken && !existingContact) {
        await ensureLocalContactSynced(contactId, location.id, location.ghlAccessToken);
    }
    logAIDraftTiming(`${eventPrefix}_contact_sync_end`, {
        conversationId,
        elapsedMs: getElapsedMs(contactSyncStartedAt),
        hadExistingContact: !!existingContact,
        synced: !!location.ghlAccessToken && (!!existingContact?.ghlContactId || !existingContact),
    });

    const userLookupStartedAt = Date.now();
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
    logAIDraftTiming(`${eventPrefix}_user_lookup_end`, {
        conversationId,
        elapsedMs: getElapsedMs(userLookupStartedAt),
        hasAgentName: !!agentName,
    });

    const lookupStartedAt = Date.now();
    const conversationRecord = await db.conversation.findFirst({
        where: {
            ...buildConversationReferenceWhere(location.id, conversationId),
        },
        select: {
            id: true,
            contactId: true,
        },
    });
    const contactRecord = existingContact?.id
        ? { id: existingContact.id }
        : await db.contact.findFirst({
            where: {
                locationId: location.id,
                OR: [{ id: contactId }, { ghlContactId: contactId }],
            },
            select: { id: true },
        });
    logAIDraftTiming(`${eventPrefix}_record_lookup_end`, {
        conversationId,
        elapsedMs: getElapsedMs(lookupStartedAt),
        hasConversationRecord: !!conversationRecord?.id,
        hasContactRecord: !!contactRecord?.id,
    });

    return {
        location,
        explicitModel,
        agentName,
        conversationRecord,
        contactRecord,
    };
}

export async function generateAIDraft(
    conversationId: string,
    contactId: string,
    instruction?: string,
    model?: string,
    options?: GenerateAIDraftOptions
) {
    const overallStartedAt = Date.now();
    logAIDraftTiming("generateAIDraft_start", {
        conversationId,
        mode: options?.mode || "chat",
        backend: "skill_runtime_then_legacy",
    });

    const {
        location,
        explicitModel,
        agentName,
        conversationRecord,
        contactRecord,
    } = await prepareAIDraftRequest({
        eventPrefix: "generateAIDraft",
        conversationId,
        contactId,
        model,
    });

    if (conversationRecord?.id && contactRecord?.id) {
        try {
            const runtimeStartedAt = Date.now();
            const skillRouting = resolveManualDraftSkillRouting(instruction, options);
            const runtimeResult = await runAiSkillDecision({
                locationId: location.id,
                conversationId: conversationRecord.id,
                contactId: contactRecord.id,
                source: "manual",
                forceSkillId: skillRouting.forceSkillId,
                objectiveHint: skillRouting.objectiveHint,
                contextSummary: [
                    `Mode: ${options?.mode || "chat"}`,
                    options?.dealId ? `Deal: ${options.dealId}` : null,
                    options?.draftLanguage ? `Draft language for agent review: ${options.draftLanguage}` : null,
                    options?.baseDraft ? "Mode: revise current composer draft" : null,
                    `Requested output length: ${normalizeDraftOutputLength(options?.outputLength)}`,
                    `Manual draft skill route: ${skillRouting.forceSkillId} (${skillRouting.reason})`,
                ].filter(Boolean).join("\n"),
                extraInstruction: [
                    buildConversationalMessagingContract({ channel: "WhatsApp/SMS/chat" }),
                    options?.baseDraft
                        ? `Current composer draft to revise:\n${options.baseDraft}`
                        : null,
                    instruction || "Draft the best next response based on current conversation context.",
                    getDraftOutputLengthInstruction(options?.outputLength, options?.channel === "Email"),
                    options?.draftLanguage
                        ? `Write the draft in ${options.draftLanguage} for internal agent review. Do not translate it to the client's send language yet.`
                        : null,
                ].filter(Boolean).join("\n\n"),
                executeImmediately: true,
            });
            logAIDraftTiming("generateAIDraft_runtime_end", {
                conversationId,
                elapsedMs: getElapsedMs(runtimeStartedAt),
                success: runtimeResult.success,
                hasDraft: !!runtimeResult.draftBody,
                traceId: runtimeResult.traceId || null,
                selectedSkillId: runtimeResult.selectedSkillId || skillRouting.forceSkillId,
                routeReason: skillRouting.reason,
            });

            if (runtimeResult.success && runtimeResult.draftBody) {
                logAIDraftTiming("generateAIDraft_end", {
                    conversationId,
                    elapsedMs: getElapsedMs(overallStartedAt),
                    path: "skill_runtime",
                });
                return {
                    draft: runtimeResult.draftBody,
                    reasoning: `Generated via unified skill runtime (${runtimeResult.selectedSkillId || skillRouting.forceSkillId || "skill"}; ${skillRouting.reason}).`,
                    requiresHumanApproval: true,
                    generationId: runtimeResult.agentExecutionId || null,
                    agentExecutionId: runtimeResult.agentExecutionId || null,
                    decisionId: runtimeResult.decisionId || null,
                    selectedSkillId: runtimeResult.selectedSkillId || skillRouting.forceSkillId || null,
                    routeReason: skillRouting.reason,
                    traceId: runtimeResult.traceId || null,
                };
            }
        } catch (skillError: any) {
            logAIDraftTiming("generateAIDraft_runtime_failed", {
                conversationId,
                elapsedMs: getElapsedMs(overallStartedAt),
                reason: skillError?.message || String(skillError),
            });
            console.warn("[generateAIDraft] Skill runtime failed, falling back to legacy generateDraft:", skillError?.message || skillError);
        }
    }

    // Use internal location.id (for SiteConfig lookup), not ghlLocationId (external GHL ID)
    const legacyStartedAt = Date.now();
    const result = await generateDraft({
        conversationId: conversationRecord?.id || conversationId,
        contactId,
        locationId: location.id, // CRITICAL: SiteConfig uses internal Location.id
        accessToken: location.ghlAccessToken || "",
        agentName,
        businessName: location.name || undefined,
        instruction,
        baseDraft: options?.baseDraft || undefined,
        model: explicitModel,
        mode: options?.mode || "chat",
        dealId: options?.dealId || undefined,
        draftLanguage: options?.draftLanguage || undefined,
        channel: options?.channel || undefined,
        outputLength: normalizeDraftOutputLength(options?.outputLength),
    });
    logAIDraftTiming("generateAIDraft_legacy_end", {
        conversationId,
        elapsedMs: getElapsedMs(legacyStartedAt),
        totalMs: getElapsedMs(overallStartedAt),
        hasDraft: !!result?.draft,
        generateDraftTelemetry: result?.telemetry?.stageMs || null,
    });

    return result;
}

export async function generateComposerAIDraft(
    conversationId: string,
    contactId: string,
    instruction?: string,
    model?: string,
    options?: GenerateAIDraftOptions
) {
    const overallStartedAt = Date.now();
    logAIDraftTiming("generateComposerAIDraft_start", {
        conversationId,
        mode: options?.mode || "chat",
        backend: "skill_runtime_then_legacy",
    });

    const {
        location,
        explicitModel,
        agentName,
        conversationRecord,
        contactRecord,
    } = await prepareAIDraftRequest({
        eventPrefix: "generateComposerAIDraft",
        conversationId,
        contactId,
        model,
    });

    if (!options?.ignorePendingPropertyImport && conversationRecord?.id) {
        const pendingImports = await getPendingPasteLeadPropertyImports({
            locationId: location.id,
            conversationId: conversationRecord.id,
        });
        if (pendingImports.length > 0) {
            return {
                draft: null,
                blockedReason: "property_import_pending" as const,
                pendingPropertyReferences: pendingImports.map((item) => item.publicReference),
                reasoning: "The contact's property is still importing in the background.",
            };
        }
    }

    if (conversationRecord?.id && contactRecord?.id) {
        try {
            const runtimeStartedAt = Date.now();
            const skillRouting = resolveManualDraftSkillRouting(instruction, options);
            const runtimeResult = await runAiSkillDecision({
                locationId: location.id,
                conversationId: conversationRecord.id,
                contactId: contactRecord.id,
                source: "manual",
                forceSkillId: skillRouting.forceSkillId,
                objectiveHint: skillRouting.objectiveHint,
                contextSummary: [
                    `Mode: ${options?.mode || "chat"}`,
                    options?.dealId ? `Deal: ${options.dealId}` : null,
                    options?.draftLanguage ? `Draft language for agent review: ${options.draftLanguage}` : null,
                    options?.baseDraft ? "Mode: revise current composer draft" : null,
                    `Requested output length: ${normalizeDraftOutputLength(options?.outputLength)}`,
                    "Entry point: composer AI draft",
                    `Manual draft skill route: ${skillRouting.forceSkillId} (${skillRouting.reason})`,
                ].filter(Boolean).join("\n"),
                extraInstruction: [
                    buildConversationalMessagingContract({ channel: options?.channel || "WhatsApp/SMS/chat" }),
                    options?.baseDraft
                        ? `Current composer draft to revise:\n${options.baseDraft}`
                        : null,
                    instruction || "Draft the best next response based on current conversation context.",
                    getDraftOutputLengthInstruction(options?.outputLength, options?.channel === "Email"),
                    options?.draftLanguage
                        ? `Write the draft in ${options.draftLanguage} for internal agent review. Do not translate it to the client's send language yet.`
                        : null,
                ].filter(Boolean).join("\n\n"),
                executeImmediately: true,
            });
            logAIDraftTiming("generateComposerAIDraft_runtime_end", {
                conversationId,
                elapsedMs: getElapsedMs(runtimeStartedAt),
                success: runtimeResult.success,
                hasDraft: !!runtimeResult.draftBody,
                traceId: runtimeResult.traceId || null,
                selectedSkillId: runtimeResult.selectedSkillId || skillRouting.forceSkillId,
                routeReason: skillRouting.reason,
            });

            if (runtimeResult.success && runtimeResult.draftBody) {
                logAIDraftTiming("generateComposerAIDraft_end", {
                    conversationId,
                    elapsedMs: getElapsedMs(overallStartedAt),
                    path: "skill_runtime",
                });
                return {
                    draft: runtimeResult.draftBody,
                    reasoning: `Generated via unified skill runtime (${runtimeResult.selectedSkillId || skillRouting.forceSkillId || "skill"}; ${skillRouting.reason}).`,
                    requiresHumanApproval: true,
                    generationId: runtimeResult.agentExecutionId || null,
                    agentExecutionId: runtimeResult.agentExecutionId || null,
                    decisionId: runtimeResult.decisionId || null,
                    selectedSkillId: runtimeResult.selectedSkillId || skillRouting.forceSkillId || null,
                    routeReason: skillRouting.reason,
                    traceId: runtimeResult.traceId || null,
                };
            }
        } catch (skillError: any) {
            logAIDraftTiming("generateComposerAIDraft_runtime_failed", {
                conversationId,
                elapsedMs: getElapsedMs(overallStartedAt),
                reason: skillError?.message || String(skillError),
            });
            console.warn("[generateComposerAIDraft] Skill runtime failed, falling back to legacy generateDraft:", skillError?.message || skillError);
        }
    }

    const legacyStartedAt = Date.now();
    const result = await generateDraft({
        conversationId: conversationRecord?.id || conversationId,
        contactId,
        locationId: location.id,
        accessToken: location.ghlAccessToken || "",
        agentName,
        businessName: location.name || undefined,
        instruction,
        baseDraft: options?.baseDraft || undefined,
        model: explicitModel,
        mode: options?.mode || "chat",
        dealId: options?.dealId || undefined,
        draftLanguage: options?.draftLanguage || undefined,
        channel: options?.channel || undefined,
        outputLength: normalizeDraftOutputLength(options?.outputLength),
    });
    logAIDraftTiming("generateComposerAIDraft_legacy_end", {
        conversationId,
        elapsedMs: getElapsedMs(legacyStartedAt),
        totalMs: getElapsedMs(overallStartedAt),
        hasDraft: !!result?.draft,
        generateDraftTelemetry: result?.telemetry?.stageMs || null,
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
        where: buildConversationReferenceWhere(location.id, trimmedConversationId),
        select: { id: true, ghlConversationId: true },
    });

    if (!conversation) {
        return { success: false as const, error: "Conversation not found." };
    }

    await db.conversation.update({
        where: { id: conversation.id },
        data: { replyLanguageOverride: normalizedReplyLanguage },
    });

    invalidateConversationReadCaches(conversation.id);
    emitConversationRealtimeEvent({
        locationId: location.id,
        conversationId: conversation.id,
        type: "conversation.reply_language_override.updated",
        payload: { replyLanguageOverride: normalizedReplyLanguage },
    });

    return {
        success: true as const,
        conversationId: conversation.id,
        replyLanguageOverride: normalizedReplyLanguage,
    };
}

export async function previewTranslatedReply(
    conversationId: string,
    sourceText: string,
    channel: "SMS" | "Email" | "WhatsApp" | "SMS_RELAY",
    targetLanguage?: string | null,
    requestedModelId?: string | null
) {
    const startedAt = Date.now();
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
        where: buildConversationReferenceWhere(location.id, trimmedConversationId),
        include: {
            contact: {
                select: { preferredLang: true },
            },
        },
    });
    if (!conversation) {
        return { success: false as const, error: "Conversation not found." };
    }

    const resolvedTargetLanguage = await resolveCustomerSendLanguage({
        conversation: {
            id: conversation.id,
            replyLanguageOverride: conversation.replyLanguageOverride || null,
            currentLanguage: (conversation as any).currentLanguage || null,
            contact: conversation.contact,
        },
        locationId: location.id,
        requestedTargetLanguage: targetLanguage || null,
        fallbackLanguage: DEFAULT_TRANSLATION_TARGET_LANGUAGE,
    });
    const sourceHash = buildTranslationSourceHash(normalizedSourceText);

    try {
        const configuredTranslationModel = await resolveConversationTranslationModel(location.id);
        const translationModel = resolveReplyTranslationModel({
            requestedModel: requestedModelId,
            configuredModel: configuredTranslationModel,
        });
        const translation = await runReplyTranslationLLM({
            sourceText: normalizedSourceText,
            targetLanguage: resolvedTargetLanguage,
            modelOverride: translationModel,
            locationId: location.id,
        });
        const completeness = validateReplyTranslationCompleteness({
            sourceText: normalizedSourceText,
            translatedText: translation.translatedText,
        });
        if (!completeness.ok) {
            console.warn("[Conversation Translation Timing]", JSON.stringify({
                event: "preview_translated_reply_rejected",
                conversationId: conversation.id,
                targetLanguage: resolvedTargetLanguage,
                elapsedMs: Date.now() - startedAt,
                reason: completeness.reason || "incomplete_translation",
                sourceChars: normalizedSourceText.length,
                translatedChars: translation.translatedText.length,
                model: translation.model,
            }));
            return {
                success: false as const,
                error: "Translation looked incomplete. Please preview again before sending.",
                targetLanguage: resolvedTargetLanguage,
            };
        }
        const elapsedMs = Date.now() - startedAt;

        await securelyRecordConversationAiUsage({
            locationId: location.id,
            conversationId: conversation.id,
            action: "preview_translated_reply",
            provider: normalizeUsageProvider(translation.provider),
            model: translation.model,
            inputTokens: translation.usage.promptTokens || 0,
            outputTokens: translation.usage.completionTokens || 0,
            metadata: {
                source: "previewTranslatedReply",
                channel: normalizedChannel,
                targetLanguage: resolvedTargetLanguage,
                cached: false,
                elapsedMs,
                mode: "fast_reply_translation",
                requestedModel: String(requestedModelId || "").trim() || null,
                configuredModel: configuredTranslationModel,
            },
        });
        console.info("[Conversation Translation Timing]", JSON.stringify({
            event: "preview_translated_reply_end",
            conversationId: conversation.id,
            targetLanguage: resolvedTargetLanguage,
            elapsedMs,
            model: translation.model,
            sourceChars: normalizedSourceText.length,
        }));

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
        console.warn("[Conversation Translation Timing]", JSON.stringify({
            event: "preview_translated_reply_failed",
            conversationId: trimmedConversationId,
            targetLanguage: resolvedTargetLanguage,
            elapsedMs: Date.now() - startedAt,
            reason: String(error?.message || error || "unknown"),
        }));
        return {
            success: false as const,
            error: String(error?.message || "Failed to generate translation preview."),
            targetLanguage: resolvedTargetLanguage,
        };
    }
}

export async function translateSelectedText(
    conversationId: string,
    text: string,
    targetLanguage?: string | null
) {
    const location = await getAuthenticatedLocationReadOnly({ requireGhlToken: false });
    const trimmedConversationId = String(conversationId || "").trim();
    const sourceText = String(text || "").trim();

    if (!trimmedConversationId) {
        return { success: false as const, error: "Missing conversation ID." };
    }
    if (!sourceText) {
        return { success: false as const, error: "No text provided to translate." };
    }

    const conversation = await db.conversation.findFirst({
        where: buildConversationReferenceWhere(location.id, trimmedConversationId),
        select: { id: true, replyLanguageOverride: true },
    });

    if (!conversation) {
        return { success: false as const, error: "Conversation not found." };
    }

    const resolvedTargetLanguage = normalizeTranslationTargetLanguage(
        targetLanguage,
        DEFAULT_TRANSLATION_TARGET_LANGUAGE
    );

    try {
        const translationModel = await resolveConversationTranslationModel(location.id);
        const translation = await runMessageTranslationLLM({
            sourceText,
            targetLanguage: resolvedTargetLanguage,
            modelOverride: translationModel,
        });

        await securelyRecordConversationAiUsage({
            locationId: location.id,
            conversationId: conversation.id,
            action: "translate_selected_text",
            provider: normalizeUsageProvider(translation.provider),
            model: translation.model,
            inputTokens: translation.usage.promptTokens || 0,
            outputTokens: translation.usage.completionTokens || 0,
            metadata: {
                source: "translateSelectedText",
                targetLanguage: resolvedTargetLanguage,
                cached: false,
            },
        });

        return {
            success: true as const,
            translatedText: translation.translatedText,
            detectedSourceLanguage: translation.detectedSourceLanguage,
            targetLanguage: resolvedTargetLanguage,
        };
    } catch (error: any) {
        return {
            success: false as const,
            error: String(error?.message || "Translation failed."),
        };
    }
}

export async function translateConversationMessage(
    messageId: string,
    targetLanguage?: string | null
) {
    const startedAt = Date.now();
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
        targetLanguage,
        DEFAULT_TRANSLATION_TARGET_LANGUAGE
    );
    const sourceHash = buildTranslationSourceHash(sourceText);
    const translationModel = await resolveConversationTranslationModel(location.id);

    const existing = await (db as any).messageTranslationCache.findFirst({
        where: {
            messageId: message.id,
            targetLanguage: resolvedTargetLanguage,
            sourceHash,
            status: MESSAGE_TRANSLATION_STATUS.completed,
        },
        orderBy: [{ updatedAt: "desc" }],
    });
    if (existing && isUsableMessageTranslationText(existing.translatedText)) {
        console.info("[Conversation Translation Timing]", JSON.stringify({
            event: "translate_message_cache_hit",
            conversationId: message.conversation.id,
            messageId: message.id,
            targetLanguage: resolvedTargetLanguage,
            elapsedMs: Date.now() - startedAt,
        }));
        return {
            success: true as const,
            conversationId: message.conversation.id,
            messageId: message.id,
            translation: serializeMessageTranslationCache(existing),
            cached: true as const,
        };
    }

    try {
        const modelStartedAt = Date.now();
        const translation = await runMessageTranslationLLM({
            sourceText,
            targetLanguage: resolvedTargetLanguage,
            modelOverride: translationModel,
        });
        const modelMs = Date.now() - modelStartedAt;
        await recordConversationLanguageEvidence({
            locationId: location.id,
            conversationId: message.conversation.id,
            contactId: message.conversation.contactId,
            language: translation.detectedSourceLanguage,
            confidence: translation.confidence,
            source: "detected",
        });

        const stored = await (db as any).messageTranslationCache.upsert({
            where: {
                messageId_targetLanguage_sourceHash: {
                    messageId: message.id,
                    targetLanguage: resolvedTargetLanguage,
                    sourceHash,
                },
            },
            create: {
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
                error: null,
            },
            update: {
                conversationId: message.conversationId,
                locationId: location.id,
                sourceText,
                translatedText: translation.translatedText,
                detectedSourceLanguage: translation.detectedSourceLanguage,
                detectionConfidence: translation.confidence,
                status: MESSAGE_TRANSLATION_STATUS.completed,
                provider: translation.provider,
                model: translation.model,
                error: null,
            },
        });

        invalidateConversationReadCaches(message.conversation.id);
        emitConversationRealtimeEvent({
            locationId: location.id,
            conversationId: message.conversation.id,
            type: "conversation.message_translation.created",
            payload: {
                messageId: message.id,
                targetLanguage: resolvedTargetLanguage,
                cacheId: stored.id,
            },
        });

        await securelyRecordConversationAiUsage({
            locationId: location.id,
            conversationId: message.conversation.id,
            action: "translate_message",
            provider: normalizeUsageProvider(translation.provider),
            model: translation.model,
            inputTokens: translation.usage.promptTokens || 0,
            outputTokens: translation.usage.completionTokens || 0,
            metadata: {
                source: "translateConversationMessage",
                messageId: message.id,
                targetLanguage: resolvedTargetLanguage,
                cached: false,
                elapsedMs: Date.now() - startedAt,
                modelMs,
                mode: "fast_message_translation",
            },
        });
        console.info("[Conversation Translation Timing]", JSON.stringify({
            event: "translate_message_end",
            conversationId: message.conversation.id,
            messageId: message.id,
            targetLanguage: resolvedTargetLanguage,
            elapsedMs: Date.now() - startedAt,
            modelMs,
            model: translation.model,
            sourceChars: sourceText.length,
        }));

        return {
            success: true as const,
            conversationId: message.conversation.id,
            messageId: message.id,
            translation: serializeMessageTranslationCache(stored),
            cached: false as const,
        };
    } catch (error: any) {
        const messageText = String(error?.message || "Translation failed.");
        console.warn("[Conversation Translation Timing]", JSON.stringify({
            event: "translate_message_failed",
            locationId: location.id,
            conversationId: message.conversation.id,
            messageId: message.id,
            targetLanguage: resolvedTargetLanguage,
            elapsedMs: Date.now() - startedAt,
            error: messageText,
        }));
        await (db as any).messageTranslationCache.upsert({
            where: {
                messageId_targetLanguage_sourceHash: {
                    messageId: message.id,
                    targetLanguage: resolvedTargetLanguage,
                    sourceHash,
                },
            },
            create: {
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
                model: translationModel,
                error: messageText,
            },
            update: {
                conversationId: message.conversationId,
                locationId: location.id,
                sourceText,
                translatedText: "",
                detectedSourceLanguage: null,
                detectionConfidence: null,
                status: MESSAGE_TRANSLATION_STATUS.failed,
                provider: "google",
                model: translationModel,
                error: messageText,
            },
        }).catch(() => null);
        return {
            success: false as const,
            error: messageText,
            messageId: message.id,
            conversationId: message.conversation.id,
        };
    }
}

export async function translateConversationThread(
    conversationId: string,
    targetLanguage?: string | null,
    visibleMessageIds?: string[] | null
) {
    const startedAt = Date.now();
    const location = await getAuthenticatedLocationReadOnly({ requireGhlToken: false });
    const trimmedConversationId = String(conversationId || "").trim();
    if (!trimmedConversationId) {
        return { success: false as const, error: "Missing conversation ID." };
    }

    const conversation = await db.conversation.findFirst({
        where: buildConversationReferenceWhere(location.id, trimmedConversationId),
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
        targetLanguage,
        DEFAULT_TRANSLATION_TARGET_LANGUAGE
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
            body: true,
            type: true,
            conversationId: true,
        },
    });

    let translatedCount = 0;
    let cachedCount = 0;
    const translations: Array<{
        messageId: string;
        translation: ReturnType<typeof serializeMessageTranslationCache>;
        cached: boolean;
    }> = [];
    const failed: Array<{ messageId: string; error: string }> = [];

    const translatableRows = rows.map((row) => {
        const sourceRaw = String(row.body || "").trim();
        const sourceText = String(row.type || "").toUpperCase().includes("EMAIL")
            ? stripHtmlToText(sourceRaw)
            : sourceRaw;
        return {
            ...row,
            sourceText,
            sourceHash: buildTranslationSourceHash(sourceText),
        };
    }).filter((row) => row.sourceText.length > 0);

    if (translatableRows.length === 0) {
        console.log("[ConversationTranslation] Thread translation skipped", {
            conversationId: conversation.id,
            targetLanguage: resolvedTargetLanguage,
            rowCount: rows.length,
            durationMs: Date.now() - startedAt,
        });
        return {
            success: true as const,
            conversationId: conversation.id,
            targetLanguage: resolvedTargetLanguage,
            translatedCount: 0,
            cachedCount: 0,
            failedCount: 0,
            translations,
            failed,
        };
    }

    const translationModel = await resolveConversationTranslationModel(location.id);
    const cachedRows = await (db as any).messageTranslationCache.findMany({
        where: {
            messageId: { in: translatableRows.map((row) => row.id) },
            targetLanguage: resolvedTargetLanguage,
            status: MESSAGE_TRANSLATION_STATUS.completed,
        },
        orderBy: [{ updatedAt: "desc" }],
    });
    const cachedByMessageAndHash = new Map<string, any>();
    for (const entry of cachedRows) {
        const key = `${entry.messageId}:${entry.sourceHash}`;
        if (!cachedByMessageAndHash.has(key)) {
            cachedByMessageAndHash.set(key, entry);
        }
    }

    const uncachedRows = [];
    let invalidCachedCount = 0;
    for (const row of translatableRows) {
        const cached = cachedByMessageAndHash.get(`${row.id}:${row.sourceHash}`);
        if (cached && isUsableMessageTranslationText(cached.translatedText)) {
            translatedCount += 1;
            cachedCount += 1;
            translations.push({
                messageId: row.id,
                translation: serializeMessageTranslationCache(cached),
                cached: true,
            });
        } else {
            if (cached) invalidCachedCount += 1;
            uncachedRows.push(row);
        }
    }

    const translationResults = await mapWithConcurrency(
        uncachedRows,
        THREAD_TRANSLATION_CONCURRENCY,
        async (row) => {
            try {
                const translation = await runMessageTranslationLLM({
                    sourceText: row.sourceText,
                    targetLanguage: resolvedTargetLanguage,
                    modelOverride: translationModel,
                });

                const stored = await (db as any).messageTranslationCache.upsert({
                    where: {
                        messageId_targetLanguage_sourceHash: {
                            messageId: row.id,
                            targetLanguage: resolvedTargetLanguage,
                            sourceHash: row.sourceHash,
                        },
                    },
                    create: {
                        messageId: row.id,
                        conversationId: row.conversationId,
                        locationId: location.id,
                        targetLanguage: resolvedTargetLanguage,
                        sourceHash: row.sourceHash,
                        sourceText: row.sourceText,
                        translatedText: translation.translatedText,
                        detectedSourceLanguage: translation.detectedSourceLanguage,
                        detectionConfidence: translation.confidence,
                        status: MESSAGE_TRANSLATION_STATUS.completed,
                        provider: translation.provider,
                        model: translation.model,
                        error: null,
                    },
                    update: {
                        conversationId: row.conversationId,
                        locationId: location.id,
                        sourceText: row.sourceText,
                        translatedText: translation.translatedText,
                        detectedSourceLanguage: translation.detectedSourceLanguage,
                        detectionConfidence: translation.confidence,
                        status: MESSAGE_TRANSLATION_STATUS.completed,
                        provider: translation.provider,
                        model: translation.model,
                        error: null,
                    },
                });

                await recordConversationLanguageEvidence({
                    locationId: location.id,
                    conversationId: conversation.id,
                    contactId: conversation.contactId,
                    language: translation.detectedSourceLanguage,
                    confidence: translation.confidence,
                    source: "detected",
                });

                await securelyRecordConversationAiUsage({
                    locationId: location.id,
                    conversationId: conversation.id,
                    action: "translate_thread_message",
                    provider: normalizeUsageProvider(translation.provider),
                    model: translation.model,
                    inputTokens: translation.usage.promptTokens || 0,
                    outputTokens: translation.usage.completionTokens || 0,
                    metadata: {
                        source: "translateConversationThread",
                        messageId: row.id,
                        targetLanguage: resolvedTargetLanguage,
                        cached: false,
                    },
                });

                return {
                    success: true as const,
                    messageId: row.id,
                    translation: serializeMessageTranslationCache(stored),
                };
            } catch (error: any) {
                const messageText = String(error?.message || "Translation failed.");
                await (db as any).messageTranslationCache.upsert({
                    where: {
                        messageId_targetLanguage_sourceHash: {
                            messageId: row.id,
                            targetLanguage: resolvedTargetLanguage,
                            sourceHash: row.sourceHash,
                        },
                    },
                    create: {
                        messageId: row.id,
                        conversationId: row.conversationId,
                        locationId: location.id,
                        targetLanguage: resolvedTargetLanguage,
                        sourceHash: row.sourceHash,
                        sourceText: row.sourceText,
                        translatedText: "",
                        detectedSourceLanguage: null,
                        detectionConfidence: null,
                        status: MESSAGE_TRANSLATION_STATUS.failed,
                        provider: "google",
                        model: translationModel,
                        error: messageText,
                    },
                    update: {
                        conversationId: row.conversationId,
                        locationId: location.id,
                        sourceText: row.sourceText,
                        translatedText: "",
                        detectedSourceLanguage: null,
                        detectionConfidence: null,
                        status: MESSAGE_TRANSLATION_STATUS.failed,
                        provider: "google",
                        model: translationModel,
                        error: messageText,
                    },
                }).catch(() => null);
                return {
                    success: false as const,
                    messageId: row.id,
                    error: messageText,
                };
            }
        }
    );

    for (const result of translationResults) {
        if (result.success) {
            translatedCount += 1;
            translations.push({
                messageId: result.messageId,
                translation: result.translation,
                cached: false,
            });
        } else {
            failed.push({
                messageId: result.messageId,
                error: result.error,
            });
        }
    }

    if (translationResults.some((result) => result.success)) {
        invalidateConversationReadCaches(conversation.id);
    }

    console.log("[ConversationTranslation] Thread translation completed", {
        conversationId: conversation.id,
        targetLanguage: resolvedTargetLanguage,
        rowCount: rows.length,
        translatableCount: translatableRows.length,
        cachedCount,
        invalidCachedCount,
        uncachedCount: uncachedRows.length,
        translatedCount,
        failedCount: failed.length,
        durationMs: Date.now() - startedAt,
    });

    emitConversationRealtimeEvent({
        locationId: location.id,
        conversationId: conversation.id,
        type: "conversation.thread_translation.created",
        payload: {
            targetLanguage: resolvedTargetLanguage,
            translatedCount,
            cachedCount,
            failedCount: failed.length,
        },
    });

    if (rows.length > 0 && translatedCount === 0) {
        return {
            success: false as const,
            error: failed[0]?.error || "Failed to translate visible messages.",
            conversationId: conversation.id,
            targetLanguage: resolvedTargetLanguage,
            translatedCount,
            cachedCount,
            failedCount: failed.length,
            translations,
            failed,
        };
    }

    return {
        success: true as const,
        conversationId: conversation.id,
        targetLanguage: resolvedTargetLanguage,
        translatedCount,
        cachedCount,
        failedCount: failed.length,
        translations,
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
        "Coordinator action: suggest_next_step",
        dealStage ? `Deal stage: ${dealStage}` : null,
        bootstrapMode !== "none" ? `Bootstrap mode: ${bootstrapMode}` : null,
        `Latest message: ${latestMessage}`,
    ]
        .filter(Boolean)
        .join("\n");
    const clientIntelligenceContext = await buildCoordinatorClientIntelligenceContext({
        locationId: location.id,
        contactId: resolvedContactId,
        conversationId: conversation.id,
    });

    const runtimeResult = await runAiSkillDecision({
        locationId: location.id,
        conversationId: conversation.id,
        contactId: resolvedContactId,
        source: "mission",
        contextSummary,
        extraInstruction: historyForOrchestration
            ? `${REAL_ESTATE_COORDINATOR_LIFECYCLE_PROMPT}\n\n${clientIntelligenceContext}\n\nUse the full coordinator conversation history below when deciding the best next step.\n\n${historyForOrchestration}`
            : `${REAL_ESTATE_COORDINATOR_LIFECYCLE_PROMPT}\n\n${clientIntelligenceContext}\n\nGenerate the first review-safe outreach for this conversation context.`,
        executeImmediately: true,
    });

    const holdReason = runtimeResult.holdReason || null;
    const suggestionQueued = Boolean(runtimeResult.draftBody);
    const success = Boolean(runtimeResult.success);

    let reasoning = "";
    if (!success) {
        reasoning = runtimeResult.error || "Coordinator runtime decision failed.";
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
        intent: runtimeResult.objective || "coordinator",
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
    const location = await getAuthenticatedLocationReadOnly({ requireGhlToken: false });
    const normalizedRefs = Array.from(new Set((conversationIds || []).map((id) => String(id || "").trim()).filter(Boolean)));

    // Auto-detect properties from the contacts involved
    let propertyIds: string[] = [];
    let canonicalConversationIds: string[] = [];
    try {
        const conversations = await db.conversation.findMany({
            where: {
                locationId: location.id,
                OR: [
                    { id: { in: normalizedRefs } },
                    { ghlConversationId: { in: normalizedRefs } },
                    {
                        syncRecords: {
                            some: {
                                providerConversationId: { in: normalizedRefs },
                            },
                        },
                    },
                ],
            },
            include: {
                contact: {
                    include: {
                        propertyRoles: {
                            select: { propertyId: true },
                        },
                    },
                },
            },
        });

        canonicalConversationIds = conversations.map((conversation) => conversation.id);
        const allPropIds = conversations.flatMap((conversation: any) =>
            (conversation.contact?.propertyRoles || []).map((role: any) => role.propertyId)
        );
        propertyIds = Array.from(new Set(allPropIds));
    } catch (e) {
        console.warn("Failed to auto-detect properties for Deal Context", e);
        // non-fatal, proceed with empty properties
    }

    // Create the DB record
    const dealContext = await db.dealContext.create({
        data: {
            title,
            locationId: location.id,
            conversationIds: canonicalConversationIds.length > 0 ? canonicalConversationIds : normalizedRefs,
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

    const [leadSources, requirementProposalRows, verificationProposalRows] = await Promise.all([
        getCachedActiveLeadSourceNames(location.id),
        contact?.id
            ? listPendingRequirementProposals({
                locationId: location.id,
                contactId: contact.id,
                limit: 5,
            })
            : Promise.resolve([]),
        contact?.id
            ? listPendingContactVerificationProposals({
                locationId: location.id,
                contactId: contact.id,
                limit: 5,
            })
            : Promise.resolve([]),
    ]);

    const hydratedContact = await enrichContactContextContact(contact, location.id);

    return {
        contact: hydratedContact,
        leadSources,
        requirementProposals: requirementProposalRows.map(serializeRequirementProposal),
        verificationProposals: verificationProposalRows.map(serializeRequirementProposal),
    };
}

function serializeRequirementProposal(row: any) {
    if (!row) return null;
    return {
        id: row.id,
        createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt || ""),
        updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt || ""),
        locationId: row.locationId,
        contactId: row.contactId,
        conversationId: row.conversationId || null,
        sourceType: row.sourceType,
        sourceIds: row.sourceIds || [],
        proposalType: row.proposalType || "requirements",
        status: row.status,
        currentSnapshot: row.currentSnapshot || null,
        proposedPatch: row.proposedPatch || null,
        proposedSummary: row.proposedSummary || null,
        evidence: row.evidence || null,
        confidence: row.confidence ?? null,
        reasoning: row.reasoning || null,
        model: row.model || null,
        promptTokens: row.promptTokens || 0,
        completionTokens: row.completionTokens || 0,
        totalTokens: row.totalTokens || 0,
        estimatedCostUsd: row.estimatedCostUsd || 0,
    };
}

function formatCoordinatorValue(value: unknown): string | null {
    if (Array.isArray(value)) {
        const filtered = value.map((item) => String(item || "").trim()).filter(Boolean);
        return filtered.length > 0 ? filtered.join(", ") : null;
    }
    const text = String(value ?? "").trim();
    if (!text || /^any\b/i.test(text) || text === "[]") return null;
    return text;
}

async function buildCoordinatorClientIntelligenceContext(args: {
    locationId: string;
    contactId: string | null;
    conversationId: string;
}) {
    if (!args.contactId) return "Client intelligence: No contact context available.";

    const contact = await db.contact.findFirst({
        where: { id: args.contactId, locationId: args.locationId },
        select: {
            id: true,
            name: true,
            firstName: true,
            leadStage: true,
            leadGoal: true,
            leadPriority: true,
            requirementStatus: true,
            requirementDistrict: true,
            requirementBedrooms: true,
            requirementMinPrice: true,
            requirementMaxPrice: true,
            requirementCondition: true,
            requirementPropertyTypes: true,
            requirementPropertyLocations: true,
            requirementOtherDetails: true,
            requirementSummary: true,
            propertiesInterested: true,
        },
    });

    if (!contact) return "Client intelligence: Contact not found.";

    const requirementLines = [
        `Client: ${contact.name || contact.firstName || "Unknown"}`,
        formatCoordinatorValue(contact.leadStage) ? `Lead stage: ${formatCoordinatorValue(contact.leadStage)}` : null,
        formatCoordinatorValue(contact.leadGoal) ? `Lead goal: ${formatCoordinatorValue(contact.leadGoal)}` : null,
        formatCoordinatorValue(contact.leadPriority) ? `Lead priority: ${formatCoordinatorValue(contact.leadPriority)}` : null,
        formatCoordinatorValue(contact.requirementStatus) ? `Status: ${formatCoordinatorValue(contact.requirementStatus)}` : null,
        formatCoordinatorValue(contact.requirementDistrict) ? `District: ${formatCoordinatorValue(contact.requirementDistrict)}` : null,
        formatCoordinatorValue(contact.requirementBedrooms) ? `Bedrooms: ${formatCoordinatorValue(contact.requirementBedrooms)}` : null,
        formatCoordinatorValue(contact.requirementPropertyTypes) ? `Property types: ${formatCoordinatorValue(contact.requirementPropertyTypes)}` : null,
        formatCoordinatorValue(contact.requirementPropertyLocations) ? `Locations: ${formatCoordinatorValue(contact.requirementPropertyLocations)}` : null,
        formatCoordinatorValue(contact.requirementMinPrice) || formatCoordinatorValue(contact.requirementMaxPrice)
            ? `Budget: ${formatCoordinatorValue(contact.requirementMinPrice) || "Any"} - ${formatCoordinatorValue(contact.requirementMaxPrice) || "Any"}`
            : null,
        formatCoordinatorValue(contact.requirementCondition) ? `Condition: ${formatCoordinatorValue(contact.requirementCondition)}` : null,
        formatCoordinatorValue(contact.requirementOtherDetails) ? `Other details: ${formatCoordinatorValue(contact.requirementOtherDetails)}` : null,
        formatCoordinatorValue(contact.requirementSummary) ? `Requirement history/summary: ${formatCoordinatorValue(contact.requirementSummary)}` : null,
    ].filter(Boolean);

    let interestedPropertiesText = "None recorded.";
    const interestedIds = Array.isArray(contact.propertiesInterested) ? contact.propertiesInterested.slice(0, 12) : [];
    if (interestedIds.length > 0) {
        const properties = await db.property.findMany({
            where: {
                locationId: args.locationId,
                id: { in: interestedIds },
            },
            select: {
                id: true,
                title: true,
                reference: true,
                price: true,
                bedrooms: true,
                propertyLocation: true,
                city: true,
                goal: true,
            },
            take: 12,
        });
        if (properties.length > 0) {
            interestedPropertiesText = properties.map((property) => {
                const bits = [
                    property.reference ? `Ref ${property.reference}` : property.id,
                    property.goal ? String(property.goal) : null,
                    property.price ? `Price ${property.price}` : null,
                    property.bedrooms != null ? `${property.bedrooms} beds` : null,
                    property.propertyLocation || property.city || null,
                ].filter(Boolean);
                return `- ${property.title} (${bits.join("; ")})`;
            }).join("\n");
        }
    }

    return [
        "Client intelligence for Coordinator:",
        "",
        "Approved/current contact requirements:",
        requirementLines.length > 0 ? requirementLines.join("\n") : "No approved requirements recorded.",
        "",
        "Interested properties recorded on contact:",
        interestedPropertiesText,
        "",
        "Coordinator rules for this context:",
        "- Treat approved/current contact requirements as the current source of truth.",
        "- Do not infer new hard requirements from historical proposal evidence.",
        "- If the approved requirements look stale or incomplete, suggest asking the client or reviewing requirements before using them as hard filters.",
        "- Suggest the next human-approved action or draft only. Do not imply automation or sending without approval.",
    ].join("\n");
}

export async function listContactRequirementProposals(contactId: string) {
    const location = await getAuthenticatedLocationReadOnly({ requireGhlToken: false });
    const contact = await db.contact.findFirst({
        where: {
            locationId: location.id,
            OR: [{ id: contactId }, { ghlContactId: contactId }],
        },
        select: { id: true },
    });
    if (!contact) return [];

    const rows = await listPendingRequirementProposals({
        locationId: location.id,
        contactId: contact.id,
        limit: 5,
    });
    return rows.map(serializeRequirementProposal);
}

export async function listContactVerificationProposals(contactId: string) {
    const location = await getAuthenticatedLocationReadOnly({ requireGhlToken: false });
    const contact = await db.contact.findFirst({
        where: {
            locationId: location.id,
            OR: [{ id: contactId }, { ghlContactId: contactId }],
        },
        select: { id: true },
    });
    if (!contact) return [];

    const rows = await listPendingContactVerificationProposals({
        locationId: location.id,
        contactId: contact.id,
        limit: 5,
    });
    return rows.map(serializeRequirementProposal);
}

export async function updateContactClientContextAction(conversationId: string, contactId: string) {
    const location = await getAuthenticatedLocationReadOnly({ requireGhlToken: false });
    const actor = await resolveLocationActorContext(location.id);
    if (!actor.hasAccess) {
        return { success: false as const, error: "Unauthorized" };
    }

    const contact = await db.contact.findFirst({
        where: {
            locationId: location.id,
            OR: [{ id: contactId }, { ghlContactId: contactId }],
        },
        select: { id: true },
    });
    if (!contact) return { success: false as const, error: "Contact not found." };

    let conversationInternalId: string | null = null;
    const requestedConversationId = String(conversationId || "").trim();
    if (requestedConversationId) {
        const conversation = await db.conversation.findFirst({
            where: buildConversationReferenceWhere(location.id, requestedConversationId),
            select: { id: true },
        });
        conversationInternalId = conversation?.id || null;
    }

    const propertyResult = await resolveContactPropertyEvidence({
        locationId: location.id,
        contactId: contact.id,
        conversationId: conversationInternalId,
        actorUserId: actor.userId || null,
        sourceType: "manual_context_update",
    });
    if (!propertyResult.success) return propertyResult;

    const proposalResult = await generateRequirementProposal({
        locationId: location.id,
        contactId: contact.id,
        conversationId: conversationInternalId,
        sourceType: "manual_context_update",
        actorUserId: actor.userId || null,
    });

    if (!proposalResult.success) {
        return { success: false as const, error: proposalResult.error };
    }

    invalidateConversationReadCaches(conversationInternalId || requestedConversationId, { skipPath: true });
    return {
        success: true as const,
        propertyCount: propertyResult.count,
        proposalCreated: Boolean(proposalResult.created),
        proposal: proposalResult.created ? serializeRequirementProposal(proposalResult.proposal) : null,
        reason: proposalResult.created ? null : proposalResult.reason,
    };
}

export async function scanContactVerificationAction(contactId: string, conversationId?: string | null) {
    const startedAt = Date.now();
    const requestedConversationId = String(conversationId || "").trim();
    const logTiming = (event: string, fields: Record<string, unknown> = {}) => {
        console.info("[AI Contact Verification Timing]", JSON.stringify({
            event,
            ts: new Date().toISOString(),
            contactId,
            requestedConversationId: requestedConversationId || null,
            elapsedMs: Date.now() - startedAt,
            ...fields,
        }));
    };
    logTiming("action_start");

    const authStartedAt = Date.now();
    const { location, actor } = await getAuthenticatedLocationActorFastReadOnly({ requireGhlToken: false });
    logTiming("action_auth_end", {
        locationId: location.id,
        authMs: Date.now() - authStartedAt,
        hasAccess: actor.hasAccess,
    });
    if (!actor.hasAccess) {
        logTiming("action_failed", { reason: "Unauthorized" });
        return { success: false as const, error: "Unauthorized" };
    }

    const contactLookupStartedAt = Date.now();
    const contact = await db.contact.findFirst({
        where: {
            locationId: location.id,
            OR: [{ id: contactId }, { ghlContactId: contactId }],
        },
        select: {
            id: true,
            name: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            contactType: true,
            leadGoal: true,
            qualificationStage: true,
            requirementSummary: true,
            requirementOtherDetails: true,
            notes: true,
            message: true,
        },
    });
    logTiming("action_contact_lookup_end", {
        locationId: location.id,
        contactLookupMs: Date.now() - contactLookupStartedAt,
        resolvedContactId: contact?.id || null,
    });
    if (!contact) {
        logTiming("action_failed", { locationId: location.id, reason: "Contact not found." });
        return { success: false as const, error: "Contact not found." };
    }

    const conversationInternalId = requestedConversationId || null;

    const scanStartedAt = Date.now();
    const result = await verifyContactProfile({
        locationId: location.id,
        contactId: contact.id,
        conversationId: conversationInternalId,
        sourceType: "manual_verification",
        actorUserId: actor.userId || null,
        contactSnapshot: contact,
    });
    logTiming(result.success ? "action_scan_end" : "action_scan_failed", {
        locationId: location.id,
        conversationId: conversationInternalId || null,
        resolvedContactId: contact.id,
        scanMs: Date.now() - scanStartedAt,
        success: result.success,
        proposalCreated: Boolean(result.success && result.created),
        reason: result.success ? result.reason || null : result.error || null,
    });
    if (!result.success) return result;

    invalidateConversationReadCaches(conversationInternalId || requestedConversationId, { skipPath: true });
    logTiming("action_complete", {
        locationId: location.id,
        conversationId: conversationInternalId || null,
        resolvedContactId: contact.id,
        proposalCreated: Boolean(result.created),
    });
    return {
        success: true as const,
        proposalCreated: Boolean(result.created),
        proposal: result.created ? serializeRequirementProposal(result.proposal) : null,
        reason: result.created ? null : result.reason,
        assessment: result.assessment || null,
    };
}

export async function approveContactRequirementProposalAction(proposalId: string, editedPatch?: any) {
    const location = await getAuthenticatedLocationReadOnly({ requireGhlToken: false });
    const actor = await resolveLocationActorContext(location.id);
    if (!actor.hasAccess) {
        return { success: false as const, error: "Unauthorized" };
    }

    const result = await approveRequirementProposal({
        locationId: location.id,
        proposalId,
        actorUserId: actor.userId || null,
        editedPatch: editedPatch || null,
    });
    if (!result.success) return result;

    if (result.contactId) {
        revalidatePath(`/admin/contacts/${result.contactId}/view`);
    }
    return result;
}

export async function rejectContactRequirementProposalAction(proposalId: string, reason?: string | null) {
    const location = await getAuthenticatedLocationReadOnly({ requireGhlToken: false });
    const actor = await resolveLocationActorContext(location.id);
    if (!actor.hasAccess) {
        return { success: false as const, error: "Unauthorized" };
    }
    return rejectRequirementProposal({
        locationId: location.id,
        proposalId,
        actorUserId: actor.userId || null,
        reason,
    });
}

export async function applyContactVerificationAction(proposalId: string, editedPatch?: any) {
    const location = await getAuthenticatedLocationReadOnly({ requireGhlToken: false });
    const actor = await resolveLocationActorContext(location.id);
    if (!actor.hasAccess) {
        return { success: false as const, error: "Unauthorized" };
    }

    const result = await approveContactVerificationProposal({
        locationId: location.id,
        proposalId,
        actorUserId: actor.userId || null,
        editedPatch: editedPatch || null,
    });
    if (!result.success) return result;

    if (result.contactId) {
        revalidatePath(`/admin/contacts/${result.contactId}/view`);
    }
    return result;
}

export async function rejectContactVerificationAction(proposalId: string, reason?: string | null) {
    const location = await getAuthenticatedLocationReadOnly({ requireGhlToken: false });
    const actor = await resolveLocationActorContext(location.id);
    if (!actor.hasAccess) {
        return { success: false as const, error: "Unauthorized" };
    }
    return rejectContactVerificationProposal({
        locationId: location.id,
        proposalId,
        actorUserId: actor.userId || null,
        reason,
    });
}

export async function markContactVerifiedAction(contactId: string) {
    const location = await getAuthenticatedLocationReadOnly({ requireGhlToken: false });
    const actor = await resolveLocationActorContext(location.id);
    if (!actor.hasAccess) {
        return { success: false as const, error: "Unauthorized" };
    }
    const contact = await db.contact.findFirst({
        where: {
            locationId: location.id,
            OR: [{ id: contactId }, { ghlContactId: contactId }],
        },
        select: { id: true },
    });
    if (!contact) return { success: false as const, error: "Contact not found." };
    return markContactVerified({
        locationId: location.id,
        contactId: contact.id,
        actorUserId: actor.userId || null,
    });
}

function serializePropertyMatchCampaign(row: any) {
    return {
        id: row.id,
        createdAt: row.createdAt?.toISOString?.() || null,
        updatedAt: row.updatedAt?.toISOString?.() || null,
        title: row.title,
        status: row.status,
        propertyId: row.propertyId,
        property: row.property ? {
            id: row.property.id,
            title: row.property.title,
            reference: row.property.reference,
            price: row.property.price,
            city: row.property.city,
            propertyLocation: row.property.propertyLocation,
        } : null,
        totalCandidates: row.totalCandidates || 0,
        processedCandidates: row.processedCandidates || 0,
        yesCount: row.yesCount || 0,
        maybeCount: row.maybeCount || 0,
        noCount: row.noCount || 0,
        approvedCount: row.approvedCount || 0,
        sentCount: row.sentCount || 0,
        queueCounts: row.queueCounts || null,
        priorityNote: row.priorityNote || null,
        scoringModel: row.scoringModel || null,
        fallbackPolicy: row.fallbackPolicy || "same_provider",
        propertySnapshot: row.propertySnapshot || null,
        collectionStatus: row.collectionStatus || null,
        processingStartedAt: row.processingStartedAt?.toISOString?.() || null,
        processingFinishedAt: row.processingFinishedAt?.toISOString?.() || null,
        lastError: row.lastError || null,
    };
}

function serializePropertyMatchCandidate(row: any) {
    return {
        id: row.id,
        campaignId: row.campaignId,
        contactId: row.contactId,
        conversationId: row.conversationId,
        structuredVerdict: row.structuredVerdict,
        aiVerdict: row.aiVerdict,
        aiReviewStatus: row.aiReviewStatus,
        aiReviewAttempts: row.aiReviewAttempts || 0,
        reviewerStatus: row.reviewerStatus,
        confidence: row.confidence,
        score: row.score,
        evidence: row.evidence || null,
        reasoning: row.reasoning || null,
        matchSummary: row.matchSummary || null,
        preferredChannel: row.preferredChannel || "SMS",
        draftBody: row.draftBody || "",
        draftGeneratedAt: row.draftGeneratedAt?.toISOString?.() || null,
        reviewedAt: row.reviewedAt?.toISOString?.() || null,
        sentAt: row.sentAt?.toISOString?.() || null,
        rejectedReason: row.rejectedReason || null,
        lastError: row.lastError || null,
        contact: row.contact ? {
            id: row.contact.id,
            createdAt: row.contact.createdAt?.toISOString?.() || null,
            updatedAt: row.contact.updatedAt?.toISOString?.() || null,
            name: row.contact.name,
            email: row.contact.email,
            phone: row.contact.phone,
            contactType: row.contact.contactType,
            leadGoal: row.contact.leadGoal,
            profileVerificationStatus: row.contact.profileVerificationStatus,
            requirementStatus: row.contact.requirementStatus,
            requirementBedrooms: row.contact.requirementBedrooms,
            requirementMaxPrice: row.contact.requirementMaxPrice,
            requirementPropertyTypes: row.contact.requirementPropertyTypes || [],
            requirementPropertyLocations: row.contact.requirementPropertyLocations || [],
            requirementSummary: row.contact.requirementSummary,
        } : null,
        conversation: row.conversation ? {
            id: row.conversation.id,
            ghlConversationId: row.conversation.ghlConversationId,
            lastMessageAt: row.conversation.lastMessageAt?.toISOString?.() || null,
            updatedAt: row.conversation.updatedAt?.toISOString?.() || null,
        } : null,
    };
}

function serializeContactPropertyRecommendation(row: any) {
    return {
        ...row,
        sentAt: row.sentAt?.toISOString?.() || null,
        reviewedAt: row.reviewedAt?.toISOString?.() || null,
    };
}

const DEFAULT_PROPERTY_MATCH_SEARCH_LIMIT = 12;
const MAX_PROPERTY_MATCH_SEARCH_LIMIT = 25;

export async function getPropertyMatchCampaignModelPreferenceAction() {
    try {
        const location = await getAuthenticatedLocationReadOnly({ requireGhlToken: false });
        const actor = await resolveLocationActorContext(location.id);
        if (!actor.hasAccess || !actor.userId) return { model: null as string | null };
        const doc = await settingsService.getDocument<{
            propertyMatchCampaignModel?: string | null;
            propertyMatchCampaignFallbackPolicy?: "same_provider" | "allow_paid" | null;
        }>({
            scopeType: "USER",
            scopeId: actor.userId,
            domain: SETTINGS_DOMAINS.USER_AI_PREFERENCES,
        });
        const model = String(doc?.payload?.propertyMatchCampaignModel || "").trim();
        return {
            model: model || null,
            fallbackPolicy: doc?.payload?.propertyMatchCampaignFallbackPolicy === "allow_paid"
                ? "allow_paid" as const
                : "same_provider" as const,
        };
    } catch (error) {
        console.error("[property-match-campaigns] model preference load failed", error);
        return { model: null as string | null, fallbackPolicy: "same_provider" as const };
    }
}

export async function savePropertyMatchCampaignModelPreferenceAction(
    model: string,
    fallbackPolicy: "same_provider" | "allow_paid" = "same_provider",
) {
    try {
        const location = await getAuthenticatedLocationReadOnly({ requireGhlToken: false });
        const actor = await resolveLocationActorContext(location.id);
        if (!actor.hasAccess || !actor.userId) return { success: false as const, error: "Unauthorized" };
        const normalizedModel = String(model || "").trim();
        const existing = await settingsService.getDocument<Record<string, unknown>>({
            scopeType: "USER",
            scopeId: actor.userId,
            domain: SETTINGS_DOMAINS.USER_AI_PREFERENCES,
        });
        await settingsService.upsertDocument({
            scopeType: "USER",
            scopeId: actor.userId,
            domain: SETTINGS_DOMAINS.USER_AI_PREFERENCES,
            actorUserId: actor.userId,
            payload: {
                ...(existing?.payload || {}),
                propertyMatchCampaignModel: normalizedModel || null,
                propertyMatchCampaignFallbackPolicy: fallbackPolicy === "allow_paid" ? "allow_paid" : "same_provider",
            },
        });
        return {
            success: true as const,
            model: normalizedModel || null,
            fallbackPolicy: fallbackPolicy === "allow_paid" ? "allow_paid" as const : "same_provider" as const,
        };
    } catch (error) {
        console.error("[property-match-campaigns] model preference save failed", error);
        return { success: false as const, error: "Could not save model preference." };
    }
}

export async function searchPropertyMatchCampaignPropertiesAction(query?: string, limit = DEFAULT_PROPERTY_MATCH_SEARCH_LIMIT) {
    const trimmed = String(query || "").trim();
    if (trimmed.length === 1) return [];

    const location = await getAuthenticatedLocationReadOnly({ requireGhlToken: false });
    const actor = await resolveLocationActorContext(location.id);
    if (!actor.hasAccess) return [];

    try {
        const cappedLimit = Math.min(
            Math.max(Math.floor(Number(limit) || DEFAULT_PROPERTY_MATCH_SEARCH_LIMIT), 1),
            MAX_PROPERTY_MATCH_SEARCH_LIMIT,
        );
        const rows = await db.property.findMany({
            where: {
                locationId: location.id,
                status: "ACTIVE",
                publicationStatus: { in: ["PUBLISHED", "DRAFT", "UNLISTED"] },
                ...(trimmed ? {
                    OR: [
                        { title: { contains: trimmed, mode: "insensitive" } },
                        { reference: { contains: trimmed, mode: "insensitive" } },
                        { slug: { contains: trimmed, mode: "insensitive" } },
                        { city: { contains: trimmed, mode: "insensitive" } },
                        { propertyLocation: { contains: trimmed, mode: "insensitive" } },
                    ],
                } : {}),
            },
            select: {
                id: true,
                title: true,
                reference: true,
                goal: true,
                type: true,
                price: true,
                bedrooms: true,
                city: true,
                propertyLocation: true,
                slug: true,
                updatedAt: true,
            },
            orderBy: [{ updatedAt: "desc" }],
            take: trimmed ? Math.max(cappedLimit * 3, cappedLimit) : cappedLimit,
        });

        return sortPropertyMatchSearchRows(trimmed, rows).slice(0, cappedLimit).map((row) => ({
            id: row.id,
            title: row.title,
            reference: row.reference,
            goal: row.goal,
            type: row.type,
            price: row.price,
            bedrooms: row.bedrooms,
            city: row.city,
            propertyLocation: row.propertyLocation,
        }));
    } catch (error) {
        console.error("[property-match-campaigns] property search failed", error);
        return [];
    }
}

export async function createPropertyMatchCampaignAction(input: {
    propertyId: string;
    priorityNote?: string | null;
    scoringModel?: string | null;
    fallbackPolicy?: "same_provider" | "allow_paid" | null;
}) {
    try {
        const location = await getAuthenticatedLocationReadOnly({ requireGhlToken: false });
        const actor = await resolveLocationActorContext(location.id);
        if (!actor.hasAccess) return { success: false as const, error: "Unauthorized" };

        const result = await createPropertyMatchCampaign({
            locationId: location.id,
            propertyId: String(input?.propertyId || "").trim(),
            priorityNote: input?.priorityNote || null,
            scoringModel: input?.scoringModel || null,
            fallbackPolicy: input?.fallbackPolicy || "same_provider",
            actorUserId: actor.userId || null,
        });
        revalidatePath("/admin/conversations");
        return result;
    } catch (error) {
        console.error("[property-match-campaigns] create campaign failed", error);
        return { success: false as const, error: "Could not create campaign." };
    }
}

export async function createPropertyMatchCampaignFromSourceAction(input: {
    propertyUrl?: string | null;
    propertyText?: string | null;
    priorityNote?: string | null;
    scoringModel?: string | null;
    fallbackPolicy?: "same_provider" | "allow_paid" | null;
}) {
    try {
        const location = await getAuthenticatedLocationReadOnly({ requireGhlToken: false });
        const actor = await resolveLocationActorContext(location.id);
        if (!actor.hasAccess) return { success: false as const, error: "Unauthorized" };

        const propertyUrl = String(input?.propertyUrl || "").trim();
        const propertyText = String(input?.propertyText || "").trim();
        let extracted: Awaited<ReturnType<typeof extractPropertyUrlContext>> | null = null;
        if (propertyUrl) {
            extracted = await extractPropertyUrlContext(propertyUrl);
            const canResolveOldCrmProperty = extractLegacyCrmRefCandidates(propertyUrl).length > 0;
            if (!extracted.success && !propertyText && !canResolveOldCrmProperty) {
                return { success: false as const, error: extracted.error || "Could not read that property URL." };
            }
        }

        const result = await createPropertyMatchCampaignFromSource({
            locationId: location.id,
            propertyUrl: extracted?.success ? extracted.url : propertyUrl || null,
            propertyText,
            extractedTitle: extracted?.success ? extracted.title || null : null,
            extractedDescription: extracted?.success ? extracted.description || null : null,
            extractedText: extracted?.success ? extracted.sourceText || null : null,
            priorityNote: input?.priorityNote || null,
            scoringModel: input?.scoringModel || null,
            fallbackPolicy: input?.fallbackPolicy || "same_provider",
            actorUserId: actor.userId || null,
        });
        revalidatePath("/admin/conversations");
        return result;
    } catch (error) {
        console.error("[property-match-campaigns] create source campaign failed", error);
        return { success: false as const, error: "Could not create campaign from URL/text." };
    }
}

export async function listPropertyMatchCampaignsAction(query?: string) {
    const location = await getAuthenticatedLocationReadOnly({ requireGhlToken: false });
    const actor = await resolveLocationActorContext(location.id);
    if (!actor.hasAccess) return [];
    const rows = await listPropertyMatchCampaigns({
        locationId: location.id,
        query: String(query || "").trim() || null,
        limit: 50,
    });
    return rows.map(serializePropertyMatchCampaign);
}

export async function listContactPropertyRecommendationsAction(contactId: string, conversationId?: string | null) {
    const location = await getAuthenticatedLocationReadOnly({ requireGhlToken: false });
    const actor = await resolveLocationActorContext(location.id);
    if (!actor.hasAccess) return [];
    const normalizedContactId = String(contactId || "").trim();
    if (!normalizedContactId) return [];
    const rows = await listContactPropertyRecommendations({
        locationId: location.id,
        contactId: normalizedContactId,
        conversationId: conversationId ? String(conversationId).trim() : null,
    });
    return rows.map(serializeContactPropertyRecommendation);
}

export async function getPropertyMatchCampaignDetailAction(
    campaignId: string,
    queue?: "review" | "approved" | "sent" | "skipped" | "rejected" | "needs_profile_verification" | "ai_error" | "not_match" | "already_shared" | "all",
) {
    try {
        const location = await getAuthenticatedLocationReadOnly({ requireGhlToken: false });
        const actor = await resolveLocationActorContext(location.id);
        if (!actor.hasAccess) return { success: false as const, error: "Unauthorized" };
        const detail = await getPropertyMatchCampaignDetail({
            locationId: location.id,
            campaignId: String(campaignId || "").trim(),
            queue,
        });
        if (!detail) return { success: false as const, error: "Campaign not found." };
        return {
            success: true as const,
            campaign: serializePropertyMatchCampaign(detail.campaign),
            candidates: detail.candidates.map(serializePropertyMatchCandidate),
        };
    } catch (error) {
        console.error("[property-match-campaigns] detail load failed", error);
        return { success: false as const, error: "Could not load campaign." };
    }
}

export async function updatePropertyMatchCampaignAction(campaignId: string, input: {
    title?: string | null;
    priorityNote?: string | null;
}) {
    try {
        const location = await getAuthenticatedLocationReadOnly({ requireGhlToken: false });
        const actor = await resolveLocationActorContext(location.id);
        if (!actor.hasAccess) return { success: false as const, error: "Unauthorized" };
        const result = await updatePropertyMatchCampaign({
            locationId: location.id,
            campaignId: String(campaignId || "").trim(),
            title: input?.title || null,
            priorityNote: input?.priorityNote || null,
        });
        revalidatePath("/admin/conversations");
        if (!result.success) return result;
        return { success: true as const, campaign: serializePropertyMatchCampaign(result.campaign) };
    } catch (error) {
        console.error("[property-match-campaigns] update campaign failed", error);
        return { success: false as const, error: "Could not update campaign." };
    }
}

export async function updatePropertyMatchCampaignProcessingConfigAction(
    campaignId: string,
    input: {
        scoringModel: string;
        fallbackPolicy: "same_provider" | "allow_paid";
    },
) {
    try {
        const location = await getAuthenticatedLocationReadOnly({ requireGhlToken: false });
        const actor = await resolveLocationActorContext(location.id);
        if (!actor.hasAccess) return { success: false as const, error: "Unauthorized" };
        const result = await updatePropertyMatchCampaignProcessingConfig({
            locationId: location.id,
            campaignId: String(campaignId || "").trim(),
            scoringModel: String(input?.scoringModel || "").trim(),
            fallbackPolicy: input?.fallbackPolicy === "allow_paid" ? "allow_paid" : "same_provider",
        });
        revalidatePath("/admin/conversations");
        if (!result.success) return result;
        return { success: true as const, campaign: serializePropertyMatchCampaign(result.campaign) };
    } catch (error) {
        console.error("[property-match-campaigns] processing config update failed", error);
        return { success: false as const, error: "Could not update campaign AI settings." };
    }
}

export async function deletePropertyMatchCampaignAction(campaignId: string) {
    try {
        const location = await getAuthenticatedLocationReadOnly({ requireGhlToken: false });
        const actor = await resolveLocationActorContext(location.id);
        if (!actor.hasAccess) return { success: false as const, error: "Unauthorized" };
        const result = await deletePropertyMatchCampaign({
            locationId: location.id,
            campaignId: String(campaignId || "").trim(),
        });
        revalidatePath("/admin/conversations");
        return result;
    } catch (error) {
        console.error("[property-match-campaigns] delete campaign failed", error);
        return { success: false as const, error: "Could not delete campaign." };
    }
}

export async function processPropertyMatchCampaignBatchAction(
    campaignId: string,
    limit?: number,
    modelOverride?: string | null,
    fallbackPolicy: "same_provider" | "allow_paid" = "same_provider",
) {
    try {
        const location = await getAuthenticatedLocationReadOnly({ requireGhlToken: false });
        const actor = await resolveLocationActorContext(location.id);
        if (!actor.hasAccess) return { success: false as const, error: "Unauthorized" };
        const result = await processPropertyMatchCampaignBatch({
            locationId: location.id,
            campaignId: String(campaignId || "").trim(),
            limit,
            model: String(modelOverride || "").trim() || null,
            fallbackPolicy,
            actorUserId: actor.userId || null,
        });
        revalidatePath("/admin/conversations");
        return result;
    } catch (error) {
        console.error("[property-match-campaigns] batch processing failed", error);
        return { success: false as const, error: "Batch processing failed." };
    }
}

export async function retryPropertyMatchCampaignAiErrorsAction(campaignId: string) {
    try {
        const location = await getAuthenticatedLocationReadOnly({ requireGhlToken: false });
        const actor = await resolveLocationActorContext(location.id);
        if (!actor.hasAccess) return { success: false as const, error: "Unauthorized" };
        const result = await retryPropertyMatchCampaignAiErrors({
            locationId: location.id,
            campaignId: String(campaignId || "").trim(),
        });
        revalidatePath("/admin/conversations");
        return result;
    } catch (error) {
        console.error("[property-match-campaigns] retry AI errors failed", error);
        return { success: false as const, error: "Could not retry AI errors." };
    }
}

export async function cancelPropertyMatchCampaignBatchAction(campaignId: string) {
    try {
        const location = await getAuthenticatedLocationReadOnly({ requireGhlToken: false });
        const actor = await resolveLocationActorContext(location.id);
        if (!actor.hasAccess) return { success: false as const, error: "Unauthorized" };
        const result = await cancelPropertyMatchCampaignBatch({
            locationId: location.id,
            campaignId: String(campaignId || "").trim(),
        });
        revalidatePath("/admin/conversations");
        return result;
    } catch (error) {
        console.error("[property-match-campaigns] cancel batch failed", error);
        return { success: false as const, error: "Could not stop batch processing." };
    }
}

export async function reviewPropertyMatchCandidateAction(candidateId: string, reviewerStatus: "approved" | "rejected" | "skipped" | "pending", reason?: string | null) {
    const location = await getAuthenticatedLocationReadOnly({ requireGhlToken: false });
    const actor = await resolveLocationActorContext(location.id);
    if (!actor.hasAccess) return { success: false as const, error: "Unauthorized" };
    return updatePropertyMatchCandidateReview({
        locationId: location.id,
        candidateId: String(candidateId || "").trim(),
        reviewerStatus,
        actorUserId: actor.userId || null,
        rejectedReason: reason || null,
        refreshCampaignCount: reviewerStatus !== "skipped" && reviewerStatus !== "rejected",
    });
}

export async function generatePropertyMatchCandidateDraftAction(candidateId: string) {
    const location = await getAuthenticatedLocationReadOnly({ requireGhlToken: false });
    const actor = await resolveLocationActorContext(location.id);
    if (!actor.hasAccess) return { success: false as const, error: "Unauthorized" };

    const candidate = await db.propertyMatchCandidate.findFirst({
        where: { id: String(candidateId || "").trim(), locationId: location.id },
        include: {
            campaign: true,
            contact: { select: { id: true, profileVerificationStatus: true } },
            conversation: { select: { id: true } },
        },
    });
    if (!candidate?.conversationId || !candidate?.contactId) {
        return { success: false as const, error: "Candidate conversation not found." };
    }
    if (!canCandidateDraftOrSend(candidate)) {
        return { success: false as const, error: "AI review must finish before drafting." };
    }

    const instruction = buildCampaignDraftInstruction({
        propertySnapshot: candidate.campaign?.propertySnapshot || {},
        priorityNote: candidate.campaign?.priorityNote || null,
    });
    const draftResult = await generateComposerAIDraft(
        candidate.conversationId,
        candidate.contactId,
        instruction,
        undefined,
        { mode: "chat" }
    );
    const draftBody = String(draftResult?.draft || "").trim();
    if (!draftBody) return { success: false as const, error: "Draft generation returned an empty draft." };

    const saveResult = await savePropertyMatchCandidateGeneratedDraft({
        locationId: location.id,
        candidateId: candidate.id,
        draftBody,
    });
    if (!saveResult.success) return saveResult;

    return { success: true as const, draft: draftBody };
}

export async function savePropertyMatchCandidateDraftAction(candidateId: string, draftBody: string) {
    const location = await getAuthenticatedLocationReadOnly({ requireGhlToken: false });
    const actor = await resolveLocationActorContext(location.id);
    if (!actor.hasAccess) return { success: false as const, error: "Unauthorized" };
    return savePropertyMatchCandidateDraft({
        locationId: location.id,
        candidateId: String(candidateId || "").trim(),
        draftBody,
    });
}

export async function sendPropertyMatchCandidateAction(candidateId: string, draftBody: string, channel?: "SMS" | "Email" | "WhatsApp" | "SMS_RELAY") {
    const location = await getAuthenticatedLocationReadOnly({ requireGhlToken: false });
    const actor = await resolveLocationActorContext(location.id);
    if (!actor.hasAccess) return { success: false as const, error: "Unauthorized" };

    const candidate = await db.propertyMatchCandidate.findFirst({
        where: { id: String(candidateId || "").trim(), locationId: location.id },
        include: {
            contact: { select: { id: true, profileVerificationStatus: true } },
            conversation: { select: { id: true } },
        },
    });
    if (!candidate?.conversationId || !candidate?.contactId) {
        return { success: false as const, error: "Candidate conversation not found." };
    }
    if (!canCandidateDraftOrSend(candidate)) {
        return { success: false as const, error: "AI review must finish before sending." };
    }
    if (candidate.reviewerStatus !== "approved") {
        return { success: false as const, error: "Approve this draft before sending." };
    }
    const savedDraft = String(candidate.draftBody || "").trim();
    const requestedDraft = String(draftBody || "").trim();
    if (requestedDraft && requestedDraft !== savedDraft) {
        return { success: false as const, error: "Approve the edited draft before sending." };
    }
    const body = savedDraft;
    if (!body) return { success: false as const, error: "Draft cannot be empty." };

    const priorShare = await findPriorPropertyShareForCandidate({
        locationId: location.id,
        candidateId: candidate.id,
    });
    if (priorShare) {
        await markPropertyMatchCandidateAlreadyShared({
            locationId: location.id,
            candidateId: candidate.id,
            evidence: priorShare as any,
        });
        return { success: false as const, error: "This property was already shared with this contact." };
    }

    const resolvedChannel = channel || candidate.preferredChannel || "SMS";
    if (!["SMS", "Email", "WhatsApp", "SMS_RELAY"].includes(resolvedChannel)) {
        return { success: false as const, error: "Unsupported message channel." };
    }

    const sendResult = await sendReply(
        candidate.conversationId,
        candidate.contactId,
        body,
        resolvedChannel as "SMS" | "Email" | "WhatsApp" | "SMS_RELAY",
        { clientMessageId: randomUUID(), clientSentAt: new Date().toISOString() }
    );
    if (!sendResult?.success) {
        await db.propertyMatchCandidate.update({
            where: { id: candidate.id },
            data: { lastError: String((sendResult as any)?.error || "Message send failed.") },
        });
        return sendResult;
    }
    await markPropertyMatchCandidateSent({
        locationId: location.id,
        candidateId: candidate.id,
    });
    invalidateConversationReadCaches(candidate.conversationId);
    return { success: true as const };
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

export async function getPropertyImageEnhancementModelCatalogAction(locationId?: string) {
    const requestedLocationId = String(locationId || "").trim();
    const location = requestedLocationId
        ? await (async () => {
            const { userId: clerkUserId } = await auth();
            if (!clerkUserId) throw new Error("Unauthorized");

            const user = await db.user.findUnique({
                where: { clerkId: clerkUserId },
                select: {
                    locations: {
                        where: { id: requestedLocationId },
                        select: { id: true },
                        take: 1,
                    },
                },
            });
            if (!user?.locations?.length) throw new Error("Unauthorized");

            return { id: requestedLocationId };
        })()
        : await getBasicLocationContext();
    const { getPropertyImageEnhancementModelCatalog } = await import("@/lib/ai/fetch-models");
    return getPropertyImageEnhancementModelCatalog(location.id);
}

async function resolveConversationChannelCapabilitiesForLocation(
    location: any,
    conversationId: string
): Promise<{ capabilities: ConversationChannelCapabilities; contactPhone: string | null; contactEmail: string | null }> {
    const conversation = await db.conversation.findFirst({
        where: buildConversationReferenceWhere(location.id, conversationId),
        select: {
            contact: {
                select: {
                    id: true,
                    name: true,
                    phone: true,
                    email: true,
                    contactType: true,
                },
            },
        },
    });

    if (!conversation?.contact) {
        return {
            contactPhone: null,
            contactEmail: null,
            capabilities: {
                SMS: unavailableChannel("missing_phone", "Conversation contact not found."),
                SMS_RELAY: unavailableChannel("missing_phone", "Conversation contact not found."),
                Email: unavailableChannel("missing_email", "Conversation contact not found."),
                WhatsApp: unavailableChannel("missing_phone", "Conversation contact not found."),
            },
        };
    }

    const contact = conversation.contact;
    const contactName = contact.name || "This contact";
    const phoneValue = String(contact.phone || "").trim();
    const rawDigits = phoneValue.replace(/\D/g, "");
    const hasEmail = String(contact.email || "").trim().length > 0;
    const hasUsablePhone = !!phoneValue && !phoneValue.includes("*") && rawDigits.length >= 7;
    const phoneFailure = !phoneValue
        ? unavailableChannel("missing_phone", `${contactName} does not have a phone number.`)
        : phoneValue.includes("*")
            ? unavailableChannel("masked_phone", `${contactName}'s phone number is masked.`)
            : rawDigits.length < 7
                ? unavailableChannel("invalid_phone", `${contactName}'s phone number is invalid or too short.`)
                : null;

    const emailCapability = hasEmail
        ? availableChannel()
        : unavailableChannel("missing_email", `${contactName} does not have an email address.`);

    let smsCapability = phoneFailure || unavailableChannel("ghl_sms_not_configured");
    let smsRelayCapability = phoneFailure || unavailableChannel("sms_relay_disabled", "Android SMS is disabled for this location.");
    if (hasUsablePhone) {
        if (isGhlIntegrationEnabled()) {
            const smsStatus = await checkGHLSMSStatus(location.id);
            if (smsStatus.status === "configured") {
                smsCapability = availableChannel();
            } else {
                const label = smsStatus.reason || "SMS is not configured for this location.";
                smsCapability = unavailableChannel("ghl_sms_not_configured", label);
            }
        } else {
            smsCapability = unavailableChannel("ghl_integration_paused", getGhlIntegrationDisabledReason());
        }

        const relayAvailability = await resolveSmsRelayAvailabilityForLocation({
            locationId: location.id,
            smsRelayEnabled: (location as any).smsRelayEnabled,
            contactPhone: phoneValue,
        });
        smsRelayCapability = relayAvailability.available
            ? availableChannel()
            : unavailableChannel(relayAvailability.reason || "sms_relay_disabled", relayAvailability.label);
    }

    let whatsAppCapability = phoneFailure || unavailableChannel("whatsapp_not_connected");
    if (hasUsablePhone) {
        const mode = await resolveLocationWhatsAppProviderMode(location.id);
        if (mode === "web_bridge") {
            const hasValidatedPhone = await hasValidatedWebBridgePhoneIdentity({
                locationId: location.id,
                contactId: contact.id,
                phone: phoneValue,
            });
            if (hasValidatedPhone) {
                whatsAppCapability = resolveWebBridgeWhatsAppChannelCapability({
                    hasEstablishedConversation: true,
                });
            } else {
                try {
                    const resolved = await resolveWhatsAppWebBridgeChatForPhone({
                        locationId: location.id,
                        phone: phoneValue,
                    });
                    const verificationUnknown = isResolvedWhatsAppWebBridgeChatVerificationUnknown(resolved);
                    const resolvedAvailable = isResolvedWhatsAppWebBridgeChatAvailable(resolved);
                    if (resolvedAvailable) {
                        await recordValidatedWebBridgePhoneIdentity({
                            locationId: location.id,
                            contactId: contact.id,
                            phone: phoneValue,
                        });
                    } else if (!verificationUnknown) {
                        await invalidateValidatedWebBridgePhoneIdentity({
                            locationId: location.id,
                            contactId: contact.id,
                            phone: phoneValue,
                        });
                    }
                    whatsAppCapability = resolveWebBridgeWhatsAppChannelCapability({
                        resolvedAvailable,
                        verificationUnknown,
                        definitiveNotFound: !verificationUnknown,
                    });
                } catch (error: any) {
                    const classification = classifyOutboundSendFailure(error);
                    if (classification.code === "WHATSAPP_NUMBER_NOT_FOUND") {
                        await invalidateValidatedWebBridgePhoneIdentity({
                            locationId: location.id,
                            contactId: contact.id,
                            phone: phoneValue,
                        });
                    }
                    whatsAppCapability = resolveWebBridgeWhatsAppChannelCapability({
                        definitiveNotFound: classification.code === "WHATSAPP_NUMBER_NOT_FOUND",
                        label: classification.code === "WHATSAPP_NUMBER_NOT_FOUND"
                            ? classification.label
                            : "WhatsApp is restoring. Messages can be queued and will send when the secure route is ready.",
                    });
                }
            }
        } else {
            const eligibility = await checkWhatsAppPhoneEligibility(
                { whatsappProviderMode: mode },
                contact.phone,
                { contactName, contactType: contact.contactType, verifyServiceHealth: true }
            );
            whatsAppCapability = eligibility.status === "eligible"
                ? availableChannel()
                : unavailableChannel(
                    eligibility.status === "ineligible" ? "whatsapp_number_not_found" : "unknown",
                    eligibility.reason || "Could not verify WhatsApp availability."
                );
        }
    }

    return {
        contactPhone: contact.phone || null,
        contactEmail: contact.email || null,
        capabilities: {
            SMS: smsCapability,
            SMS_RELAY: smsRelayCapability,
            Email: emailCapability,
            WhatsApp: whatsAppCapability,
        },
    };
}

export async function getConversationChannelCapabilities(conversationId: string) {
    try {
        const location = await getBasicLocationContext();
        const result = await resolveConversationChannelCapabilitiesForLocation(location, conversationId);
        return {
            success: true as const,
            ...result,
        };
    } catch (error: any) {
        console.error("[getConversationChannelCapabilities] Error:", error);
        return {
            success: false as const,
            reason: error?.message || "Failed to check channel availability.",
            capabilities: {
                SMS: unavailableChannel("unknown", "Could not verify SMS availability."),
                SMS_RELAY: unavailableChannel("unknown", "Could not verify Android SMS availability."),
                Email: unavailableChannel("unknown", "Could not verify email availability."),
                WhatsApp: unavailableChannel("unknown", "Could not verify WhatsApp availability."),
            } satisfies ConversationChannelCapabilities,
        };
    }
}

export async function getSmsChannelEligibility(conversationId: string) {
    try {
        const location = await getBasicLocationContext();

        const conversation = await db.conversation.findFirst({
            where: buildConversationReferenceWhere(location.id, conversationId),
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
        const capabilities = await resolveConversationChannelCapabilitiesForLocation(location, conversationId);
        const sms = capabilities.capabilities.SMS;

        return {
            success: true,
            eligible: sms.available,
            status: sms.available ? "eligible" as const : "ineligible" as const,
            reason: sms.label || undefined,
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
        const result = await resolveConversationChannelCapabilitiesForLocation(location, conversationId);
        const whatsApp = result.capabilities.WhatsApp;

        return {
            success: true,
            eligible: whatsApp.available,
            status: whatsApp.available ? "eligible" as const : "ineligible" as const,
            reason: whatsApp.label || undefined,
            phone: result.contactPhone,
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

export async function getWhatsAppWebBridgeStatus() {
    try {
        const location = await getBasicLocationContext();
        return getWhatsAppWebBridgeStatusForLocation(location);
    } catch (error: any) {
        console.error("getWhatsAppWebBridgeStatus error:", error);
        return {
            provider: "web_bridge" as const,
            mode: "web_bridge",
            status: "ERROR",
            qrcode: null,
            phone: null,
            lastSeenAt: null,
            lastReadyAt: null,
            error: "Unable to check WhatsApp status.",
            sto: {
                configured: false,
                state: "unavailable" as const,
                label: "STO Unavailable",
                detail: "STO Secure Delivery status is temporarily unavailable.",
                deviceAlias: null,
                networkType: null,
                lastConnectedAt: null,
                lastVerifiedAt: null,
                protectedSession: false,
            },
        };
    }
}

export async function triggerWhatsAppWebBridgeConnection() {
    try {
        const location = await getBasicLocationContext();
        const mode = await resolveLocationWhatsAppProviderMode(location.id);

        const doc = await settingsService.getDocument<any>({
            scopeType: "LOCATION",
            scopeId: location.id,
            domain: SETTINGS_DOMAINS.LOCATION_INTEGRATIONS,
        }).catch(() => null);
        await settingsService.upsertDocument({
            scopeType: "LOCATION",
            scopeId: location.id,
            domain: SETTINGS_DOMAINS.LOCATION_INTEGRATIONS,
            payload: {
                ...(doc?.payload || {}),
                whatsappProviderMode: "web_bridge",
            },
            schemaVersion: doc?.schemaVersion || 1,
        }).catch((error: any) => {
            console.warn("[WhatsApp Web Bridge] Failed to persist provider mode in settings:", error?.message || error);
        });
        await db.location.update({
            where: { id: location.id },
            data: { whatsappProviderMode: "web_bridge" } as any,
        }).catch((error: any) => {
            console.warn("[WhatsApp Web Bridge] Failed to persist provider mode on location:", error?.message || error);
        });

        const session = await getWhatsAppWebBridgeSession(location.id);
        const health = await getWhatsAppWebBridgeHealth().catch(() => null);
        const expectedSessionId = session?.sessionId || buildWhatsAppWebBridgeSessionId(location.id);
        const workerSession = (health?.sessions || []).find((item: any) =>
            item?.locationId === location.id || item?.sessionId === expectedSessionId
        );
        if (workerSession?.ready) {
            await upsertWhatsAppWebBridgeSession(location.id, {
                sessionId: workerSession.sessionId || expectedSessionId,
                status: "ready",
                qrCode: null,
                phone: workerSession.phone || session?.phone || null,
                lastReadyAt: workerSession.lastReadyAt ? new Date(workerSession.lastReadyAt) : new Date(),
                lastSeenAt: new Date(),
                lastError: null,
                isDefaultOutbound: true,
            }).catch(() => null);
            return {
                provider: "web_bridge" as const,
                success: true,
                qrCode: null,
                status: "ready",
                error: null as string | null,
            };
        }
        if (workerSession && ["starting", "authenticated", "qr", "reconnecting", "loading", "restarting"].includes(String(workerSession.status || ""))) {
            const workerStatus = String(workerSession.status || "starting");
            const staleNonReadyReason = getStaleWebBridgeNonReadyReason(workerSession, session?.lastSeenAt || null);
            if (isStaleWebBridgeQrStatus(workerStatus, workerSession.lastEventAt, session?.lastSeenAt || null) || staleNonReadyReason) {
                await restartWhatsAppWebBridgeSession(location.id);
                const refreshedSession = await getWhatsAppWebBridgeSession(location.id);
                return {
                    provider: "web_bridge" as const,
                    success: true,
                    qrCode: refreshedSession?.qrCode || null,
                    status: "reconnecting",
                    error: staleNonReadyReason,
                };
            }
            return {
                provider: "web_bridge" as const,
                success: true,
                qrCode: workerStatus === "qr" ? (session?.qrCode || null) : null,
                status: workerStatus,
                error: workerSession.lastError || null,
            };
        }

        await startWhatsAppWebBridgeSession(location.id);
        const nextSession = await getWhatsAppWebBridgeSession(location.id);
        return {
            provider: "web_bridge" as const,
            success: true,
            qrCode: nextSession?.qrCode || null,
            status: nextSession?.status || "starting",
            error: null as string | null,
        };
    } catch (error: any) {
        console.error("triggerWhatsAppWebBridgeConnection error:", error);
        return {
            provider: "web_bridge" as const,
            success: false,
            qrCode: null,
            status: "ERROR",
            error: error?.message || "Failed to start WhatsApp Web Bridge.",
        };
    }
}







export async function sendWhatsAppFailureSmsFallback(messageId: string) {
    const normalizedMessageId = String(messageId || "").trim();
    if (!normalizedMessageId) {
        return { success: false as const, error: "Missing message ID." };
    }

    const location = await getAuthenticatedLocationReadOnly({ requireGhlToken: false });
    const message = await db.message.findFirst({
        where: {
            id: normalizedMessageId,
            conversation: { locationId: location.id },
        },
        include: {
            outboundWhatsAppOutbox: true,
            conversation: { include: { contact: true } },
        },
    });

    if (!message) {
        return { success: false as const, error: "Message not found." };
    }
    if (message.direction !== "outbound" || !String(message.type || "").toUpperCase().includes("WHATSAPP")) {
        return { success: false as const, error: "Only failed outbound WhatsApp messages can use SMS fallback." };
    }
    if (message.status !== "failed" && message.outboundWhatsAppOutbox?.status !== "dead") {
        return { success: false as const, error: "WhatsApp message has not reached a final failed state." };
    }

    const classification = classifyOutboundSendFailure(message.outboundWhatsAppOutbox || {});
    if (classification.code !== "WHATSAPP_NUMBER_NOT_FOUND") {
        return { success: false as const, error: classification.label || "This WhatsApp failure is not eligible for SMS fallback." };
    }

    const contact = message.conversation.contact;
    if (!contact) {
        return { success: false as const, error: "Contact not found." };
    }
    const device = await (db as any).smsRelayDevice.findFirst({
        where: { locationId: location.id, paired: true },
        orderBy: { lastSeenAt: "desc" },
        select: { id: true, status: true, paired: true },
    });
    const availability = getSmsFallbackAvailability({
        smsRelayEnabled: !!(location as any).smsRelayEnabled,
        contactPhone: contact?.phone || null,
        smsRelayDevice: device,
    });
    if (!availability.available) {
        return {
            success: false as const,
            error: availability.reason === "sms_relay_offline"
                ? "SMS fallback unavailable: Android SMS device is offline."
                : "SMS fallback unavailable: no authenticated Android SMS device is available for this contact.",
            errorCode: availability.reason || "sms_unavailable",
        };
    }

    const { sendSmsRelayMessage } = await import("@/lib/sms-relay/send");
    const result = await sendSmsRelayMessage({
        locationId: location.id,
        conversationId: message.conversation.id,
        contactId: contact.id,
        messageBody: message.body || "",
        clientMessageId: `smsfallback_${message.id}_${randomUUID()}`,
    });

    if (!result.success) return result;

    await db.message.update({
        where: { id: result.messageId },
        data: {
            source: "sms_relay_whatsapp_fallback",
            updatedAt: new Date(),
        },
    }).catch((error) => {
        console.warn("[sendWhatsAppFailureSmsFallback] Failed to mark fallback source:", error);
    });

    invalidateConversationReadCaches(message.conversation.id);
    return {
        ...result,
        fallbackSourceMessageId: message.id,
        fallbackSource: "whatsapp_number_not_found",
    };
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

    if (message.type === 'TYPE_WHATSAPP') {
        try {
            const transportState = await resolveWhatsAppOutboundTransport(location.id);
            if (transportState.transport === "web_bridge" && !transportState.webBridgeConfigured) {
                return { success: false, error: "WhatsApp Web Bridge is selected but not connected. Scan the QR code first." };
            }
            if (!transportState.cloudConfigured && !transportState.webBridgeConfigured) {
                return { success: false, error: "WhatsApp is not connected." };
            }
            const windowError = requireTemplateWindowForCloud(contact as any, transportState.transport);
            if (windowError) return windowError;

            const existingOutbox = await (db as any).whatsAppOutboundOutbox.findFirst({
                where: { messageId: message.id },
                orderBy: { createdAt: "desc" },
            });

            if (existingOutbox) {
                await (db as any).whatsAppOutboundOutbox.update({
                    where: { id: existingOutbox.id },
                    data: {
                        status: "pending",
                        transport: transportState.transport,
                        attemptCount: 0,
                        lastError: null,
                        scheduledAt: new Date(),
                        lockedAt: null,
                        lockedBy: null,
                    },
                });

                await db.message.update({
                    where: { id: message.id },
                    data: {
                        status: "sending",
                        wamId: null,
                        updatedAt: new Date(),
                    },
                });

                return { success: true };
            }

            await enqueueWhatsAppOutbound({
                locationId: location.id,
                conversationInternalId: message.conversation.id,
                conversationGhlId: message.conversation.ghlConversationId || message.conversation.id,
                contactId: contact.id,
                body: message.body || "",
                kind: "text",
                source: "app_user",
                transport: transportState.transport,
            });

            await db.message.update({
                where: { id: message.id },
                data: { status: "failed", updatedAt: new Date() },
            }).catch(() => null);

            return { success: true };
        } catch (err: any) {
            console.error("Resend failed:", err);
            return { success: false, error: err.message };
        }
    }

    if (message.type === 'TYPE_SMS' && message.source === 'sms_relay') {
        try {
            // Re-enqueue the outbox job
            const outboxJob = await (db as any).smsRelayOutbox.findFirst({
                where: { messageId: message.id },
                orderBy: { createdAt: 'desc' }
            });

            if (outboxJob) {
                // Reset the existing job
                await (db as any).smsRelayOutbox.update({
                    where: { id: outboxJob.id },
                    data: {
                        status: 'pending',
                        attemptCount: 0,
                        lastError: null,
                        scheduledAt: new Date(),
                    }
                });
            } else {
                // If it doesn't exist for some reason, we'd need to create one, 
                // but we might not have the device ID handy here easily.
                // Just error out if we can't find the outbox record.
                return { success: false, error: "Original outbox job not found for resend." };
            }

            // Update message status to pending
            await db.message.update({
                where: { id: message.id },
                data: {
                    status: 'pending',
                    updatedAt: new Date(),
                }
            });

            return { success: true };
        } catch (err: any) {
            console.error("SMS Relay Resend failed:", err);
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
        where: buildConversationReferenceWhere(location.id, conversationId),
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
                    taskTitle: "Create Follow-up Plan",
                    taskStatus: "done",
                    thoughtSummary: result.thought || "Generated new follow-up plan based on goal.",
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
    const clientIntelligenceContext = await buildCoordinatorClientIntelligenceContext({
        locationId: location.id,
        contactId: resolvedContactId,
        conversationId: conversation.id,
    });

    try {
        const runtimeResult = await runAiSkillDecision({
            locationId: location.id,
            conversationId: conversation.id,
            contactId: resolvedContactId,
            source: "mission",
            contextSummary: [
                "Coordinator action: suggest_next_step_from_plan",
                `Task: ${String(nextTask.title || nextTask.id || "Untitled task")}`,
            ].join("\n"),
            extraInstruction: [
                REAL_ESTATE_COORDINATOR_LIFECYCLE_PROMPT,
                clientIntelligenceContext,
                `Suggest the next human-approved action for this task: ${String(nextTask.title || nextTask.id || "Untitled task")}`,
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
            thoughtSummary: nextTask.result || "Coordinator task executed.",
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
        nextTask.result = error?.message || "Coordinator task execution failed.";
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
            where: buildConversationReferenceWhere(location.id, conversationId),
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

const DEFAULT_TRACE_HISTORY_LIMIT = 10;
const MAX_TRACE_HISTORY_LIMIT = 25;
const TRACE_PREVIEW_CHAR_LIMIT = 8_000;

function parseAgentExecutionJsonField(value: any, fallback: any) {
    if (value == null) return fallback;
    if (typeof value === "string") {
        try {
            return JSON.parse(value);
        } catch {
            return fallback;
        }
    }
    return value;
}

function mapAgentExecutionSummary(e: any) {
    return {
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
        createdAt: e.createdAt.toISOString(),
        preview: {
            request: typeof e.promptPreview === "string" ? e.promptPreview : "",
            response: typeof e.responsePreview === "string" ? e.responsePreview : "",
            truncated: Boolean(e.promptPreviewTruncated || e.responsePreviewTruncated),
        },
    };
}

function mapAgentExecutionDetail(e: any) {
    return {
        ...mapAgentExecutionSummary(e),
        thoughtSteps: parseAgentExecutionJsonField(e.thoughtSteps, []),
        toolCalls: parseAgentExecutionJsonField(e.toolCalls, []),
    };
}

export async function getAgentExecutionHistoryPage(
    conversationId: string,
    options?: { cursor?: string | null; limit?: number | null }
) {
    const location = await getAuthenticatedLocation();
    const conversation = await db.conversation.findFirst({
        where: buildConversationReferenceWhere(location.id, conversationId),
        select: { id: true }
    });

    if (!conversation) return { items: [], nextCursor: null, hasMore: false };

    const requestedLimit = Math.floor(Number(options?.limit || DEFAULT_TRACE_HISTORY_LIMIT));
    const limit = Math.min(MAX_TRACE_HISTORY_LIMIT, Math.max(1, requestedLimit || DEFAULT_TRACE_HISTORY_LIMIT));
    const cursorRow = options?.cursor
        ? await db.agentExecution.findFirst({
            where: {
                id: options.cursor,
                conversationId: conversation.id,
                locationId: location.id,
            },
            select: { id: true, createdAt: true },
        })
        : null;

    const cursorCondition = cursorRow
        ? Prisma.sql`AND ("createdAt" < ${cursorRow.createdAt} OR ("createdAt" = ${cursorRow.createdAt} AND "id" < ${cursorRow.id}))`
        : Prisma.empty;

    // Fetch root spans (where parentSpanId is null OR spanId == traceId)
    // The current schema treats AgentExecution as a flattened span log.
    // We want the 'Root' entries which usually correspond to 'runAgent' or top-level tasks.
    const executions = await db.$queryRaw<any[]>`
        SELECT
            "id",
            "traceId",
            "spanId",
            "taskId",
            "taskTitle",
            "taskStatus",
            "status",
            "thoughtSummary",
            "draftReply",
            "promptTokens",
            "completionTokens",
            "totalTokens",
            "model",
            "cost",
            "latencyMs",
            "errorMessage",
            "createdAt",
            LEFT(COALESCE(("toolCalls"->0->'arguments')::text, ''), ${TRACE_PREVIEW_CHAR_LIMIT}) AS "promptPreview",
            LEFT(COALESCE(("toolCalls"->0->'result')::text, "draftReply", ''), ${TRACE_PREVIEW_CHAR_LIMIT}) AS "responsePreview",
            LENGTH(COALESCE(("toolCalls"->0->'arguments')::text, '')) > ${TRACE_PREVIEW_CHAR_LIMIT} AS "promptPreviewTruncated",
            LENGTH(COALESCE(("toolCalls"->0->'result')::text, "draftReply", '')) > ${TRACE_PREVIEW_CHAR_LIMIT} AS "responsePreviewTruncated"
        FROM "AgentExecution"
        WHERE "conversationId" = ${conversation.id}
            AND "locationId" = ${location.id}
            AND "parentSpanId" IS NULL
            ${cursorCondition}
        ORDER BY "createdAt" DESC, "id" DESC
        LIMIT ${limit + 1}
    `;

    const pageItems = executions.slice(0, limit);

    return {
        items: pageItems.map(mapAgentExecutionSummary),
        nextCursor: executions.length > limit ? pageItems[pageItems.length - 1]?.id || null : null,
        hasMore: executions.length > limit,
    };
}

// Compatibility wrapper used by mission-control summary hydration.
export async function getAgentExecutions(conversationId: string) {
    const page = await getAgentExecutionHistoryPage(conversationId, { limit: DEFAULT_TRACE_HISTORY_LIMIT });
    return page.items;
}

export async function getAgentExecutionDetail(conversationId: string, executionId: string) {
    const location = await getAuthenticatedLocation();
    const conversation = await db.conversation.findFirst({
        where: buildConversationReferenceWhere(location.id, conversationId),
        select: { id: true }
    });

    if (!conversation) return null;

    const execution = await db.agentExecution.findFirst({
        where: {
            id: executionId,
            conversationId: conversation.id,
            locationId: location.id,
        },
    });

    return execution ? mapAgentExecutionDetail(execution) : null;
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
                        conversationId: record.id,
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
                conversationId: conversation.id,
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
                ...buildConversationReferenceWhere(location.id, conversationId)
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
    const conversation = await db.conversation.findFirst({
        where: buildConversationReferenceWhere(location.id, conversationId),
        include: { contact: true }
    });

    if (!conversation) return null;

    const [locationDefaultReplyLanguage, latestMessage, hasOutboundMessage] = await Promise.all([
        getLocationDefaultReplyLanguage(location.id),
        db.message.findFirst({
            where: {
                conversationId: conversation.id,
                ...buildVisibleMessageSourceWhere(),
            },
            select: LATEST_MESSAGE_METADATA_SELECT,
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        }),
        db.message.findFirst({
            where: {
                conversationId: conversation.id,
                direction: "outbound",
                ...buildVisibleMessageSourceWhere(),
            },
            select: { id: true },
        }),
    ]);

    return mapConversationRowToUi(
        { ...conversation, latestMessage, hasOutboundMessage: !!hasOutboundMessage },
        location,
        undefined,
        locationDefaultReplyLanguage,
    );
}

export async function markConversationAsRead(conversationId: string) {
    const location = await getAuthenticatedLocationReadOnly();

    if (!conversationId) {
        return { success: false, error: "Missing conversationId" };
    }

    try {
        const conversation = await db.conversation.findFirst({
            where: buildConversationReferenceWhere(location.id, conversationId),
            select: { id: true, contactId: true },
        });
        if (!conversation) {
            return { success: false, error: "Conversation not found" };
        }

        const result = await db.conversation.updateMany({
            where: {
                id: conversation.id,
                locationId: location.id,
                unreadCount: { gt: 0 },
            },
            data: {
                unreadCount: 0,
            }
        });

        if (result.count > 0) {
            queueGhlConversationStatusSync({
                locationId: location.id,
                conversations: [conversation],
                payload: {
                    source: "mark_conversation_as_read",
                    estioStatus: "read",
                    unreadCount: 0,
                },
            });
            invalidateConversationReadCaches(conversation.id);
            emitConversationRealtimeEvent({
                locationId: location.id,
                conversationId: conversation.id,
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
        const resolved = await resolveConversationLifecycleTargets({
            locationId: location.id,
            conversationRefs: conversationIds,
            state: "notDeleted",
            findMany: (query) => db.conversation.findMany(query),
        });
        if (!resolved.success) return resolved;

        const { userId } = await auth();
        if (!userId) return { success: false, error: "Unauthorized" };
        const targetConversations = resolved.targets;
        // Soft Delete: Mark conversations as deleted instead of removing them
        // This allows users to restore them from the trash within 30 days
        const result = await db.conversation.updateMany({
            where: {
                id: { in: targetConversations.map((conversation) => conversation.id) },
                locationId: location.id, // Security check to ensure ownership
                deletedAt: null // Only delete non-deleted conversations (prevent double-delete)
            },
            data: {
                deletedAt: new Date(),
                deletedBy: userId,
            }
        });

        console.log(`[Soft Delete] Moved ${result.count} conversations to trash.`);
        queueGhlConversationStatusSync({
            locationId: location.id,
            conversations: targetConversations,
            payload: {
                source: "delete_conversations",
                estioStatus: "trash",
                deletedAt: new Date().toISOString(),
            },
        });
        invalidateConversationReadCaches();
        targetConversations.forEach((conversation) => {
            emitConversationRealtimeEvent({
                locationId: location.id,
                conversationId: conversation.id,
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
        const resolved = await resolveConversationLifecycleTargets({
            locationId: location.id,
            conversationRefs: conversationIds,
            state: "trashed",
            findMany: (query) => db.conversation.findMany(query),
        });
        if (!resolved.success) return resolved;
        const targetConversations = resolved.targets;
        // Restore: Remove deletedAt timestamp to bring back from trash
        const result = await db.conversation.updateMany({
            where: {
                id: { in: targetConversations.map((conversation) => conversation.id) },
                locationId: location.id,
                deletedAt: { not: null } // Only restore deleted conversations
            },
            data: {
                deletedAt: null,
                archivedAt: null,
                deletedBy: null
            }
        });

        console.log(`[Restore] Restored ${result.count} conversations from trash.`);
        queueGhlConversationStatusSync({
            locationId: location.id,
            conversations: targetConversations,
            payload: {
                source: "restore_conversations",
                estioStatus: "open",
                deletedAt: null,
                archivedAt: null,
            },
        });
        invalidateConversationReadCaches();
        targetConversations.forEach((conversation) => {
            emitConversationRealtimeEvent({
                locationId: location.id,
                conversationId: conversation.id,
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
        const resolved = await resolveConversationLifecycleTargets({
            locationId: location.id,
            conversationRefs: conversationIds,
            state: "trashed",
            findMany: (query) => db.conversation.findMany(query),
        });
        if (!resolved.success) return resolved;
        const targetConversations = resolved.targets;
        // Hard Delete: Permanently remove from database
        // Can only delete conversations that are already in trash (have deletedAt)
        const result = await db.conversation.deleteMany({
            where: {
                id: { in: targetConversations.map((conversation) => conversation.id) },
                locationId: location.id,
                deletedAt: { not: null } // Security: Only allow permanent deletion of trashed items
            }
        });

        console.log(`[Permanent Delete] Permanently deleted ${result.count} conversations.`);
        invalidateConversationReadCaches();
        targetConversations.forEach((conversation) => {
            emitConversationRealtimeEvent({
                locationId: location.id,
                conversationId: conversation.id,
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
        const resolved = await resolveConversationLifecycleTargets({
            locationId: location.id,
            conversationRefs: conversationIds,
            state: "active",
            findMany: (query) => db.conversation.findMany(query),
        });
        if (!resolved.success) return resolved;
        const targetConversations = resolved.targets;
        // Archive: Hide from inbox without deleting
        const result = await db.conversation.updateMany({
            where: {
                id: { in: targetConversations.map((conversation) => conversation.id) },
                locationId: location.id,
                archivedAt: null, // Only archive non-archived conversations
                deletedAt: null // Don't archive deleted conversations
            },
            data: {
                archivedAt: new Date()
            }
        });

        console.log(`[Archive] Archived ${result.count} conversations.`);
        queueGhlConversationStatusSync({
            locationId: location.id,
            conversations: targetConversations,
            payload: {
                source: "archive_conversations",
                estioStatus: "archived",
                archivedAt: new Date().toISOString(),
            },
        });
        invalidateConversationReadCaches();
        targetConversations.forEach((conversation) => {
            emitConversationRealtimeEvent({
                locationId: location.id,
                conversationId: conversation.id,
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
        const resolved = await resolveConversationLifecycleTargets({
            locationId: location.id,
            conversationRefs: conversationIds,
            state: "archived",
            findMany: (query) => db.conversation.findMany(query),
        });
        if (!resolved.success) return resolved;
        const targetConversations = resolved.targets;
        // Unarchive: Return to inbox
        const result = await db.conversation.updateMany({
            where: {
                id: { in: targetConversations.map((conversation) => conversation.id) },
                locationId: location.id,
                archivedAt: { not: null } // Only unarchive archived conversations
            },
            data: {
                archivedAt: null
            }
        });

        console.log(`[Unarchive] Unarchived ${result.count} conversations.`);
        queueGhlConversationStatusSync({
            locationId: location.id,
            conversations: targetConversations,
            payload: {
                source: "unarchive_conversations",
                estioStatus: "open",
                archivedAt: null,
            },
        });
        invalidateConversationReadCaches();
        targetConversations.forEach((conversation) => {
            emitConversationRealtimeEvent({
                locationId: location.id,
                conversationId: conversation.id,
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
            select: { id: true },
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
                conversationId: row.id,
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
            where: buildConversationReferenceWhere(location.id, conversationId)
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
    location: { whatsappProviderMode?: string | null },
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

    if (String(location?.whatsappProviderMode || "web_bridge") === "web_bridge") {
        return {
            status: 'unknown',
            reason: 'WhatsApp Web Bridge will verify this number at send time.',
            normalizedDigits: rawDigits,
        };
    }

    return {
        status: 'unknown',
        reason: 'WhatsApp Web Bridge will verify this number at send time.',
        normalizedDigits: rawDigits,
    };
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

    if (!isGhlIntegrationEnabled()) {
        return {
            status: 'unknown',
            reason: getGhlIntegrationDisabledReason(),
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
    _location: { whatsappProviderMode?: string | null },
    phone: string | null | undefined
): Promise<'TYPE_WHATSAPP' | 'TYPE_SMS'> {
    const rawDigits = String(phone || '').replace(/\D/g, '');
    return rawDigits.length >= 7 ? 'TYPE_WHATSAPP' : 'TYPE_SMS';
}

function getWhatsAppWebChatIdFromPhone(phone: string | null | undefined) {
    const digits = String(phone || "").replace(/\D/g, "");
    return digits.length >= 7 ? `${digits}@c.us` : "";
}

async function importWebBridgeRecentMessagesForContact(args: {
    locationId: string;
    phone: string | null | undefined;
    chatId?: string | null;
    canonicalContactId?: string | null;
    canonicalConversationId?: string | null;
    canonicalPhone?: string | null;
    contactName?: string | null;
    limit?: number;
    logPrefix?: string;
    stopAfterDuplicates?: number;
}) {
    const chatId = String(args.chatId || "").trim() || getWhatsAppWebChatIdFromPhone(args.phone);
    if (!chatId) {
        return { imported: 0, skipped: 0, errors: 0, processed: 0 };
    }

    const { messages } = await fetchWhatsAppWebBridgeMessages({
        locationId: args.locationId,
        chatId,
        limit: args.limit || 30,
        includeMedia: true,
    });

    let imported = 0;
    let skipped = 0;
    let errors = 0;
    let processed = 0;
    let consecutiveDuplicates = 0;
    const stopAfterDuplicates = Math.max(1, Number(args.stopAfterDuplicates || 5));

    for (const message of messages || []) {
        const wamId = String(message?.id || "").trim();
        if (!wamId) continue;

        try {
            const messageIdentity = resolveInboundWhatsAppContactIdentity({ message });
            const { fromMe, remoteJid: remoteId, contactIdentity, ownIdentity } = messageIdentity;
            const { resolveWebBridgeIdentity } = await import("@/lib/whatsapp/web-bridge-identity");
            const resolvedIdentity = await resolveWebBridgeIdentity({
                locationId: args.locationId,
                remoteJid: messageIdentity.contactJid,
                identity: message?.contactIdentity || null,
            });
            const ownPhone = ownIdentity.phone || args.locationId;
            const resolvedMessagePhone = getHighConfidenceWebBridgeResolvedPhone(resolvedIdentity, ownPhone);
            let contactPhone = contactIdentity.phone || resolvedMessagePhone;
            const contactLid = resolvedIdentity.lid || contactIdentity.lid || "";
            let canonicalPhoneDigits = String(args.canonicalPhone || args.phone || "").replace(/\D/g, "");
            if (!canonicalPhoneDigits && args.canonicalContactId && contactPhone) {
                const resolvedContactDigits = String(contactPhone || "").replace(/\D/g, "");
                if (resolvedContactDigits.length >= 7) {
                    const backfilled = await db.contact.update({
                        where: { id: args.canonicalContactId },
                        data: { phone: `+${resolvedContactDigits}` } as any,
                    }).then(() => true).catch((error) => {
                        console.warn(`${args.logPrefix || "[Sync][web_bridge]"} Failed to backfill canonical contact phone:`, error?.message || error);
                        return false;
                    });
                    if (backfilled) canonicalPhoneDigits = resolvedContactDigits;
                }
            }
            if (!contactPhone && fromMe && contactLid && canonicalPhoneDigits.length >= 7) {
                contactPhone = canonicalPhoneDigits;
            }
            const contactAddress = contactPhone || contactLid;
            if (!contactIdentity.isSupported || !contactAddress) {
                skipped++;
                continue;
            }

            if (contactLid && args.canonicalContactId && canonicalPhoneDigits.length >= 7) {
                const { upsertWebBridgeIdentityMap } = await import("@/lib/whatsapp/web-bridge-identity");
                await upsertWebBridgeIdentityMap({
                    locationId: args.locationId,
                    contactId: args.canonicalContactId,
                    identityType: "lid",
                    identityValue: contactLid,
                    lid: contactLid,
                    phone: `+${canonicalPhoneDigits}`,
                    displayName: resolvedIdentity.displayName || message?.contactName || message?.notifyName || args.contactName || null,
                    confidence: "high",
                    source: "history_sync_canonical_contact",
                    lastSeenAt: new Date(Number(message?.timestamp || Date.now() / 1000) * 1000),
                    metadata: message?.contactIdentity || undefined,
                });
                await db.contact.update({
                    where: { id: args.canonicalContactId },
                    data: { lid: contactLid } as any,
                }).catch(() => null);
                if (args.canonicalConversationId) {
                    await db.conversationSync.upsert({
                        where: {
                            conversationId_provider_providerAccountId: {
                                conversationId: args.canonicalConversationId,
                                provider: "whatsapp_web_bridge",
                                providerAccountId: "default",
                            },
                        },
                        create: {
                            conversationId: args.canonicalConversationId,
                            locationId: args.locationId,
                            provider: "whatsapp_web_bridge",
                            providerAccountId: "default",
                            providerConversationId: chatId,
                            status: "synced",
                            lastSyncedAt: new Date(),
                        },
                        update: {
                            providerConversationId: chatId,
                            status: "synced",
                            lastSyncedAt: new Date(),
                        },
                    }).catch(() => null);
                }
            }

            const result = await processNormalizedMessage({
                locationId: args.locationId,
                from: fromMe ? ownPhone : contactAddress,
                to: fromMe ? contactAddress : ownPhone,
                body: getWhatsAppWebBridgeBody(message, fromMe ? "outbound" : "inbound"),
                type: String(message?.type || "text") as any,
                wamId,
                timestamp: new Date(Number(message?.timestamp || Date.now() / 1000) * 1000),
                direction: fromMe ? "outbound" : "inbound",
                source: "whatsapp_web_bridge" as any,
                contactName: fromMe ? undefined : (resolvedIdentity.displayName || message?.contactName || message?.notifyName || args.contactName || undefined),
                resolvedPhone: contactPhone || undefined,
                lid: contactLid || undefined,
                remoteJid: remoteId,
                chatId,
                isGroup: messageIdentity.isGroup,
                participant: messageIdentity.isGroup ? messageIdentity.senderJid : undefined,
                participantJid: messageIdentity.isGroup ? messageIdentity.senderJid : undefined,
                webBridgeIdentity: {
                    ...resolvedIdentity,
                    rawContactIdentity: message?.contactIdentity || null,
                } as any,
            });

            processed++;
            const resultStatus = String(result?.status || "");
            if (resultStatus === "skipped") {
                skipped++;
                consecutiveDuplicates++;
            } else if (resultStatus === "processed") {
                imported++;
                consecutiveDuplicates = 0;
            } else {
                errors++;
                consecutiveDuplicates = 0;
            }

            if (message?.hasMedia || message?.media || message?.mediaError || message?.mediaMeta) {
                const messageId = (result as any)?.id || await db.message.findUnique({
                    where: { wamId },
                    select: { id: true },
                }).then((row) => row?.id).catch(() => null);

                if (messageId && message?.media?.data) {
                    const ingestResult = await ingestWhatsAppWebBridgeMediaAttachment({
                        wamId,
                        media: message.media,
                        messageType: String(message?.type || "text"),
                    });
                    if (ingestResult?.status === "stored") {
                        await updateWebBridgeMediaSyncMetadata(messageId, {
                            status: "stored",
                            key: ingestResult.key || null,
                            attachmentId: ingestResult.attachmentId || null,
                            error: null,
                            reason: null,
                            workerError: null,
                            meta: message?.mediaMeta || null,
                        });
                    } else {
                        await updateWebBridgeMediaSyncMetadata(messageId, {
                            status: ingestResult?.status || "skipped",
                            reason: ingestResult?.reason || "unknown",
                            error: null,
                            meta: message?.mediaMeta || null,
                        });
                    }
                } else if (messageId && message?.mediaError) {
                    await updateWebBridgeMediaSyncMetadata(messageId, {
                        status: "failed",
                        reason: message?.mediaError?.code || "download_failed",
                        error: message?.mediaError?.message || String(message?.mediaError || "WhatsApp Web Bridge could not retrieve media."),
                        meta: message?.mediaMeta || null,
                    });
                } else if (messageId && message?.hasMedia) {
                    await updateWebBridgeMediaSyncMetadata(messageId, {
                        status: "skipped",
                        reason: "missing_media_payload",
                        error: null,
                        meta: message?.mediaMeta || null,
                    });
                }
            }

            if (consecutiveDuplicates >= stopAfterDuplicates) {
                break;
            }
        } catch (error) {
            errors++;
            consecutiveDuplicates = 0;
            console.warn(`${args.logPrefix || "[WebBridgeHistory]"} Failed to import message ${wamId}:`, error);
        }
    }

    if (args.logPrefix) {
        console.log(`${args.logPrefix} Imported ${imported} recent WhatsApp Web Bridge messages; skipped=${skipped}; errors=${errors}.`);
    }
    return { imported, skipped, errors, processed };
}




async function fetchWebBridgeChatsForPicker(location: { id: string }) {
    try {
        const res = await fetchWhatsAppWebBridgeChats(location.id);
        const allChats = Array.isArray(res?.chats) ? res.chats : [];
        const validChats = allChats.filter((chat: any) => parseWhatsAppWebChatIdentity(chat.id).isSupported);

        const existingContacts = await db.contact.findMany({
            where: { locationId: location.id, phone: { not: null } },
            select: { phone: true, name: true },
        });
        const existingConversations = await db.conversation.findMany({
            where: { locationId: location.id },
            include: { contact: { select: { phone: true, lid: true } } },
        });
        const syncedPhones = new Set(
            existingConversations
                .map((c: any) => c.contact?.phone?.replace(/\D/g, ""))
                .filter(Boolean)
        );
        const syncedLids = new Set(
            existingConversations
                .map((c: any) => c.contact?.lid)
                .filter(Boolean)
        );

        const { resolveWebBridgeIdentity } = await import("@/lib/whatsapp/web-bridge-identity");
        const formatted = await Promise.all(validChats.map(async (chat: any) => {
            const jid = String(chat.id || "");
            const identity = parseWhatsAppWebChatIdentity(jid);
            const resolvedIdentity = await resolveWebBridgeIdentity({
                locationId: location.id,
                remoteJid: jid,
                identity: chat.contactIdentity || null,
            });
            const rawPhone = identity.phone || getHighConfidenceWebBridgeResolvedPhone(resolvedIdentity);
            const lid = resolvedIdentity.lid || identity.lid || "";
            const alreadySynced = (
                !!rawPhone
                && (
                    syncedPhones.has(rawPhone)
                    || Array.from(syncedPhones).some((p) => p?.endsWith(rawPhone) || rawPhone.endsWith(p || ""))
                )
            ) || (!!lid && syncedLids.has(lid));
            const matchedContact = existingContacts.find((c) => {
                const cp = c.phone?.replace(/\D/g, "") || "";
                return cp === rawPhone || cp.endsWith(rawPhone) || rawPhone.endsWith(cp);
            });

            return {
                jid,
                phone: rawPhone ? `+${rawPhone}` : null,
                lid,
                name: resolvedIdentity.displayName || chat.name || matchedContact?.name || "WhatsApp Contact",
                isGroup: false,
                alreadySynced,
                lastMessageTimestamp: chat.timestamp || null,
                provider: "web_bridge",
                identityPending: !rawPhone && !!lid,
            };
        }));

        formatted.sort((a: any, b: any) => {
            if (a.alreadySynced !== b.alreadySynced) return a.alreadySynced ? 1 : -1;
            return (b.lastMessageTimestamp || 0) - (a.lastMessageTimestamp || 0);
        });

        return { success: true, chats: formatted };
    } catch (e: any) {
        console.error("[FetchChats] Web Bridge failed:", e);
        return { success: false, error: e.message || "WhatsApp Web Bridge is not connected", chats: [] };
    }
}




export async function fetchWhatsAppChats() {
    const location = await getAuthenticatedLocationReadOnly({ requireGhlToken: false });
    return fetchWebBridgeChatsForPicker(location);
}

/**
 * Create a new conversation for a phone number, with history backfill from WhatsApp Web Bridge.
 */
export async function startNewConversation(phone: string) {
    const timer = createActionTimer("NewConversation");
    const location = await getAuthenticatedLocationReadOnly({ requireGhlToken: false });
    const { userId: clerkUserId } = await auth();
    const currentUser = clerkUserId
        ? await db.user.findUnique({ where: { clerkId: clerkUserId }, select: { id: true } })
        : null;
    const preferredUserId = currentUser?.id || null;
    timer.mark("auth/location");
    const providerMode = await resolveLocationWhatsAppProviderMode(location.id);
    timer.mark("provider mode");

    const requestedIdentity = String(phone || "").trim();
    const isRequestedLid = /@lid$/i.test(requestedIdentity);
    const requestedLid = isRequestedLid ? requestedIdentity : "";
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(requestedIdentity);

    if (!isRequestedLid && !isEmail) {
        const validationError = getNewConversationPhoneInputError(requestedIdentity);
        if (validationError) {
            timer.total();
            return { success: false, error: validationError };
        }
    }

    // Normalize phone to E.164 using the same libphonenumber path as Paste Lead.
    const phoneNormalization = isRequestedLid || isEmail
        ? null
        : normalizeInternationalPhone(requestedIdentity);
    let normalizedPhone = isRequestedLid || isEmail
        ? ""
        : phoneNormalization?.formatted || requestedIdentity.replace(/\s+/g, '').replace(/[-()]/g, '');
    if (normalizedPhone && !normalizedPhone.startsWith('+')) {
        normalizedPhone = `+${normalizedPhone.replace(/\D/g, '')}`;
    }

    const rawDigits = normalizedPhone.replace(/\D/g, '');

    const preferredChannelType = isEmail
        ? "TYPE_EMAIL"
        : providerMode === "web_bridge"
        ? "TYPE_WHATSAPP"
        : await resolvePreferredChannelTypeForPhone(location, rawDigits);

    try {
        const backgroundJobsQueued: string[] = [];
        const queueWebBridgeHistoryBackfill = (args: {
            conversationId: string;
            legacyConversationId?: string | null;
            contactId: string;
            contactPhone?: string | null;
            contactName?: string | null;
        }) => {
            if (providerMode !== "web_bridge") {
                return false;
            }

            backgroundJobsQueued.push("webBridgeHistoryBackfill");
            runDetachedTask(`new_conversation_web_bridge_history:${args.conversationId}`, async () => {
                const backfillStartedAt = Date.now();
                try {
                    const backfill = await importWebBridgeRecentMessagesForContact({
                        locationId: location.id,
                        phone: args.contactPhone || rawDigits,
                        chatId: requestedLid || undefined,
                        canonicalContactId: args.contactId,
                        canonicalConversationId: args.conversationId,
                        canonicalPhone: args.contactPhone || normalizedPhone || rawDigits,
                        contactName: args.contactName,
                        limit: 30,
                        logPrefix: `[NewConversation][background:${args.legacyConversationId || args.conversationId}]`,
                    });
                    console.log(`[NewConversation] timing Web Bridge backfill background: ${Date.now() - backfillStartedAt}ms; imported=${backfill.imported}; skipped=${backfill.skipped}; errors=${backfill.errors}`);
                } catch (backfillErr) {
                    console.warn("[NewConversation] Web Bridge history backfill failed:", backfillErr);
                }
            });
            timer.mark("Web Bridge backfill queued");
            return true;
        };

        // 1. Find or create contact
        const searchSuffix = rawDigits.length > 2 ? rawDigits.slice(-2) : rawDigits;
        const candidates = await db.contact.findMany({
            where: {
                locationId: location.id,
                OR: [
                    ...(searchSuffix ? [{ phone: { contains: searchSuffix } }] : []),
                    ...(requestedLid ? [{ lid: requestedLid }] : []),
                    ...(isEmail ? [{ email: { equals: requestedIdentity, mode: 'insensitive' } }] : []),
                ],
            } as any
        });

        let contact = candidates.find((candidate) => matchesNewConversationContact(candidate, {
            locationId: location.id,
            rawDigits,
            requestedIdentity,
            requestedLid,
            isEmail,
        }));
        let isNewContact = false;

        if (!contact) {
            // Create new contact
            const newName = isRequestedLid ? "WhatsApp Contact" : isEmail ? requestedIdentity.split('@')[0] : `WhatsApp ${normalizedPhone}`;
            contact = await db.contact.create({
                data: {
                    locationId: location.id,
                    phone: isRequestedLid || isEmail ? undefined : normalizedPhone,
                    email: isEmail ? requestedIdentity : undefined,
                    lid: requestedLid || undefined,
                    name: newName,
                    status: "New",
                    contactType: "Lead"
                }
            });
            isNewContact = true;
            console.log(`[NewConversation] Created new contact: ${contact.id} for ${normalizedPhone}`);
        } else {
            console.log(`[NewConversation] Found existing contact: ${contact.name} (${contact.id})`);
        }
        timer.mark("contact lookup/create");

        if (isNewContact && !isRequestedLid) {
            runDetachedTask(`new_conversation_google_autosync:${contact.id}`, async () => {
                await runGoogleAutoSyncForContact({
                    locationId: location.id,
                    contactId: contact.id,
                    source: 'LEAD_CAPTURE',
                    event: 'create',
                    preferredUserId
                });
            });
            runDetachedTask(`new_conversation_provider_contact_sync:${contact.id}`, async () => {
                await enqueueGhlContactSync({
                    locationId: location.id,
                    contactId: contact.id,
                    payload: { reason: "new_conversation_contact" },
                });
                await enqueueGoogleContactSync({
                    locationId: location.id,
                    contactId: contact.id,
                    userId: preferredUserId,
                    payload: { reason: "new_conversation_contact" },
                });
            });
        }

        // 2. Check if conversation already exists for this contact
        const existingConversationCandidate = await db.conversation.findFirst({
            where: {
                locationId: location.id,
                contactId: contact.id
            }
        });
        const existingConv = matchesNewConversationRecord(existingConversationCandidate, {
            locationId: location.id,
            contactId: contact.id,
        }) ? existingConversationCandidate : null;
        timer.mark("conversation lookup");

        if (existingConv) {
            console.log(`[NewConversation] Existing conversation found: ${existingConv.ghlConversationId}`);

            const historyBackfillQueued = queueWebBridgeHistoryBackfill({
                conversationId: existingConv.id,
                legacyConversationId: existingConv.ghlConversationId,
                contactId: contact.id,
                contactPhone: contact.phone,
                contactName: contact.name,
            });

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
            timer.mark("lead-text seeding");
            timer.total();

            return {
                success: true,
                conversationId: existingConv.id,
                legacyConversationId: existingConv.ghlConversationId,
                isNew: false,
                contactId: contact.id,
                contactName: contact.name,
                contactPhone: contact.phone,
                contactEmail: contact.email,
                locationId: location.id,
                messageType: existingConv.lastMessageType || preferredChannelType,
                lastMessageBody: existingConv.lastMessageBody || null,
                lastMessageDate: existingConv.lastMessageAt ? existingConv.lastMessageAt.getTime() : existingConv.createdAt.getTime(),
                historyBackfillQueued,
                messagesImported: 0,
                backgroundJobsQueued
            };
        }

        // 3. Create new conversation
        const conversation = await db.conversation.create({
            data: {
                ghlConversationId: null,
                locationId: location.id,
                contactId: contact.id,
                lastMessageBody: null,
                lastMessageAt: new Date(0), // Epoch — will sort to bottom until a real message arrives
                lastMessageType: preferredChannelType,
                unreadCount: 0,
                status: 'open'
            }
        });

        console.log(`[NewConversation] Created Estio conversation: ${conversation.id}`);
        timer.mark("conversation create");
        runDetachedTask(`new_conversation_provider_mirror:${conversation.id}`, async () => {
            await enqueueGhlConversationMirror({
                locationId: location.id,
                conversationId: conversation.id,
                contactId: contact.id,
                payload: { source: "new_conversation" },
            });
        });

        // 4. Backfill history from the selected linked-device transport without blocking open.
        const historyBackfillQueued = queueWebBridgeHistoryBackfill({
            conversationId: conversation.id,
            legacyConversationId: conversation.ghlConversationId,
            contactId: contact.id,
            contactPhone: contact.phone,
            contactName: contact.name,
        });

        const seedResult = await seedConversationFromContactLeadText({
            conversationId: conversation.id,
            contact,
            messageType: conversation.lastMessageType || preferredChannelType,
            messageDate: conversation.createdAt,
            source: "contact_bootstrap"
        });
        if (seedResult.seeded) {
            console.log(`[NewConversation] Seeded new conversation ${conversation.id} from contact.message`);
        }
        timer.mark("lead-text seeding");
        timer.total();

        return {
            success: true,
            conversationId: conversation.id,
            legacyConversationId: conversation.ghlConversationId || null,
            isNew: true,
            contactId: contact.id,
            contactName: contact.name,
            contactPhone: contact.phone,
            contactEmail: contact.email,
            locationId: location.id,
            messageType: conversation.lastMessageType || preferredChannelType,
            lastMessageBody: conversation.lastMessageBody || null,
            lastMessageDate: conversation.lastMessageAt ? conversation.lastMessageAt.getTime() : conversation.createdAt.getTime(),
            historyBackfillQueued,
            messagesImported: 0,
            backgroundJobsQueued
        };
    } catch (e: any) {
        timer.total();
        console.error("[NewConversation] Failed:", e);
        return { success: false, error: e.message };
    }
}

// ------------------------------------------------------------------
// Paste Lead Feature Actions
// ------------------------------------------------------------------

const REQUIREMENT_DISTRICTS = ["Paphos", "Nicosia", "Famagusta", "Limassol", "Larnaca"] as const;

function mergeUniqueText(existing?: string | null, incoming?: string | null): string | undefined {
    const next = incoming?.trim();
    if (!next) return existing || undefined;
    const prev = existing?.trim();
    if (!prev) return next;
    if (prev.toLowerCase().includes(next.toLowerCase())) return prev;
    return `${prev}\n${next}`;
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

function mergeConversationSuggestedActions(existing: string[] | null | undefined, incoming: string | null) {
    const normalizedIncoming = String(incoming || "").trim();
    const current = Array.isArray(existing) ? existing.filter((item) => String(item || "").trim()) : [];
    if (!normalizedIncoming) return current;
    if (current.some((item) => item.trim().toLowerCase() === normalizedIncoming.toLowerCase())) {
        return current;
    }
    return [normalizedIncoming, ...current].slice(0, 3);
}

const PASTE_LEAD_FIRST_OUTREACH_SUGGESTION = [
    "Draft a first outreach message for this pasted lead.",
    "Use the lead note and conversation timeline as context.",
    "If the note references one or more properties, acknowledge the enquiry and reference the relevant property URL from the note if present.",
    "If the note describes search criteria rather than a specific property, acknowledge what they are looking for and say I will send them suitable options from our currently available inventory.",
    "Ask whether they need more details or would like to arrange a viewing only when that fits the lead context, say I am here to help with any questions, and do not mention import/internal notes.",
].join(" ");

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

function mapToMinPriceOption(value?: number): string | null {
    return mapToRequirementPriceOption(value);
}

function mapToMaxPriceOption(value?: number): string | null {
    return mapToRequirementPriceOption(value);
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
        role: z.enum(["Lead", "Owner", "Agent", "Tenant", "Company"]).nullable().optional(),
        phone: z.string().nullable().optional(),
        countryCode: z.string().nullable().optional(),
        email: z.string().nullable().optional(),
    }),
    company: z.object({
        name: z.string().nullable().optional(),
        email: z.string().nullable().optional(),
        phone: z.string().nullable().optional(),
        website: z.string().nullable().optional(),
        type: z.string().nullable().optional(),
    }).nullable().optional().describe("Business/agency/developer details when the pasted text identifies an organization separate from the person."),
    requirements: z.object({
        budget: z.string().nullable().optional(),
        location: z.string().nullable().optional(),
        type: z.string().nullable().optional(),
        bedrooms: z.string().nullable().optional(),
    }),
    goal: z.enum(["To Buy", "To Rent", "To List", "To Sell"]).nullable().optional().describe("The lead's goal: To Buy, To Rent, To List (owner listing a property), or To Sell. Infer from text context — price level, property type, and language used. A €150K property is a sale, not a rental. When ambiguous, prefer To Buy for high-value properties."),
    messageContent: z.string().nullable().optional().describe("The actual message text written by the lead. Null if only metadata/notes/summary."),
    internalNotes: z.string().nullable().optional().describe("CRM activity note summarizing ALL useful context from the pasted text: property details, goal, source, price, area, bedrooms, plot size, reference numbers, URLs, next action, etc. This note appears on the conversation timeline. Always include property details even when a direct message exists."),
    source: z.string().nullable().optional().describe("Inferred source e.g. Bazaraki, Facebook, WhatsApp"),
    structuredContactName: z.string().nullable().optional().describe("The strictly formatted CRM display name for this contact"),
});

export type ParsedLeadData = z.infer<typeof LeadParsingSchema>;

interface LeadAnalysisTrace {
    traceId: string; // Temporary ID for client side reference if needed
    start: number;
    end: number;
    model: string;
    provider?: string;
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
        provider?: string;
        note?: string;
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

export type PasteLeadPropertyImportStatus =
    | "linked_existing"
    | "queued_import"
    | "skipped_missing_config"
    | "queue_unavailable";

export type PasteLeadPropertyImportResult = {
    reference: string;
    status: PasteLeadPropertyImportStatus;
    propertyId?: string | null;
    jobId?: string | null;
    error?: string | null;
};

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
                    tool: getTextProviderToolName(trace.provider),
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

    await securelyRecordAiUsage({
        locationId,
        resourceType: "conversation",
        resourceId: conversationId,
        featureArea: "conversational_ai",
        action: "lead_parse",
        provider: trace.provider,
        model: trace.model,
        inputTokens: trace.promptTokens,
        outputTokens: trace.completionTokens,
        metadata: {
            traceId: trace.traceId,
            source: "paste_lead",
            costEstimate: estimatedCost,
            costAuthority: trace.provider === "chatgpt_subscription" ? "subscription_zero_cost" : "estimated",
        },
    });
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

        const modelId = typeof modelOverride === "string" && modelOverride.trim()
            ? modelOverride.trim()
            : GEMINI_DRAFT_FAST_DEFAULT;
        const startedAt = Date.now();
        const prompt = buildImproveNotePrompt({
            noteType,
            text,
            contactFirstName: contactFirstName || undefined,
            context,
        });

        const { text: rawOutput, usage, provider } = await callLLMWithMetadata(
            modelId,
            prompt,
            undefined,
            {
                temperature: 0.1,
                maxOutputTokens: NOTE_IMPROVEMENT_MAX_OUTPUT_TOKENS[noteType],
                thinkingBudget: 0,
                locationId: location.id,
            }
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
                    provider,
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
            "- Include key entities (person/property/reference/price/date/specific requirements) only if present in the source text.",
            "- Accurately capture specific property preferences or criteria mentioned by the lead (e.g., plot type, potential, condition, location nuances).",
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

        const { text: rawSummary, usage, provider } = await callLLMWithMetadata(modelId, summaryPrompt, undefined, {
            temperature: 0.2,
            locationId: location.id,
        });
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
                provider,
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

        const { text: rawOutput, usage, provider } = await callLLMWithMetadata(
            modelId,
            prompt,
            undefined,
            { jsonMode: true, temperature: 0.2, locationId: location.id }
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
                provider,
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
        const location = await getAuthenticatedLocation();
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

        const { text: rawOutput, usage, provider } = await callLLMWithMetadata(modelId, systemPrompt, undefined, {
            temperature: 0.25,
            locationId: location.id,
        });
        const latencyMs = Date.now() - startedAt;
        const output = normalizeSingleLine(rawOutput, "No output generated.").slice(0, MAX_CUSTOM_OUTPUT_LENGTH);

        try {
            const conversation = await resolveConversationForCrmLog(location.id, sanitizedConversationId);
            if (conversation) {
                await persistSelectionAiExecution({
                    conversationInternalId: conversation.id,
                    taskTitle: "Selection Custom Prompt",
                    intent: "selection_custom",
                    modelId,
                    provider,
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
    pasteLeadTraceId?: string;
    initialStatuses?: PasteLeadImportStatus[];
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
    const location = await (locationOverride || getAuthenticatedLocationReadOnly({ requireGhlToken: false }));
    const normalizedInput = normalizeLeadParseInput(text);
    if (!normalizedInput || normalizedInput.length < 5) {
        return { success: false, error: "Text is too short" };
    }

    try {
        const prompt = [
            "You are an expert real estate lead parser for a Cyprus property agency.",
            "Extract structured lead data from the input text.",
            "Return a JSON object only (no markdown, no prose).",
            "",
            "## Goal Classification (CRITICAL)",
            "You MUST classify the lead's goal as exactly one of: 'To Buy', 'To Rent', 'To List', or 'To Sell'.",
            "Use the TEXT CONTENT to determine the goal, not URLs — agents sometimes copy wrong URLs when duplicating properties in the CRM.",
            "Key signals for goal classification:",
            "- Price above €10,000 strongly indicates 'To Buy' (purchase), NOT 'To Rent'",
            "- Phrases like 'for sale', 'to buy', 'purchase', 'asking price' → 'To Buy'",
            "- Phrases like 'for rent', 'to rent', 'per month', '/month', 'monthly rent', 'unfurnished' → 'To Rent'",
            "- If the lead is an owner wanting to list their property for sale → 'To Sell'",
            "- If the lead is an owner wanting to list their property for rent → 'To List'",
            "- When the goal field in the original text explicitly says 'To Buy' or 'To Rent', trust it",
            "- When ambiguous on a high-value property (>€10K), default to 'To Buy'",
            "Set goal to null ONLY if there is truly no signal at all.",
            "",
            "## Contact Extraction",
            "Extract the person's real first name and last name when available.",
            "Format the names with proper Title Case (e.g., 'John Smith' not 'john smith' or 'JOHN SMITH'), correcting any lazy or ALL CAPS formatting from the input.",
            "For contact.name, return only the person's plain real name when available, correctly capitalized.",
            "Do not return a structured CRM display name in the name fields.",
            "Set contact.role to exactly one of Lead, Owner, Agent, Tenant, or Company when inferable; otherwise default to Lead.",
            "Use Tenant when the pasted text explicitly identifies this person as a tenant/occupant, e.g. 'tenant name', 'tenant's name', or 'occupant name'.",
            "Use Company when the pasted text is a generic agency/company contact card and does not identify a real individual person.",
            "",
            "## Company Extraction",
            "If the pasted text identifies a business/agency/developer/management company, extract it into `company` instead of mixing the company into contact.name.",
            "The person stays in `contact`; the organization stays in `company`.",
            "For agency contact cards, examples:",
            "- contact.name: 'Christina'",
            "- contact.role: 'Agent'",
            "- company.name: 'Chrissaf Real Estate Agency'",
            "- company.website: 'https://www.chrissaf.com'",
            "Use company.type such as 'Agency', 'Developer', 'Management', or null when unclear.",
            "For generic company contact cards with no person name, use contact.name like '[Company Name] Main Office', contact.role 'Company', and company.name as the organization name.",
            "If there is no clear organization separate from the person, set company to null.",
            "",
            "## Message vs Notes Separation",
            "Separate direct lead message content from operator/internal notes.",
            "If the pasted text is mainly CRM metadata, property portal data, listing details, lead overview fields, or agent instructions, do not treat it as a direct customer message.",
            "When there is no clear customer-written message, set messageContent to null.",
            "",
            "## Internal Notes (IMPORTANT — always populate when there is useful context)",
            "internalNotes is a CRM activity note that appears on the conversation timeline for the agent.",
            "ALWAYS populate internalNotes with property details, even when a direct message also exists.",
            "internalNotes must preserve ALL useful lead context: goal, source, next action, property reference numbers (e.g. DT1234), property type, area/city, price, covered area, plot size, bedrooms, and URLs.",
            "When the input includes a 'Linked URLs:' section, preserve those URLs in internalNotes.",
            "If multiple properties are mentioned, keep ALL property references in internalNotes.",
            "Write internalNotes as a concise CRM-style note with the most important facts an agent should see.",
            "Example: 'Goal: To Buy. Interested in Ref. No. DT3144: 1-bed Town House in Paphos. Price: €150,000. Source: Bazaraki.'",
            "The goal stated in internalNotes MUST match the goal field exactly.",
            "",
            "## Phone Number",
            "If the phone number lacks a country code, predict the most likely ISO 3166-1 alpha-2 country code (e.g., CY, IL, DE) based on the lead's location, language, or context in the text. If it cannot be reasonably predicted, set countryCode to null.",
            "",
            "## Contact Name Generation (CRITICAL FORMATTING)",
            "You must generate a `structuredContactName` using EXACTLY this formula:",
            "[Person Name] [Role] [Goal] [Property Ref] [Bedrooms]Bdr [Property Type] [Location]",
            "",
            "Rules for name generation:",
            "1. Role: Must be exactly \"Lead\", \"Owner\", \"Agent\", \"Tenant\", or \"Company\".",
            "2. Goal: Must be exactly \"Sale\" or \"Rent\" (Do not use \"To Buy\" or \"To Rent\" here). For Tenant, this is the referenced property's sale/rent context, not the tenant's buying intent.",
            "3. Multiple Properties: If the lead inquires about multiple properties (e.g. multiple Ref numbers), OMIT the property specifications (Bedrooms, Type, Location). Instead, the name MUST be: [Person Name] [Role] [Goal] [Ref1], [Ref2], etc. (Example: \"Vladimir Simic Lead Sale DT4670, REF123\").",
            "4. Bedrooms: If 0 bedrooms (e.g., Studio, Land), OMIT the bedroom count entirely. Otherwise, append \"Bdr\" without a space (e.g., \"3Bdr\").",
            "5. Property Type Abbreviations:",
            "   - Apartment -> Apt",
            "   - Penthouse -> PH",
            "   - Detached Villa -> Villa",
            "   - Studio -> Studio",
            "6. Single Property Example: \"Vladimir Simic Lead Sale DT4670 Studio Paphos\"",
            "7. Single Property Example 2: \"Rafaela Hadid Owner Rent REF123 3Bdr Apt Limassol\"",
            "8. If a field is missing from the input, just skip it and preserve the single spaces between the remaining items.",
            "9. For agency/company contact cards without a property enquiry, do not append the company name into the person name. Keep the company in `company.name` and use the person's real name for `contact.name`/`structuredContactName`.",
            "",
            "JSON schema:",
            "{",
            '  "contact": { "name": string|null, "firstName": string|null, "lastName": string|null, "role": "Lead"|"Owner"|"Agent"|"Tenant"|"Company"|null, "phone": string|null, "countryCode": string|null, "email": string|null },',
            '  "company": { "name": string|null, "email": string|null, "phone": string|null, "website": string|null, "type": string|null }|null,',
            '  "requirements": { "budget": string|null, "location": string|null, "type": string|null, "bedrooms": string|null },',
            '  "goal": "To Buy"|"To Rent"|"To List"|"To Sell"|null,',
            '  "messageContent": string|null,',
            '  "internalNotes": string|null,',
            '  "source": string|null,',
            '  "structuredContactName": string|null',
            "}",
            "",
            "Input text:",
            '"""',
            normalizedInput,
            '"""',
        ].join("\n");

        const initialModelId = resolveLeadParserModelId(modelOverride);
        const modelsToTry = [
            initialModelId,
            GEMINI_FLASH_STABLE_FALLBACK,
            "gemini-2.5-pro"
        ];

        let finalModelId = initialModelId;
        let finalProvider = "google_gemini";
        let finalJsonStr = "";
        let finalUsage: any = null;
        let finalParsed: any = null;
        let finalResult: z.infer<typeof LeadParsingSchema> | null = null;
        let lastError: Error | null = null;
        
        let start = Date.now();
        let end = Date.now();

        for (let i = 0; i < modelsToTry.length; i++) {
            const currentModelId = modelsToTry[i] || GEMINI_FLASH_STABLE_FALLBACK;
            finalModelId = currentModelId;
            
            try {
                start = Date.now();
                const { text: jsonStr, usage, provider } = await callLLMWithMetadata(currentModelId, prompt, undefined, {
                    jsonMode: true,
                    temperature: 0,
                    maxOutputTokens: LEAD_PARSE_MAX_OUTPUT_TOKENS,
                    thinkingBudget: LEAD_PARSE_THINKING_BUDGET,
                    locationId: location.id,
                });
                end = Date.now();

                finalJsonStr = jsonStr;
                finalUsage = usage;
                finalProvider = provider;

                finalParsed = parseJsonObjectFromModelOutput(jsonStr);
                finalResult = LeadParsingSchema.parse(finalParsed);

                // If successful, break
                break;
            } catch (error: any) {
                lastError = error;
                console.warn(`[Lead Parser] Attempt ${i + 1} failed with model ${currentModelId}:`, error?.message || error);
                
                if (i < modelsToTry.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1))); // Incremental backoff
                }
            }
        }

        if (!finalResult || !finalUsage) {
            throw lastError || new Error("Lead parsing failed after multiple attempts.");
        }

        const costEstimate = isUnpricedTextProvider(finalProvider)
            ? buildUnavailableProviderCostEstimate(finalProvider, finalUsage)
            : calculateRunCostFromUsage(finalModelId, {
                promptTokens: finalUsage.promptTokens,
                completionTokens: finalUsage.completionTokens,
                totalTokens: finalUsage.totalTokens,
                thoughtsTokens: finalUsage.thoughtsTokens,
                toolUsePromptTokens: finalUsage.toolUsePromptTokens
            });

        const cleanJson = finalJsonStr.replace(/```json/gi, "").replace(/```/g, "").trim();
        const parsed = finalParsed;
        const result = finalResult;
        const jsonStr = finalJsonStr;
        const usage = finalUsage;
        const modelId = finalModelId;
        const traceId = `trace_${Date.now()}`;
        const trace: LeadAnalysisTrace = {
            traceId,
            start,
            end,
            model: modelId,
            provider: finalProvider,
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
                provider: costEstimate.provider,
                note: costEstimate.note,
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
    location: { whatsappProviderMode?: string | null },
    data: ParsedLeadData
): 'TYPE_WHATSAPP' | 'TYPE_SMS' | 'TYPE_EMAIL' {
    const phoneDigits = String(data.contact?.phone || '').replace(/\D/g, '');
    if (phoneDigits.length < 7 && data.contact?.email) {
        return 'TYPE_EMAIL';
    }
    if (phoneDigits.length >= 7 && String(location?.whatsappProviderMode || "web_bridge") === "web_bridge") {
        return 'TYPE_WHATSAPP';
    }
    return phoneDigits.length >= 7 ? 'TYPE_WHATSAPP' : 'TYPE_SMS';
}

async function applyMatchedPropertyToContact(args: {
    contactId: string;
    matchedProperty: NonNullable<ResolvedLeadPropertyMatch>;
    inferredStatus: "For Rent" | "For Sale" | null;
}) {
    await applyPropertyInterestToContact({
        contactId: args.contactId,
        property: args.matchedProperty,
        inferredStatus: args.inferredStatus,
    });
}

export async function parseLeadFromText(
    text: string,
    modelOverride?: string,
    options?: { pasteLeadTraceId?: string }
) {
    const pasteLeadTraceId = options?.pasteLeadTraceId || `paste_lead_${randomUUID()}`;
    const statuses: PasteLeadImportStatus[] = [];
    const emitStatus = createPasteLeadStatusRecorder({
        pasteLeadTraceId,
        statuses,
        logPrefix: "[PasteLeadStatus]",
    });
    const totalStartedAt = Date.now();
    emitStatus("lead_parse_started", "running");

    let parsed: LeadParseWithTraceResult;
    try {
        parsed = await parseLeadFromTextInternal(text, modelOverride);
    } catch (error: any) {
        const totalLatencyMs = Date.now() - totalStartedAt;
        const message = error?.message || "Auth/location failed.";
        emitStatus("auth_location_failed", "failed", message, totalLatencyMs);
        return {
            success: false as const,
            error: message,
            pasteLeadTraceId,
            totalLatencyMs,
            statuses,
        };
    }
    if (!parsed.success) {
        const totalLatencyMs = Date.now() - totalStartedAt;
        emitStatus("lead_parse_failed", "failed", parsed.error, totalLatencyMs);
        return {
            ...parsed,
            pasteLeadTraceId,
            totalLatencyMs,
            statuses,
        };
    }
    emitStatus("lead_parse_completed", "completed", parsed.telemetry.model, parsed.telemetry.latencyMs);
    return {
        success: true as const,
        data: parsed.data,
        telemetry: parsed.telemetry,
        trace: parsed.trace,
        pasteLeadTraceId,
        parseLatencyMs: parsed.telemetry.latencyMs,
        totalLatencyMs: Date.now() - totalStartedAt,
        statuses,
    };
}

export async function getPasteLeadImportCapability() {
    try {
        const location = await getAuthenticatedLocationReadOnly({ requireGhlToken: false });
        const { userId: clerkUserId } = await auth();
        const currentUser = clerkUserId
            ? await db.user.findUnique({ where: { clerkId: clerkUserId }, select: { id: true } })
            : null;

        if (!currentUser?.id) {
            return { success: false as const, error: "Unauthorized" };
        }

        const capability = await getOldCrmImportCapabilityForUser({
            locationId: location.id,
            userId: currentUser.id,
        });

        return {
            success: true as const,
            capability,
        };
    } catch (error: any) {
        return {
            success: false as const,
            error: error?.message || "Failed to resolve Paste Lead import capability.",
        };
    }
}

export async function importLeadFromText(
    text: string,
    modelOverride?: string,
    options?: { pasteLeadTraceId?: string }
) {
    const pasteLeadTraceId = options?.pasteLeadTraceId || `paste_lead_${randomUUID()}`;
    const statuses: PasteLeadImportStatus[] = [];
    const emitStatus = createPasteLeadStatusRecorder({
        pasteLeadTraceId,
        statuses,
        logPrefix: "[PasteLeadStatus]",
    });

    const totalStartedAt = Date.now();
    emitStatus("paste_lead_import_started", "running");
    emitStatus("lead_parse_started", "running");
    let location;
    try {
        location = await getAuthenticatedLocationReadOnly({ requireGhlToken: false });
    } catch (error: any) {
        const totalLatencyMs = Date.now() - totalStartedAt;
        const message = error?.message || "Auth/location failed.";
        emitStatus("auth_location_failed", "failed", message, totalLatencyMs);
        emitStatus("paste_lead_import_failed", "failed", message, totalLatencyMs);
        return {
            success: false as const,
            error: message,
            pasteLeadTraceId,
            totalLatencyMs,
            backgroundJobsQueued: [],
            backgroundJobsSkipped: [],
            statuses,
        };
    }
    const parsed = await parseLeadFromTextInternal(text, modelOverride, location);
    if (!parsed.success) {
        const totalLatencyMs = Date.now() - totalStartedAt;
        emitStatus("lead_parse_failed", "failed", parsed.error, totalLatencyMs);
        emitStatus("paste_lead_import_failed", "failed", parsed.error, totalLatencyMs);
        return {
            ...parsed,
            pasteLeadTraceId,
            totalLatencyMs,
            backgroundJobsQueued: [],
            backgroundJobsSkipped: [],
            statuses,
        };
    }
    emitStatus("lead_parse_completed", "completed", parsed.telemetry.model, parsed.telemetry.latencyMs);

    const importStartedAt = Date.now();
    const imported = await createParsedLead(parsed.data, parsed.normalizedInput, {
        locationOverride: location,
        parseTrace: parsed.trace,
        pasteLeadTraceId,
        initialStatuses: statuses,
    });
    const totalLatencyMs = Date.now() - totalStartedAt;

    if (!imported.success) {
        return {
            ...imported,
            pasteLeadTraceId,
            parseTelemetry: parsed.telemetry,
            parseLatencyMs: parsed.telemetry.latencyMs,
            importLatencyMs: Date.now() - importStartedAt,
            totalLatencyMs,
            statuses: imported.statuses || statuses,
        };
    }

    const importLatencyMs = Date.now() - importStartedAt;
    console.log("[PasteLeadFastPath] Parse+import completed", JSON.stringify({
        pasteLeadTraceId,
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
        pasteLeadTraceId,
        parseTelemetry: parsed.telemetry,
        parseLatencyMs: parsed.telemetry.latencyMs,
        importLatencyMs,
        totalLatencyMs,
        statuses: imported.statuses || statuses,
    };
}

export async function createParsedLead(
    data: ParsedLeadData,
    originalText: string,
    options?: CreateParsedLeadOptions
) {
    const pasteLeadTraceId = options?.pasteLeadTraceId || `paste_lead_${randomUUID()}`;
    const initialStatuses = options?.initialStatuses || [
        createPasteLeadStatus("paste_lead_import_started", "running", { pasteLeadTraceId }),
        createPasteLeadStatus("lead_parse_completed", "completed", {
            pasteLeadTraceId,
            detail: "preview cache",
        }),
    ];
    const location = options?.locationOverride || await getAuthenticatedLocationReadOnly({ requireGhlToken: false });

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

    return createParsedLeadForLocation(data, originalText, {
        location,
        preferredUserId,
        parseTrace: options?.parseTrace,
        pasteLeadTraceId,
        initialStatuses,
        orchestrateImportedLead: async (conversationId, contactId) => {
            await orchestrateAction(conversationId, contactId);
        },
    });
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

export async function processLegacyCrmLeadEmailForLocation(args: {
    locationId: string;
    messageId: string;
    force?: boolean;
    runAutoDraftFromSettings?: boolean;
    triggerSource?: string;
}) {
    return processLegacyCrmLeadEmailForLocationService(args);
}
type ConversationSearchMode = "auto" | "contact" | "broad";

async function searchConversationContactPhonesFast(args: {
    locationId: string;
    queryDigits: string;
    limit: number;
    status?: Extract<ConversationListStatus, "active" | "archived" | "trash">;
}): Promise<Array<{ conversationId: string; score: number }>> {
    const queryDigits = args.queryDigits;
    if (queryDigits.length < 4) return [];

    const queryDigitsShort = queryDigits.length >= 7 ? queryDigits.slice(-10) : queryDigits;
    const queryDigitsLast7 = queryDigits.length >= 7 ? queryDigits.slice(-7) : "";
    const phoneE164Query = `+${queryDigits}`;
    const phoneContainsQuery = `%${queryDigitsShort}%`;
    const phoneLast7Query = queryDigitsLast7 ? `%${queryDigitsLast7}%` : "";
    const statusSql =
        args.status === "active"
            ? Prisma.sql`c."deletedAt" IS NULL AND c."archivedAt" IS NULL`
            : args.status === "archived"
                ? Prisma.sql`c."deletedAt" IS NULL AND c."archivedAt" IS NOT NULL`
                : args.status === "trash"
                    ? Prisma.sql`c."deletedAt" IS NOT NULL`
                    : Prisma.sql`c."deletedAt" IS NULL`;

    return db.$queryRaw<Array<{ conversationId: string; score: number }>>`
        SELECT
            c.id AS "conversationId",
            GREATEST(
                CASE WHEN regexp_replace(COALESCE(ct.phone, ''), '\\D', '', 'g') = ${queryDigits} THEN 120.0 ELSE 0.0 END,
                CASE WHEN ct.phone = ${phoneE164Query} OR ct.phone = ${queryDigits} THEN 118.0 ELSE 0.0 END,
                CASE WHEN ${queryDigits.length >= 10} AND regexp_replace(COALESCE(ct.phone, ''), '\\D', '', 'g') = ${queryDigitsShort} THEN 112.0 ELSE 0.0 END,
                CASE WHEN ${queryDigits.length >= 7} AND COALESCE(ct.phone, '') ILIKE ${phoneContainsQuery} THEN 95.0 ELSE 0.0 END,
                CASE WHEN ${queryDigitsLast7.length > 0} AND COALESCE(ct.phone, '') ILIKE ${phoneLast7Query} THEN 85.0 ELSE 0.0 END
            ) AS score
        FROM "Contact" ct
        JOIN "Conversation" c ON c."contactId" = ct.id
        WHERE ct."locationId" = ${args.locationId}
          AND c."locationId" = ${args.locationId}
          AND ${statusSql}
          AND ct.phone IS NOT NULL
          AND (
            regexp_replace(COALESCE(ct.phone, ''), '\\D', '', 'g') = ${queryDigits}
            OR ct.phone = ${phoneE164Query}
            OR ct.phone = ${queryDigits}
            OR (${queryDigits.length >= 10} AND regexp_replace(COALESCE(ct.phone, ''), '\\D', '', 'g') = ${queryDigitsShort})
            OR (${queryDigits.length >= 7} AND COALESCE(ct.phone, '') ILIKE ${phoneContainsQuery})
            OR (${queryDigitsLast7.length > 0} AND COALESCE(ct.phone, '') ILIKE ${phoneLast7Query})
          )
        ORDER BY score DESC, c."lastMessageAt" DESC, c.id DESC
        LIMIT ${args.limit};
    `;
}

export async function searchConversations(query: string, options?: {
    limit?: number;
    status?: Extract<ConversationListStatus, "active" | "archived" | "trash">;
    mode?: ConversationSearchMode;
}) {
    try {
        const location = await getAuthenticatedLocationReadOnly();
        const traceId = createTraceId();
        const MAX_SEARCH_LIMIT = 50;
        const limit = Math.min(Math.max(Number(options?.limit || 20), 1), MAX_SEARCH_LIMIT);
        const requestedMode: ConversationSearchMode = options?.mode === "broad" || options?.mode === "contact" ? options.mode : "auto";
        const status = options?.status;
        const statusLabel = status || "not_trash";

        const searchAnalysis = analyzeConversationSearchQuery(query);
        const q = searchAnalysis.normalizedQuery;
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
        const likePrefixQuery = `${q}%`;
        const queryDigits = searchAnalysis.queryDigits;
        const digitsLikeQuery = queryDigits ? `%${queryDigits}%` : "";
        const digitsSuffixQuery = queryDigits ? `%${queryDigits}` : "";
        const phoneLikeQuery = searchAnalysis.phoneLikeQuery;
        const structuredReferenceQuery = searchAnalysis.structuredReferenceQuery;
        const phoneE164Query = queryDigits ? `+${queryDigits}` : "";
        const phoneLast3Query = queryDigits.length >= 3 ? `%${queryDigits.slice(-3)}%` : "";
        const phoneLast6Query = queryDigits.length >= 6 ? `%${queryDigits.slice(-6)}%` : "";
        const searchStartedAt = Date.now();
        let contactHeaderDurationMs = 0;
        let broadDurationMs: number | null = null;
        let broadUsed = false;
        let fastPhoneUsed = false;
        let rankedRows: Array<{ conversationId: string; score: number }> = [];

        const statusSql =
            status === "active"
                ? Prisma.sql`c."deletedAt" IS NULL AND c."archivedAt" IS NULL`
                : status === "archived"
                    ? Prisma.sql`c."deletedAt" IS NULL AND c."archivedAt" IS NOT NULL`
                    : status === "trash"
                        ? Prisma.sql`c."deletedAt" IS NOT NULL`
                        : Prisma.sql`c."deletedAt" IS NULL`;

        const fallbackWhere: any = {
            locationId: location.id,
            ...(status === "active"
                ? { deletedAt: null, archivedAt: null }
                : status === "archived"
                    ? { deletedAt: null, archivedAt: { not: null } }
                    : status === "trash"
                        ? { deletedAt: { not: null } }
                        : { deletedAt: null }),
        };

        try {
            const contactStartedAt = Date.now();
            if (phoneLikeQuery) {
                rankedRows = await withServerTiming("conversations.search.phone_fast", {
                    traceId,
                    locationId: location.id,
                    limit,
                    queryLength: q.length,
                    queryDigitsLength: queryDigits.length,
                    status: statusLabel,
                    mode: requestedMode,
                }, async () => searchConversationContactPhonesFast({
                    locationId: location.id,
                    queryDigits,
                    limit,
                    status,
                }));
                fastPhoneUsed = rankedRows.length > 0;
            }

            rankedRows = rankedRows.length > 0
                ? rankedRows
                : phoneLikeQuery
                ? await withServerTiming("conversations.search.phone", {
                    traceId,
                    locationId: location.id,
                    limit,
                    queryLength: q.length,
                    queryDigitsLength: queryDigits.length,
                    status: statusLabel,
                    mode: requestedMode,
                }, async () => db.$queryRaw<Array<{ conversationId: string; score: number }>>`
                    WITH phone_hits AS (
                        SELECT
                            c.id AS "conversationId",
                            CASE
                                WHEN REGEXP_REPLACE(COALESCE(ct.phone, ''), '\\D', '', 'g') = ${queryDigits} THEN 5.0
                                WHEN ct.phone = ${phoneE164Query} OR ct.phone = ${queryDigits} THEN 4.8
                                WHEN REGEXP_REPLACE(COALESCE(ct.phone, ''), '\\D', '', 'g') LIKE ${digitsSuffixQuery} THEN 3.8
                                ELSE 2.8
                            END AS score
                        FROM "Contact" ct
                        JOIN "Conversation" c ON c."contactId" = ct.id
                        WHERE ct."locationId" = ${location.id}
                          AND c."locationId" = ${location.id}
                          AND ${statusSql}
                          AND ct.phone IS NOT NULL
                          AND (
                            REGEXP_REPLACE(COALESCE(ct.phone, ''), '\\D', '', 'g') = ${queryDigits}
                            OR ct.phone = ${phoneE164Query}
                            OR ct.phone = ${queryDigits}
                            OR COALESCE(ct.phone, '') ILIKE ${digitsSuffixQuery}
                            OR (${queryDigits.length >= 6} AND COALESCE(ct.phone, '') ILIKE ${phoneLast6Query})
                            OR (${queryDigits.length >= 10} AND COALESCE(ct.phone, '') ILIKE ${phoneLast3Query}
                              AND REGEXP_REPLACE(COALESCE(ct.phone, ''), '\\D', '', 'g') LIKE ${digitsSuffixQuery})
                          )
                    ),
                    identity_hits AS (
                        SELECT
                            c.id AS "conversationId",
                            4.6 AS score
                        FROM "WhatsAppIdentityMap" wam
                        JOIN "Contact" ct ON ct.id = wam."contactId"
                        JOIN "Conversation" c ON c."contactId" = ct.id
                        WHERE wam."locationId" = ${location.id}
                          AND c."locationId" = ${location.id}
                          AND ${statusSql}
                          AND (
                            wam.phone = ${queryDigits}
                            OR wam.phone = ${phoneE164Query}
                            OR REGEXP_REPLACE(COALESCE(wam.phone, ''), '\\D', '', 'g') = ${queryDigits}
                          )
                    ),
                    participant_hits AS (
                        SELECT
                            c.id AS "conversationId",
                            4.4 AS score
                        FROM "ConversationParticipant" cp
                        JOIN "Conversation" c ON c.id = cp."conversationId"
                        WHERE c."locationId" = ${location.id}
                          AND ${statusSql}
                          AND cp."phoneDigits" = ${queryDigits}
                    ),
                    combined AS (
                        SELECT * FROM phone_hits
                        UNION ALL
                        SELECT * FROM identity_hits
                        UNION ALL
                        SELECT * FROM participant_hits
                    )
                    SELECT
                        "conversationId",
                        MAX(score) AS score
                    FROM combined
                    GROUP BY "conversationId"
                    ORDER BY MAX(score) DESC
                    LIMIT ${limit};
                `)
                : structuredReferenceQuery
                ? await withServerTiming("conversations.search.reference", {
                    traceId,
                    locationId: location.id,
                    limit,
                    queryLength: q.length,
                    queryDigitsLength: queryDigits.length,
                    status: statusLabel,
                    mode: requestedMode,
                }, async () => db.$queryRaw<Array<{ conversationId: string; score: number }>>`
                    SELECT
                        c.id AS "conversationId",
                        GREATEST(
                            CASE WHEN COALESCE(c."lastMessageBody", '') ILIKE ${likePrefixQuery} THEN 4.0 ELSE 0 END,
                            CASE WHEN COALESCE(c."lastMessageBody", '') ILIKE ${likeQuery} THEN 3.5 ELSE 0 END,
                            CASE WHEN COALESCE(ct.name, '') ILIKE ${likePrefixQuery} THEN 3.0 ELSE 0 END,
                            CASE WHEN COALESCE(ct.name, '') ILIKE ${likeQuery} THEN 2.5 ELSE 0 END,
                            CASE WHEN COALESCE(ct."firstName", '') ILIKE ${likePrefixQuery} THEN 2.0 ELSE 0 END,
                            CASE WHEN COALESCE(ct."lastName", '') ILIKE ${likePrefixQuery} THEN 2.0 ELSE 0 END,
                            CASE WHEN COALESCE(ct.email, '') ILIKE ${likePrefixQuery} THEN 1.8 ELSE 0 END,
                            CASE WHEN COALESCE(ct.email, '') ILIKE ${likeQuery} THEN 1.4 ELSE 0 END
                        ) AS score
                    FROM "Conversation" c
                    JOIN "Contact" ct ON ct.id = c."contactId"
                    WHERE c."locationId" = ${location.id}
                      AND ${statusSql}
                      AND (
                        COALESCE(c."lastMessageBody", '') ILIKE ${likeQuery}
                        OR COALESCE(ct.name, '') ILIKE ${likeQuery}
                        OR COALESCE(ct."firstName", '') ILIKE ${likeQuery}
                        OR COALESCE(ct."lastName", '') ILIKE ${likeQuery}
                        OR COALESCE(ct.email, '') ILIKE ${likeQuery}
                      )
                    ORDER BY score DESC, c."lastMessageAt" DESC, c.id DESC
                    LIMIT ${limit};
                `)
                : await withServerTiming("conversations.search.contact_header", {
                traceId,
                locationId: location.id,
                limit,
                queryLength: q.length,
                queryDigitsLength: queryDigits.length,
                status: statusLabel,
                mode: requestedMode,
            }, async () => db.$queryRaw<Array<{ conversationId: string; score: number }>>`
            WITH search_term AS (
                SELECT ${q}::text AS q, plainto_tsquery('simple', ${q}) AS tsq
            ),
            contact_hits AS (
                SELECT
                    c.id AS "conversationId",
                    GREATEST(
                        CASE
                            WHEN ${phoneLikeQuery}
                              AND REGEXP_REPLACE(COALESCE(ct.phone, ''), '\\D', '', 'g') = ${queryDigits}
                            THEN 4.0
                            WHEN ${phoneLikeQuery}
                              AND REGEXP_REPLACE(COALESCE(ct.phone, ''), '\\D', '', 'g') LIKE ${digitsSuffixQuery}
                            THEN 3.5
                            WHEN ${phoneLikeQuery}
                              AND REGEXP_REPLACE(COALESCE(ct.phone, ''), '\\D', '', 'g') LIKE ${digitsLikeQuery}
                            THEN 2.5
                            ELSE 0
                        END,
                        CASE WHEN COALESCE(ct.name, '') ILIKE ${likePrefixQuery} THEN 2.2 ELSE 0 END,
                        CASE WHEN COALESCE(ct."firstName", '') ILIKE ${likePrefixQuery} THEN 2.0 ELSE 0 END,
                        CASE WHEN COALESCE(ct."lastName", '') ILIKE ${likePrefixQuery} THEN 1.8 ELSE 0 END,
                        CASE WHEN COALESCE(ct.email, '') ILIKE ${likePrefixQuery} THEN 1.8 ELSE 0 END,
                        similarity(COALESCE(ct.name, ''), st.q),
                        similarity(COALESCE(ct."firstName", ''), st.q),
                        similarity(COALESCE(ct."lastName", ''), st.q),
                        similarity(COALESCE(ct.email, ''), st.q),
                        similarity(COALESCE(ct.phone, ''), st.q)
                    ) + 0.8 * ts_rank_cd(
                        to_tsvector(
                            'simple',
                            COALESCE(ct.name, '') || ' ' ||
                            COALESCE(ct."firstName", '') || ' ' ||
                            COALESCE(ct."lastName", '') || ' ' ||
                            COALESCE(ct.email, '') || ' ' ||
                            COALESCE(ct.phone, '')
                        ),
                        st.tsq
                    ) AS score
                FROM "Conversation" c
                JOIN "Contact" ct ON ct.id = c."contactId"
                CROSS JOIN search_term st
                WHERE c."locationId" = ${location.id}
                  AND ${statusSql}
                  AND (
                    to_tsvector(
                        'simple',
                        COALESCE(ct.name, '') || ' ' ||
                        COALESCE(ct."firstName", '') || ' ' ||
                        COALESCE(ct."lastName", '') || ' ' ||
                        COALESCE(ct.email, '') || ' ' ||
                        COALESCE(ct.phone, '')
                    ) @@ st.tsq
                    OR COALESCE(ct.name, '') ILIKE ${likeQuery}
                    OR COALESCE(ct."firstName", '') ILIKE ${likeQuery}
                    OR COALESCE(ct."lastName", '') ILIKE ${likeQuery}
                    OR COALESCE(ct.email, '') ILIKE ${likeQuery}
                    OR COALESCE(ct.phone, '') ILIKE ${likeQuery}
                    OR (${phoneLikeQuery} AND REGEXP_REPLACE(COALESCE(ct.phone, ''), '\\D', '', 'g') LIKE ${digitsLikeQuery})
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
                  AND ${statusSql}
                  AND (
                    to_tsvector('simple', COALESCE(c."lastMessageBody", '')) @@ st.tsq
                    OR COALESCE(c."lastMessageBody", '') ILIKE ${likeQuery}
                  )
            ),
            combined AS (
                SELECT * FROM contact_hits
                UNION ALL
                SELECT * FROM conversation_hits
            )
            SELECT
                "conversationId",
                MAX(score) AS score
            FROM combined
            GROUP BY "conversationId"
            ORDER BY MAX(score) DESC
            LIMIT ${limit};
        `);
            contactHeaderDurationMs = Date.now() - contactStartedAt;
        } catch (rawSearchError) {
            console.warn("[searchConversations] Falling back to Prisma contact/header search path:", rawSearchError);
            const fallbackRows = await db.conversation.findMany({
                where: {
                    ...fallbackWhere,
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
            contactHeaderDurationMs = Date.now() - searchStartedAt;
        }

        const shouldRunBroadSearch = requestedMode === "broad"
            || (
                requestedMode === "auto"
                && !phoneLikeQuery
                && !structuredReferenceQuery
                && q.length >= 5
                && rankedRows.length < Math.min(limit, 10)
            );

        if (shouldRunBroadSearch && rankedRows.length < limit) {
            broadUsed = true;
            const broadStartedAt = Date.now();
            try {
                const broadRows = await withServerTiming("conversations.search.broad", {
                    traceId,
                    locationId: location.id,
                    limit,
                    queryLength: q.length,
                    status: statusLabel,
                    mode: requestedMode,
                    contactHeaderResultCount: rankedRows.length,
                }, async () => db.$queryRaw<Array<{ conversationId: string; score: number }>>`
                    WITH search_term AS (
                        SELECT ${q}::text AS q, plainto_tsquery('simple', ${q}) AS tsq
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
                          AND ${statusSql}
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
                          AND ${statusSql}
                          AND (
                            to_tsvector('simple', COALESCE(mt.text, '')) @@ st.tsq
                            OR COALESCE(mt.text, '') ILIKE ${likeQuery}
                          )
                        GROUP BY m."conversationId"
                    ),
                    combined AS (
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

                const rankedById = new Map<string, number>();
                for (const row of rankedRows) {
                    rankedById.set(row.conversationId, row.score);
                }
                for (const row of broadRows) {
                    rankedById.set(row.conversationId, Math.max(rankedById.get(row.conversationId) ?? Number.NEGATIVE_INFINITY, row.score));
                }
                rankedRows = Array.from(rankedById.entries())
                    .map(([conversationId, score]) => ({ conversationId, score }))
                    .sort((a, b) => b.score - a.score)
                    .slice(0, limit);
            } catch (broadSearchError) {
                console.warn("[searchConversations] Broad message/transcript search failed; returning contact/header matches:", broadSearchError);
            } finally {
                broadDurationMs = Date.now() - broadStartedAt;
            }
        }

        const rankedConversationIds = rankedRows.map((row) => String(row.conversationId));
        if (rankedConversationIds.length === 0) {
            logPerformanceMetric("conversations.search", {
                traceId,
                locationId: location.id,
                ok: true,
                durationMs: Date.now() - searchStartedAt,
                contactHeaderDurationMs,
                broadDurationMs,
                broadUsed,
                fastPhoneUsed,
                resultCount: 0,
                queryLength: q.length,
                queryDigitsLength: queryDigits.length,
                phoneLikeQuery,
                structuredReferenceQuery,
                status: statusLabel,
                mode: requestedMode,
            });
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

        const conversations = await hydrateRankedConversationRows({
            location,
            rankedConversationIds,
        });

        logPerformanceMetric("conversations.search", {
            traceId,
            locationId: location.id,
            ok: true,
            durationMs: Date.now() - searchStartedAt,
            contactHeaderDurationMs,
            broadDurationMs,
            broadUsed,
            fastPhoneUsed,
            resultCount: conversations.length,
            queryLength: q.length,
            queryDigitsLength: queryDigits.length,
            phoneLikeQuery,
            structuredReferenceQuery,
            status: statusLabel,
            mode: requestedMode,
        });

        return {
            success: true,
            traceId,
            conversations,
            total: conversations.length,
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
            { jsonMode: true, temperature: 0.2, locationId: location.id }
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
            provider: result.provider,
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

export async function fetchConversationActivityLog(
    conversationId: string,
    options?: { limit?: number; beforeCursor?: string | null }
) {
    const location = await getAuthenticatedLocationReadOnly();
    if (!location?.id) return [];

    const limit = Math.min(
        Math.max(Number(options?.limit || DEFAULT_WORKSPACE_ACTIVITY_LIMIT), 1),
        MAX_WORKSPACE_ACTIVITY_LIMIT
    );

    const timeline = await assembleTimelineEvents({
        mode: "chat",
        locationId: location.id,
        conversationId,
        includeMessages: false,
        includeActivities: true,
        take: limit,
        beforeCursor: options?.beforeCursor || null,
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

export async function addConversationActivityEntry(
    conversationId: string,
    entryText: string,
    dateIso: string,
    clientMutationId?: string
) {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) throw new Error("Unauthorized");

    const location = await getAuthenticatedLocationReadOnly();
    const [user, conversation] = await Promise.all([
        db.user.findUnique({
            where: { clerkId: clerkUserId },
            select: { id: true, firstName: true, name: true, email: true }
        }),
        db.conversation.findFirst({
            where: buildConversationReferenceWhere(location.id, conversationId),
            select: { id: true, contactId: true, ghlConversationId: true }
        }),
    ]);

    if (!user) throw new Error("User not found");
    if (!conversation?.contactId) throw new Error("Conversation not found");

    const actorFirstName = deriveFirstName(user.firstName, user.name, user.email);
    const entry = formatCrmLogEntry(actorFirstName, entryText, new Date(dateIso));
    const normalizedClientMutationId = String(clientMutationId || "").trim() || null;

    const createdHistory = await db.contactHistory.create({
        data: {
            contactId: conversation.contactId,
            userId: user.id,
            action: 'MANUAL_ENTRY',
            changes: {
                date: dateIso,
                entry
            }
        },
        select: {
            id: true,
            createdAt: true,
        },
    });

    await processActivityNotePropertyFeedback({
        locationId: location.id,
        contactId: conversation.contactId,
        conversationId: conversation.id,
        historyId: createdHistory.id,
    }).catch((error) => {
        console.error(`[Property Match Feedback] Activity note ${createdHistory.id} failed:`, error);
    });

    runDetachedTask(`requirements_activity_note:${createdHistory.id}`, async () => {
        queueRequirementProposalForNewActivity({
            locationId: location.id,
            contactId: conversation.contactId,
            conversationId: conversation.id,
            sourceType: "activity_note",
            sourceIds: [createdHistory.id],
            actorUserId: user.id,
        });
    });

    revalidatePath(`/admin/contacts/${conversation.contactId}/view`);
    invalidateConversationReadCaches(conversation.id, { skipPath: true });
    const activityEntry = {
        id: `history:${createdHistory.id}`,
        type: 'activity' as const,
        createdAt: createdHistory.createdAt.toISOString(),
        action: 'MANUAL_ENTRY',
        changes: {
            date: dateIso,
            entry,
        },
        user: {
            name: user.name || null,
            email: user.email || null,
        },
        clientMutationId: normalizedClientMutationId,
        pending: false,
    };
    emitConversationRealtimeEvent({
        locationId: location.id,
        conversationId: conversation.id,
        type: "activity.created",
        payload: {
            activityEntry,
            clientMutationId: normalizedClientMutationId,
        },
    });

    return {
        success: true,
        activityEntry,
        clientMutationId: normalizedClientMutationId,
    };
}

async function resolveManualActivityMutationActor() {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) throw new Error("Unauthorized");

    const location = await getAuthenticatedLocationReadOnly({ requireGhlToken: false });
    const user = await db.user.findUnique({
        where: { clerkId: clerkUserId },
        select: { id: true, name: true, email: true },
    });

    if (!user) throw new Error("User not found");
    return { location, user };
}

export async function updateConversationActivityEntry(
    historyId: string,
    entryText: string,
    dateIso: string
) {
    const { location, user } = await resolveManualActivityMutationActor();
    const result = await updateManualActivityEntryRow({
        db,
        historyId,
        locationId: location.id,
        actor: user,
        entry: entryText,
        dateIso,
    });

    await processActivityNotePropertyFeedback({
        locationId: location.id,
        contactId: result.history.contactId,
        conversationId: result.conversationIds[0] || null,
        historyId: result.history.id,
    }).catch((error) => {
        console.error(`[Property Match Feedback] Activity note ${result.history.id} update failed:`, error);
    });

    revalidatePath(`/admin/contacts/${result.history.contactId}/view`);
    for (const conversationId of result.conversationIds) {
        invalidateConversationReadCaches(conversationId, { skipPath: true });
        emitConversationRealtimeEvent({
            locationId: location.id,
            conversationId,
            type: "activity.updated",
            payload: { activityEntry: result.activityEntry },
        });
    }
    runDetachedTask(`requirements_activity_note_edit:${result.history.id}`, async () => {
        queueRequirementProposalForNewActivity({
            locationId: location.id,
            contactId: result.history.contactId,
            conversationId: result.conversationIds[0] || null,
            sourceType: "activity_note",
            sourceIds: [result.history.id],
            actorUserId: user.id,
        });
    });

    return {
        success: true,
        activityEntry: result.activityEntry,
    };
}

export async function deleteConversationActivityEntry(historyId: string, reason?: string) {
    const { location, user } = await resolveManualActivityMutationActor();
    const result = await deleteManualActivityEntryRow({
        db,
        historyId,
        locationId: location.id,
        actor: user,
        reason,
    });

    await clearContactPropertyInteractionsForSource({
        locationId: location.id,
        contactId: result.contactId,
        sourceType: "note",
        sourceId: result.historyId,
    }).catch((error) => {
        console.error(`[Property Match Feedback] Activity note ${result.historyId} deletion cleanup failed:`, error);
    });

    revalidatePath(`/admin/contacts/${result.contactId}/view`);
    for (const conversationId of result.conversationIds) {
        invalidateConversationReadCaches(conversationId, { skipPath: true });
        emitConversationRealtimeEvent({
            locationId: location.id,
            conversationId,
            type: "activity.deleted",
            payload: { activityId: result.activityId },
        });
    }

    return {
        success: true,
        activityId: result.activityId,
    };
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
                conversationLinks: {
                    select: {
                        conversationId: true,
                        legacyConversationRef: true,
                    },
                },
            },
        });

        if (!deal) return [];
        const refs = collectDealConversationReferences(deal);

        const dealConversations = await db.conversation.findMany({
            where: {
                locationId: location.id,
                OR: [
                    { id: { in: refs.linkedConversationIds } },
                    { id: { in: refs.legacyConversationRefs } },
                    { ghlConversationId: { in: refs.legacyConversationRefs } },
                    { syncRecords: { some: { providerConversationId: { in: refs.legacyConversationRefs } } } },
                    { syncRecords: { some: { providerThreadId: { in: refs.legacyConversationRefs } } } },
                ],
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
        conversationId: row.conversation?.id || null,
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
        if (!suggestion.conversation?.id) {
            return { success: false as const, error: "Suggestion is not linked to an active conversation." };
        }

        const sendType = getComposerChannelFromMessageType(suggestion.conversation.lastMessageType);
        const targetContactId = suggestion.contactId || suggestion.conversation.contactId;
        const sendResult = await sendReply(
            suggestion.conversation.id,
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

    if (suggestion.conversation?.id) {
        invalidateConversationReadCaches(suggestion.conversation.id);
        emitConversationRealtimeEvent({
            locationId: location.id,
            conversationId: suggestion.conversation.id,
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
                    id: true,
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

    if (suggestion.conversation?.id) {
        invalidateConversationReadCaches(suggestion.conversation.id);
        emitConversationRealtimeEvent({
            locationId: location.id,
            conversationId: suggestion.conversation.id,
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

    const existingPolicy = await db.aiSkillPolicy.findUnique({
        where: {
            locationId_skillId: {
                locationId: targetLocationId,
                skillId: targetSkillId,
            },
        },
        select: {
            stylePolicy: true,
        },
    });
    const previousCustomInstructions = String((existingPolicy?.stylePolicy as any)?.customInstructions || "");
    const nextCustomInstructions = String(parsed.data.stylePolicy?.customInstructions || "");
    const promptChanged = previousCustomInstructions !== nextCustomInstructions;
    if (promptChanged) {
        await ensureLocationAiPromptVersion({
            locationId: targetLocationId,
            skillId: targetSkillId,
            targetKind: "style_policy",
            currentContent: previousCustomInstructions,
        });
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

    if (promptChanged) {
        await createCurrentPromptVersion({
            locationId: targetLocationId,
            skillId: targetSkillId,
            targetKind: "style_policy",
            content: nextCustomInstructions,
            approvedByUserId: actor.userId,
            source: "manual",
            metadata: {
                policyId: saved.id,
                savedFrom: "settings",
            },
        });
    }

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
            where: buildConversationReferenceWhere(targetLocationId, conversationIdRaw),
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
        conversationId: row.conversation?.id || row.conversationId || null,
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
            select: {
                conversationIds: true,
                conversationLinks: {
                    select: {
                        conversationId: true,
                        legacyConversationRef: true,
                    },
                },
            },
        });
        if (deal) {
            const refs = collectDealConversationReferences(deal);
            const conversation = await db.conversation.findFirst({
                where: {
                    locationId: targetLocationId,
                    OR: [
                        { id: { in: refs.linkedConversationIds } },
                        { id: { in: refs.legacyConversationRefs } },
                        { ghlConversationId: { in: refs.legacyConversationRefs } },
                        { syncRecords: { some: { providerConversationId: { in: refs.legacyConversationRefs } } } },
                        { syncRecords: { some: { providerThreadId: { in: refs.legacyConversationRefs } } } },
                    ],
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

export async function submitAgentLearningProposalAction(input: {
    locationId: string;
    skillId?: string | null;
    type?: "style_policy" | "location_knowledge" | string | null;
    title?: string | null;
    description?: string | null;
    proposedContent?: string | null;
    category?: string | null;
    key?: string | null;
}) {
    const targetLocationId = String(input.locationId || "").trim();
    const actor = await resolveLocationActorContext(targetLocationId);
    if (!actor.hasAccess) {
        return { success: false as const, error: "Unauthorized." };
    }

    const result = await submitManualAgentLearningProposal({
        ...input,
        locationId: targetLocationId,
        actorUserId: actor.userId,
        actorClerkUserId: actor.clerkUserId,
    });
    revalidatePath("/admin/settings/ai");
    return result;
}

export async function listAgentLearningProposalsAction(input: {
    locationId: string;
    status?: string | null;
    limit?: number;
}) {
    const targetLocationId = String(input.locationId || "").trim();
    const actor = await resolveLocationActorContext(targetLocationId);
    if (!actor.hasAccess || !actor.isAdmin) return [];

    return listLearningProposals({
        locationId: targetLocationId,
        status: input.status,
        limit: input.limit,
    });
}

export async function listLocationAiPromptVersionsAction(input: {
    locationId: string;
    skillId?: string | null;
    targetKind?: string | null;
    limit?: number;
}) {
    const targetLocationId = String(input.locationId || "").trim();
    const actor = await resolveLocationActorContext(targetLocationId);
    if (!actor.hasAccess || !actor.isAdmin) return [];

    return listLocationAiPromptVersions({
        locationId: targetLocationId,
        skillId: input.skillId,
        targetKind: input.targetKind,
        limit: input.limit,
    });
}

export async function approveAgentLearningProposalAction(input: {
    locationId: string;
    proposalId: string;
}) {
    const targetLocationId = String(input.locationId || "").trim();
    const actor = await resolveLocationActorContext(targetLocationId);
    if (!actor.hasAccess || !actor.isAdmin) {
        return { success: false as const, error: "Unauthorized: admin access required." };
    }

    const result = await approveLearningProposal({
        locationId: targetLocationId,
        proposalId: input.proposalId,
        actorUserId: actor.userId,
    });
    revalidatePath("/admin/settings/ai");
    return result;
}

export async function dismissAgentLearningProposalAction(input: {
    locationId: string;
    proposalId: string;
}) {
    const targetLocationId = String(input.locationId || "").trim();
    const actor = await resolveLocationActorContext(targetLocationId);
    if (!actor.hasAccess || !actor.isAdmin) {
        return { success: false as const, error: "Unauthorized: admin access required." };
    }

    const result = await dismissLearningProposal({
        locationId: targetLocationId,
        proposalId: input.proposalId,
    });
    revalidatePath("/admin/settings/ai");
    return result;
}

export async function revertLocationAiPromptAction(input: {
    locationId: string;
    skillId: string;
    targetKind?: string | null;
    versionId?: string | null;
}) {
    const targetLocationId = String(input.locationId || "").trim();
    const actor = await resolveLocationActorContext(targetLocationId);
    if (!actor.hasAccess || !actor.isAdmin) {
        return { success: false as const, error: "Unauthorized: admin access required." };
    }

    const result = await revertLocationAiPrompt({
        locationId: targetLocationId,
        skillId: input.skillId,
        actorUserId: actor.userId,
        versionId: input.versionId || null,
    });
    revalidatePath("/admin/settings/ai");
    return result;
}

export async function createAgentLearningSessionAction(input: {
    locationId: string;
    sourceFeature?: string | null;
    limit?: number;
}) {
    const targetLocationId = String(input.locationId || "").trim();
    const actor = await resolveLocationActorContext(targetLocationId);
    if (!actor.hasAccess || !actor.isAdmin) {
        return { success: false as const, error: "Unauthorized: admin access required." };
    }

    return createLearningSessionFromAgentFeedback({
        locationId: targetLocationId,
        sourceFeature: input.sourceFeature || null,
        limit: input.limit,
    });
}
