import db from "@/lib/db";
import { getLocationDefaultReplyLanguage } from "@/lib/ai/location-reply-language";
import { ensureConversationHistory } from "@/lib/ghl/sync";
import { buildMessageTranslationState, getResolvedConversationTranslationLanguage } from "@/lib/conversations/translation-view";
import { getWhatsAppMediaObjectBytes, parseR2Uri } from "@/lib/whatsapp/media-r2";
import { isVCardMedia, parseVCardContacts } from "@/lib/contacts/vcard";

const DEFAULT_TRANSLATION_TARGET_LANGUAGE = "en";
const MESSAGE_TRANSLATION_STATUS = {
    completed: "completed",
    failed: "failed",
} as const;

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

async function parseStoredVCardAttachmentContacts(attachment: {
    url?: string | null;
    contentType?: string | null;
    fileName?: string | null;
}) {
    if (!isVCardMedia(attachment)) return [];
    const parsed = parseR2Uri(String(attachment.url || ""));
    if (!parsed?.key) return [];

    try {
        const object = await getWhatsAppMediaObjectBytes(parsed.key);
        return parseVCardContacts(object.buffer.toString("utf8"));
    } catch (error) {
        console.warn("[Conversations] Failed to parse vCard attachment:", error);
        return [];
    }
}

export type FetchMessagesOptions = {
    ensureHistory?: boolean;
    take?: number | null;
    beforeCursor?: string | null;
    includeLegacyEmailMeta?: boolean;
    metadataMode?: "full" | "firstPaint";
    refreshMode?: "initial_hydration" | "active_refresh" | "deferred_activity" | "default";
};

export type ResolvedConversationForMessages = {
    id: string;
    ghlConversationId?: string | null;
    contactId?: string | null;
    replyLanguageOverride?: string | null;
    contact: {
        ghlContactId?: string | null;
    };
};

export type ResolvedLocationForMessages = {
    id: string;
    ghlAccessToken?: string | null;
};

type TranscriptVisibility = {
    restrictContent: boolean;
};

type MessageLoadingDependencies = {
    resolveTranscriptVisibilityAccess: (locationId: string) => Promise<TranscriptVisibility>;
    parseLegacyCrmLeadNotificationEmail: (args: {
        subject?: string | null;
        emailFrom?: string | null;
        body?: string | null;
        configuredSenders?: string[] | null;
        configuredDomains?: string[] | null;
        configuredSubjectPatterns?: string[] | null;
    }) => any;
};

export async function fetchMessagesForResolvedConversation(args: {
    requestedConversationId: string;
    location: ResolvedLocationForMessages;
    conversation: ResolvedConversationForMessages | null;
    options?: FetchMessagesOptions;
    reusedConversationContext: boolean;
    initialTimings?: Record<string, number>;
    startedAtMs?: number;
    dependencies: MessageLoadingDependencies;
}) {
    const startedAtMs = args.startedAtMs || Date.now();
    const timings: Record<string, number> = { ...(args.initialTimings || {}) };
    const markTiming = (key: string, sinceMs: number) => {
        timings[key] = Date.now() - sinceMs;
    };
    const conversationId = args.requestedConversationId;
    const location = args.location;
    const conversation = args.conversation;
    const options = args.options;
    const ensureHistory = !!options?.ensureHistory;
    const requestedTake = Number(options?.take);
    const boundedTake = Number.isFinite(requestedTake) && requestedTake > 0
        ? Math.min(Math.max(Math.floor(requestedTake), 1), 500)
        : null;
    const metadataMode = options?.metadataMode === "firstPaint" ? "firstPaint" : "full";
    const refreshMode = options?.refreshMode || "default";
    const includeHeavyMessageMetadata = metadataMode !== "firstPaint";
    const includeLegacyEmailMeta = includeHeavyMessageMetadata && options?.includeLegacyEmailMeta !== false;
    const paginationCursor = decodeMessagePaginationCursor(options?.beforeCursor);

    if (!conversation) {
        console.log("[perf:conversations.fetch_messages]", JSON.stringify({
            conversationId,
            requestedTake: boundedTake,
            beforeCursor: !!options?.beforeCursor,
            refreshMode,
            metadataMode,
            includeLegacyEmailMeta,
            includeHeavyMessageMetadata,
            ensureHistory,
            reusedConversationContext: args.reusedConversationContext,
            found: false,
            activeRefreshMessageLimit: refreshMode === "active_refresh" ? boundedTake : undefined,
            returnedMessageCount: 0,
            total_ms: Date.now() - startedAtMs,
            ...timings,
        }));
        return [];
    }

    if (ensureHistory && conversation.contactId && location.ghlAccessToken) {
        const historyStartedAtMs = Date.now();
        await ensureConversationHistory(conversation.contactId, location.id, location.ghlAccessToken);
        markTiming("ensure_history_ms", historyStartedAtMs);
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
    const queryStartedAtMs = Date.now();
    const messageRows = await (db as any).message.findMany({
        where: messageWhere,
        orderBy: readDescending
            ? [{ createdAt: "desc" }, { id: "desc" }]
            : [{ createdAt: "asc" }, { id: "asc" }],
        ...(boundedTake ? { take: boundedTake } : {}),
        include: {
            attachments: {
                ...(includeHeavyMessageMetadata
                    ? {
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
                    }
                    : {
                        select: {
                            id: true,
                            url: true,
                            contentType: true,
                            fileName: true,
                        },
                    }),
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
            syncRecords: {
                where: { provider: "whatsapp_web_bridge" },
                select: {
                    metadata: true,
                    lastError: true,
                },
                take: 1,
            },
            ...(includeHeavyMessageMetadata ? {
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
            } : {}),
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
    markTiming("query_ms", queryStartedAtMs);

    const messages = readDescending ? [...messageRows].reverse() : messageRows;
    console.log(`[DB Read] Fetched ${messages.length} messages from local database for conversation ${conversation.ghlConversationId}`);

    const hasEmailMessages = includeLegacyEmailMeta
        ? messages.some((m: any) => String(m.type || "").toUpperCase().includes("EMAIL"))
        : false;
    const metadataStartedAtMs = Date.now();
    const [legacyCrmSettings, transcriptVisibility, locationDefaultReplyLanguage] = await Promise.all([
        hasEmailMessages
            ? db.location.findUnique({
                where: { id: location.id },
                select: {
                    legacyCrmLeadEmailEnabled: true,
                    legacyCrmLeadEmailSenders: true,
                    legacyCrmLeadEmailSenderDomains: true,
                    legacyCrmLeadEmailSubjectPatterns: true,
                } as any
            })
            : Promise.resolve(null),
        includeHeavyMessageMetadata
            ? args.dependencies.resolveTranscriptVisibilityAccess(location.id)
            : Promise.resolve({ canViewTranscripts: true, restrictContent: false }),
        includeHeavyMessageMetadata
            ? getLocationDefaultReplyLanguage(location.id, DEFAULT_TRANSLATION_TARGET_LANGUAGE)
            : Promise.resolve(DEFAULT_TRANSLATION_TARGET_LANGUAGE),
    ]);
    markTiming("metadata_ms", metadataStartedAtMs);

    const legacyCrmDetectionEnabled = !!(legacyCrmSettings as any)?.legacyCrmLeadEmailEnabled;
    const legacyCrmConfiguredSenders = (((legacyCrmSettings as any)?.legacyCrmLeadEmailSenders || []) as string[]);
    const legacyCrmConfiguredDomains = (((legacyCrmSettings as any)?.legacyCrmLeadEmailSenderDomains || []) as string[]);
    const legacyCrmSubjectPatterns = (((legacyCrmSettings as any)?.legacyCrmLeadEmailSubjectPatterns || []) as string[]);
    const redactTranscriptContent = transcriptVisibility.restrictContent;
    const resolvedTranslationTargetLanguage = getResolvedConversationTranslationLanguage({
        replyLanguageOverride: conversation.replyLanguageOverride || null,
        locationDefaultReplyLanguage,
    });

    const serializeStartedAtMs = Date.now();
    const serializedMessages = await Promise.all(messages.map(async (m: any) => {
        const webBridgeSync = Array.isArray(m.syncRecords) ? m.syncRecords[0] : null;
        const webBridgeMedia = webBridgeSync?.metadata && typeof webBridgeSync.metadata === "object"
            ? (webBridgeSync.metadata as any).webBridgeMedia || null
            : null;
        const translationEntries = includeHeavyMessageMetadata ? (m.translationCaches || []).map((entry: any) => ({
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
        })) : [];
        const detectedLanguage = includeHeavyMessageMetadata ? ((m.translationCaches?.[0]?.detectedSourceLanguage || null) || null) : null;
        const detectedLanguageConfidence = includeHeavyMessageMetadata && Number.isFinite(Number(m.translationCaches?.[0]?.detectionConfidence))
            ? Number(m.translationCaches?.[0]?.detectionConfidence)
            : null;

        return {
            ...(() => {
                if (!includeLegacyEmailMeta) return {};
                const isEmail = String(m.type || "").toUpperCase().includes("EMAIL");
                if (!isEmail) return {};

                const processing = m.legacyCrmLeadEmailProcessing;
                const parsed = args.dependencies.parseLegacyCrmLeadNotificationEmail({
                    subject: m.subject,
                    emailFrom: m.emailFrom,
                    body: m.body,
                    configuredSenders: legacyCrmConfiguredSenders,
                    configuredDomains: legacyCrmConfiguredDomains,
                    configuredSubjectPatterns: legacyCrmSubjectPatterns,
                });

                const extracted = processing?.extracted && typeof processing.extracted === "object"
                    ? (processing.extracted as any)
                    : null;
                const extractedReason = extracted?.reason ? String(extracted.reason) : null;
                const sourceUpper = String(m.source || "").toUpperCase();
                const isOutlookSyncedEmail = sourceUpper.includes("OUTLOOK");
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
                        canProcess: !processing || ["pending", "failed", "ignored"].includes(String(processing.status || "").toLowerCase()),
                        canReprocess: !!processing && ["processed", "failed", "ignored"].includes(String(processing.status || "").toLowerCase()),
                        detectionEnabled: legacyCrmDetectionEnabled,
                    }
                };
            })(),
            id: m.id,
            ghlMessageId: m.ghlMessageId,
            clientMessageId: (m as any).clientMessageId || undefined,
            wamId: m.wamId || undefined,
            conversationId: m.conversationId,
            contactId: conversation.contact.ghlContactId || "",
            body: m.body || "",
            type: m.type,
            direction: m.direction as "inbound" | "outbound",
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
            webBridgeMedia: webBridgeMedia ? {
                status: webBridgeMedia.status || null,
                reason: webBridgeMedia.reason || null,
                error: webBridgeMedia.error || null,
                meta: webBridgeMedia.meta || null,
                refetch: webBridgeMedia.refetch || null,
                updatedAt: webBridgeMedia.updatedAt || null,
            } : null,
            detectedLanguage,
            detectedLanguageConfidence,
            translation: buildMessageTranslationState({
                direction: m.direction as "inbound" | "outbound",
                detectedLanguage,
                detectedLanguageConfidence,
            }, translationEntries, resolvedTranslationTargetLanguage),
            translations: translationEntries,
            attachments: await Promise.all((m.attachments || []).map(async (a: any) => ({
                id: a.id,
                url: String(a.url || "").startsWith("r2://")
                    ? `/api/media/attachments/${a.id}`
                    : a.url,
                mimeType: a.contentType || null,
                fileName: a.fileName || null,
                sharedContacts: await parseStoredVCardAttachmentContacts(a),
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
            }))),
            html: m.body?.includes("<") ? m.body : undefined
        };
    }));
    markTiming("serialize_ms", serializeStartedAtMs);

    const attachmentCount = messages.reduce((count: number, message: any) => (
        count + (Array.isArray(message.attachments) ? message.attachments.length : 0)
    ), 0);
    const transcriptCount = messages.reduce((count: number, message: any) => (
        count + (Array.isArray(message.attachments)
            ? message.attachments.filter((attachment: any) => !!attachment.transcript).length
            : 0)
    ), 0);
    const translationCount = messages.reduce((count: number, message: any) => (
        count + (Array.isArray(message.translationCaches) ? message.translationCaches.length : 0)
    ), 0);

    console.log("[perf:conversations.fetch_messages]", JSON.stringify({
        conversationId: conversation.id,
        requestedConversationId: conversationId,
        requestedTake: boundedTake,
        beforeCursor: !!options?.beforeCursor,
        refreshMode,
        metadataMode,
        includeLegacyEmailMeta,
        includeHeavyMessageMetadata,
        ensureHistory,
        reusedConversationContext: args.reusedConversationContext,
        activeRefreshMessageLimit: refreshMode === "active_refresh" ? boundedTake : undefined,
        returnedMessageCount: messages.length,
        message_count: messages.length,
        attachment_count: attachmentCount,
        transcript_count: transcriptCount,
        translation_count: translationCount,
        email_message_count: hasEmailMessages
            ? messages.filter((message: any) => String(message.type || "").toUpperCase().includes("EMAIL")).length
            : 0,
        total_ms: Date.now() - startedAtMs,
        ...timings,
    }));

    return serializedMessages;
}
