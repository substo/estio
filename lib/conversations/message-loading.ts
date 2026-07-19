import db from "@/lib/db";
import { getLocationDefaultReplyLanguage } from "@/lib/ai/location-reply-language";
import { ensureConversationHistory } from "@/lib/ghl/sync";
import { buildMessageTranslationState, getResolvedConversationTranslationLanguage } from "@/lib/conversations/translation-view";
import { isUsableMessageTranslationText } from "@/lib/conversations/translation-output";
import { getWhatsAppMediaObjectBytes, parseR2Uri } from "@/lib/whatsapp/media-r2";
import { isVCardMedia, parseVCardContacts } from "@/lib/contacts/vcard";
import { buildVisibleMessageSourceWhere } from "./internal-message-visibility";

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
    if (normalizedOutbox === "rate_limited") return "retrying";
    if (normalizedOutbox === "failed") return "retrying";
    if (normalizedOutbox === "dead") return "failed";
    if (normalizedOutbox === "completed") return "sent";

    if (normalizedStatus === "sending") return "sending";
    if (normalizedStatus === "failed") return "failed";
    if (["sent", "delivered", "read", "played"].includes(normalizedStatus)) return "sent";
    return undefined;
}

function resolveMessageDisplayBody(message: any) {
    const body = String(message?.body || "");
    if (body.trim()) return body;

    const isWhatsApp = String(message?.type || "").toUpperCase().includes("WHATSAPP");
    const isWebBridge = String(message?.source || "") === "whatsapp_web_bridge";
    const hasAttachments = Array.isArray(message?.attachments) && message.attachments.length > 0;
    if (isWhatsApp && isWebBridge && !hasAttachments) {
        return "WhatsApp call";
    }

    return "";
}

const WEB_BRIDGE_IMAGE_ALBUM_GROUP_WINDOW_MS = 10_000;
const WEB_BRIDGE_MEDIA_PLACEHOLDER_BODIES = new Set(["[Image]", "[Media]"]);
const WEB_BRIDGE_SCHEDULED_ECHO_DEDUPE_WINDOW_MS = 10 * 60 * 1000;
const WHATSAPP_FAILED_ATTEMPT_SUPERSEDE_WINDOW_MS = 2 * 60 * 60 * 1000;

function isWebBridgeImageMediaPlaceholder(message: any) {
    const webBridgeMedia = message?.webBridgeMedia || null;
    if (!webBridgeMedia || String(webBridgeMedia.status || "") === "stored") return false;
    if (String(message?.source || "") !== "whatsapp_web_bridge") return false;
    if (!String(message?.type || "").toUpperCase().includes("WHATSAPP")) return false;
    if (Array.isArray(message?.attachments) && message.attachments.length > 0) return false;

    const meta = webBridgeMedia.meta || {};
    const metaType = String(meta.type || "").toLowerCase();
    const mimeType = String(meta.mimetype || "").toLowerCase();
    const body = String(message?.body || "").trim();
    return metaType === "image" || mimeType.startsWith("image/") || WEB_BRIDGE_MEDIA_PLACEHOLDER_BODIES.has(body);
}

function getMessageTimestampMs(message: any) {
    const value = message?.dateAdded instanceof Date
        ? message.dateAdded.getTime()
        : message?.createdAt instanceof Date
            ? message.createdAt.getTime()
            : new Date(message?.dateAdded || message?.createdAt || 0).getTime();
    return Number.isFinite(value) ? value : 0;
}

function normalizeMessageBodyForDedupe(value: unknown) {
    return String(value || "").trim().replace(/\s+/g, " ");
}

function getMessageOutboxStatus(message: any) {
    return String(message?.outboundWhatsAppOutbox?.status || message?.outboxState?.status || "").toLowerCase();
}

function isOutboundWhatsApp(message: any) {
    return String(message?.direction || "") === "outbound"
        && String(message?.type || "").toUpperCase().includes("WHATSAPP");
}

function isFailedOutboundWhatsAppAttempt(message: any) {
    const status = String(message?.status || "").toLowerCase();
    const outboxStatus = getMessageOutboxStatus(message);
    return isOutboundWhatsApp(message)
        && !String(message?.wamId || "").trim()
        && (status === "failed" || outboxStatus === "dead");
}

function isAcceptedOutboundWhatsAppSend(message: any) {
    const status = String(message?.status || "").toLowerCase();
    const outboxStatus = getMessageOutboxStatus(message);
    return isOutboundWhatsApp(message)
        && (
            ["sent", "delivered", "read", "played", "dispatch_accepted", "delivery_unconfirmed"].includes(status)
            || ["completed", "dispatch_accepted", "delivery_unconfirmed"].includes(outboxStatus)
            || !!String(message?.wamId || "").trim()
        );
}

function isUnconfirmedScheduledWhatsAppPlaceholder(message: any) {
    const status = String(message?.status || "").toLowerCase();
    const outboxStatus = String(message?.outboundWhatsAppOutbox?.status || "").toLowerCase();
    return String(message?.direction || "") === "outbound"
        && String(message?.source || "") === "scheduled_message"
        && !String(message?.wamId || "").trim()
        && (status === "delivery_unconfirmed" || outboxStatus === "delivery_unconfirmed");
}

function isConfirmedWebBridgeEcho(message: any) {
    return String(message?.direction || "") === "outbound"
        && String(message?.source || "") === "whatsapp_web_bridge"
        && !!String(message?.wamId || "").trim();
}

export function hideDuplicateScheduledWebBridgeEchoesForDisplay<T extends Record<string, any>>(messages: T[]): T[] {
    const confirmedEchoes = (messages || [])
        .filter(isConfirmedWebBridgeEcho)
        .map((message) => ({
            body: normalizeMessageBodyForDedupe(message.body),
            timestampMs: getMessageTimestampMs(message),
        }))
        .filter((message) => message.body && message.timestampMs > 0);

    if (confirmedEchoes.length === 0) return messages;

    return (messages || []).filter((message) => {
        if (!isUnconfirmedScheduledWhatsAppPlaceholder(message)) return true;

        const body = normalizeMessageBodyForDedupe(message.body);
        const timestampMs = getMessageTimestampMs(message);
        if (!body || timestampMs <= 0) return true;

        return !confirmedEchoes.some((echo) => (
            echo.body === body
            && echo.timestampMs >= timestampMs
            && echo.timestampMs - timestampMs <= WEB_BRIDGE_SCHEDULED_ECHO_DEDUPE_WINDOW_MS
        ));
    });
}

export function hideSupersededFailedWhatsAppAttemptsForDisplay<T extends Record<string, any>>(messages: T[]): T[] {
    const acceptedSends = (messages || [])
        .filter(isAcceptedOutboundWhatsAppSend)
        .map((message) => ({
            body: normalizeMessageBodyForDedupe(message.body),
            timestampMs: getMessageTimestampMs(message),
        }))
        .filter((message) => message.body && message.timestampMs > 0);

    if (acceptedSends.length === 0) return messages;

    return (messages || []).filter((message) => {
        if (!isFailedOutboundWhatsAppAttempt(message)) return true;

        const body = normalizeMessageBodyForDedupe(message.body);
        const timestampMs = getMessageTimestampMs(message);
        if (!body || timestampMs <= 0) return true;

        return !acceptedSends.some((accepted) => (
            accepted.body === body
            && accepted.timestampMs >= timestampMs
            && accepted.timestampMs - timestampMs <= WHATSAPP_FAILED_ATTEMPT_SUPERSEDE_WINDOW_MS
        ));
    });
}

function getAlbumRepresentative(group: any[]) {
    return group.find((message) => {
        const body = String(message?.body || "").trim();
        return body && !WEB_BRIDGE_MEDIA_PLACEHOLDER_BODIES.has(body);
    }) || group[0];
}

function serializeWebBridgeMediaAlbum(group: any[]) {
    const representative = getAlbumRepresentative(group);
    const items = group.map((message) => ({
        messageId: message.id,
        wamId: message.wamId || null,
        status: message.webBridgeMedia?.status || null,
        reason: message.webBridgeMedia?.reason || null,
        error: message.webBridgeMedia?.error || null,
        meta: message.webBridgeMedia?.meta || null,
        updatedAt: message.webBridgeMedia?.updatedAt || null,
    }));

    return {
        ...representative,
        webBridgeMedia: {
            ...(representative.webBridgeMedia || {}),
            group: {
                kind: "image_album",
                count: group.length,
                messageIds: group.map((message) => message.id),
                items,
            },
        },
    };
}

export function groupWebBridgeImageMediaPlaceholdersForDisplay<T extends Record<string, any>>(messages: T[]): T[] {
    const output: T[] = [];
    let pending: T[] = [];

    const flush = () => {
        if (pending.length === 0) return;
        output.push((pending.length > 1 ? serializeWebBridgeMediaAlbum(pending) : pending[0]) as T);
        pending = [];
    };

    for (const message of messages || []) {
        if (!isWebBridgeImageMediaPlaceholder(message)) {
            flush();
            output.push(message);
            continue;
        }

        const previous = pending[pending.length - 1];
        const sameAlbum = previous
            && previous.direction === message.direction
            && Math.abs(getMessageTimestampMs(message) - getMessageTimestampMs(previous)) <= WEB_BRIDGE_IMAGE_ALBUM_GROUP_WINDOW_MS;

        if (!previous || sameAlbum) {
            pending.push(message);
            continue;
        }

        flush();
        pending.push(message);
    }

    flush();
    return output;
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

    const messageWhere: any = {
        conversationId: conversation.id,
        ...buildVisibleMessageSourceWhere(),
    };
    if (paginationCursor) {
        const cursorDate = new Date(paginationCursor.createdAtMs);
        messageWhere.AND = [
            { OR: messageWhere.OR },
            {
                OR: [
                    { createdAt: { lt: cursorDate } },
                    {
                        AND: [
                            { createdAt: { equals: cursorDate } },
                            { id: { lt: paginationCursor.id } },
                        ],
                    },
                ],
            },
        ];
        delete messageWhere.OR;
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
                            transcript: {
                                select: {
                                    id: true,
                                    status: true,
                                    text: true,
                                    error: true,
                                    model: true,
                                    provider: true,
                                    updatedAt: true,
                                },
                            },
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
                    rateLimitReason: true,
                    rateLimitNextEligibleAt: true,
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
            translationCaches: {
                where: {
                    status: MESSAGE_TRANSLATION_STATUS.completed,
                },
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
    markTiming("query_ms", queryStartedAtMs);

    const messages = hideSupersededFailedWhatsAppAttemptsForDisplay(
        hideDuplicateScheduledWebBridgeEchoesForDisplay(readDescending ? [...messageRows].reverse() : messageRows)
    );
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
        args.dependencies.resolveTranscriptVisibilityAccess(location.id),
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
        locationDefaultReplyLanguage,
    });

    const serializeStartedAtMs = Date.now();
    const serializedMessages = await Promise.all(messages.map(async (m: any) => {
        const webBridgeSync = Array.isArray(m.syncRecords) ? m.syncRecords[0] : null;
        const webBridgeMedia = webBridgeSync?.metadata && typeof webBridgeSync.metadata === "object"
            ? (webBridgeSync.metadata as any).webBridgeMedia || null
            : null;
        const validTranslationCaches = (m.translationCaches || [])
            .filter((entry: any) => isUsableMessageTranslationText(entry.translatedText));
        const translationEntries = validTranslationCaches.map((entry: any) => ({
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
        const detectedLanguage = ((validTranslationCaches?.[0]?.detectedSourceLanguage || null) || null);
        const detectedLanguageConfidence = Number.isFinite(Number(validTranslationCaches?.[0]?.detectionConfidence))
            ? Number(validTranslationCaches?.[0]?.detectionConfidence)
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
            body: resolveMessageDisplayBody(m),
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
                    rateLimitReason: (m as any).outboundWhatsAppOutbox.rateLimitReason || null,
                    rateLimitNextEligibleAt: (m as any).outboundWhatsAppOutbox.rateLimitNextEligibleAt
                        ? new Date((m as any).outboundWhatsAppOutbox.rateLimitNextEligibleAt).toISOString()
                        : null,
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
    const displayMessages = groupWebBridgeImageMediaPlaceholdersForDisplay(serializedMessages);
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
        returnedMessageCount: displayMessages.length,
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

    return displayMessages;
}
