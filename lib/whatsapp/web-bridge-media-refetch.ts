import { randomUUID } from "crypto";
import db from "@/lib/db";
import { publishConversationRealtimeEvent } from "@/lib/realtime/conversation-events";
import { deleteWhatsAppMediaObject, parseR2Uri } from "@/lib/whatsapp/media-r2";
import { fetchWhatsAppWebBridgeMessages, normalizeWhatsAppWebChatId } from "@/lib/whatsapp/web-bridge";
import {
    formatWhatsAppWebBridgeMediaFailure,
    ingestWhatsAppWebBridgeMediaAttachment,
    isTransientWebBridgeMediaIngestError,
} from "@/lib/whatsapp/web-bridge-media";
import { isWhatsAppWebBridgeRecoverableMediaError } from "@/lib/whatsapp/web-bridge-stale";

export type WhatsAppWebBridgeMediaRefetchStatus = "queued" | "processing" | "completed" | "failed";

type RefetchAttemptUpdate = {
    attemptId: string;
    status: WhatsAppWebBridgeMediaRefetchStatus;
    stage: string;
    message?: string | null;
    error?: string | null;
    jobId?: string | null;
    chatId?: string | null;
    scannedMessages?: number | null;
    attachmentId?: string | null;
    mediaType?: string | null;
};

export type WhatsAppWebBridgeMediaRefetchJob = {
    attemptId: string;
    locationId: string;
    conversationId: string;
    messageId: string;
    deleteStoredObject?: boolean;
    limit?: number;
    queueAttempt?: number;
    queueMaxAttempts?: number;
};

type AttachmentSnapshot = {
    fileName: string | null;
    contentType: string;
    size: number | null;
    url: string;
};

function dedupeStrings(values: Array<string | null | undefined>) {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const value of values) {
        const normalized = String(value || "").trim();
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        out.push(normalized);
    }
    return out;
}

function normalizeKnownLidJid(value: string | null | undefined) {
    const raw = String(value || "").trim();
    if (!raw) return null;
    if (raw.endsWith("@lid")) return raw;
    if (raw.includes("@")) return null;
    return `${raw}@lid`;
}

export function resolveRefetchChatCandidates(conversation: any, message?: any) {
    const contact = conversation?.contact || {};
    return dedupeStrings([
        ...(message?.syncRecords || []).map((sync: any) => sync?.providerThreadId),
        ...(conversation?.syncRecords || []).map((sync: any) => sync?.providerConversationId),
        ...(conversation?.syncRecords || []).map((sync: any) => sync?.providerThreadId),
        normalizeWhatsAppWebChatId(contact.phone),
        contact.lid,
        normalizeWhatsAppWebChatId(contact.lid),
        normalizeWhatsAppWebChatId(normalizeKnownLidJid(contact.lid)),
    ]);
}

function snapshotAttachments(attachments: any[]): AttachmentSnapshot[] {
    return (attachments || []).map((attachment: any) => ({
        fileName: attachment.fileName,
        contentType: attachment.contentType,
        size: attachment.size,
        url: attachment.url,
    }));
}

async function restoreAttachmentSnapshot(messageId: string, snapshot: AttachmentSnapshot[]) {
    if (snapshot.length === 0) return;

    await db.messageAttachment.createMany({
        data: snapshot.map((attachment) => ({
            messageId,
            fileName: attachment.fileName,
            contentType: attachment.contentType,
            size: attachment.size,
            url: attachment.url,
        })),
    }).catch(() => null);
}

function serializeRefetchAttempt(update: RefetchAttemptUpdate) {
    const now = new Date().toISOString();
    return {
        attemptId: update.attemptId,
        status: update.status,
        stage: update.stage,
        message: update.message || null,
        error: update.error || null,
        jobId: update.jobId || null,
        chatId: update.chatId || null,
        scannedMessages: update.scannedMessages ?? null,
        attachmentId: update.attachmentId || null,
        mediaType: update.mediaType || null,
        updatedAt: now,
        ...(update.status === "queued" ? { startedAt: now } : {}),
        ...(update.status === "completed" || update.status === "failed" ? { finishedAt: now } : {}),
    };
}

export async function updateWebBridgeMediaSyncMetadata(messageId: string, mediaState: Record<string, any>) {
    const existing = await (db as any).messageSync.findFirst({
        where: {
            messageId,
            provider: "whatsapp_web_bridge",
        },
        select: { id: true, metadata: true },
    }).catch(() => null);
    if (!existing?.id) return;

    const current = existing.metadata && typeof existing.metadata === "object" ? existing.metadata : {};
    await (db as any).messageSync.update({
        where: { id: existing.id },
        data: {
            metadata: {
                ...current,
                webBridgeMedia: {
                    ...((current as any).webBridgeMedia || {}),
                    ...mediaState,
                    updatedAt: new Date().toISOString(),
                },
            },
        },
    }).catch((error: any) => {
        console.warn("[WhatsApp Web Bridge] Failed to update media metadata:", error?.message || error);
    });
}

async function publishRefetchEvent(args: {
    locationId: string;
    conversationId: string;
    messageId: string;
    update: RefetchAttemptUpdate;
}) {
    await publishConversationRealtimeEvent({
        locationId: args.locationId,
        conversationId: args.conversationId,
        type: "message.media_refetch",
        payload: {
            messageId: args.messageId,
            attempt: serializeRefetchAttempt(args.update),
        },
    });
}

async function updateRefetchProgress(args: {
    locationId: string;
    conversationId: string;
    messageId: string;
    update: RefetchAttemptUpdate;
    mediaState?: Record<string, any>;
}) {
    const attempt = serializeRefetchAttempt(args.update);
    await updateWebBridgeMediaSyncMetadata(args.messageId, {
        ...(args.mediaState || {}),
        refetch: attempt,
    });
    await publishRefetchEvent({ ...args, update: args.update });
    console.log(
        `[WhatsApp Web Bridge] media refetch ${args.update.status}/${args.update.stage}`,
        {
            attemptId: args.update.attemptId,
            conversationId: args.conversationId,
            messageId: args.messageId,
            chatId: args.update.chatId || undefined,
            error: args.update.error || undefined,
        }
    );
}

export function shouldRetryTransientMediaRefetchIngest(args: {
    error: unknown;
    queueAttempt?: number;
    queueMaxAttempts?: number;
}) {
    const queueAttempt = Math.max(Number(args.queueAttempt || 1), 1);
    const queueMaxAttempts = Math.max(Number(args.queueMaxAttempts || 1), 1);
    return (
        isTransientWebBridgeMediaIngestError(args.error)
        || isWhatsAppWebBridgeRecoverableMediaError(args.error)
    ) && queueAttempt < queueMaxAttempts;
}

export async function startWhatsAppWebBridgeMediaRefetchAttempt(args: {
    locationId: string;
    conversationId: string;
    messageId: string;
    deleteStoredObject?: boolean;
    limit?: number;
}) {
    const attemptId = randomUUID();
    await updateRefetchProgress({
        locationId: args.locationId,
        conversationId: args.conversationId,
        messageId: args.messageId,
        update: {
            attemptId,
            status: "queued",
            stage: "queued",
            message: "Media re-fetch is queued and will continue in the background.",
        },
    });

    return {
        attemptId,
        locationId: args.locationId,
        conversationId: args.conversationId,
        messageId: args.messageId,
        deleteStoredObject: args.deleteStoredObject,
        limit: args.limit,
    } satisfies WhatsAppWebBridgeMediaRefetchJob;
}

export async function markWhatsAppWebBridgeMediaRefetchAttemptFailed(
    args: WhatsAppWebBridgeMediaRefetchJob & { error: string; stage?: string }
) {
    await updateRefetchProgress({
        locationId: args.locationId,
        conversationId: args.conversationId,
        messageId: args.messageId,
        update: {
            attemptId: args.attemptId,
            status: "failed",
            stage: args.stage || "enqueue_failed",
            error: args.error,
            message: "Media re-fetch could not start.",
        },
    });
}

export async function processWhatsAppWebBridgeMediaRefetchAttempt(args: WhatsAppWebBridgeMediaRefetchJob) {
    const limit = Math.min(Math.max(Number(args.limit || 80), 1), 2500);
    const queueAttempt = Math.max(Number(args.queueAttempt || 1), 1);
    const queueMaxAttempts = Math.max(Number(args.queueMaxAttempts || 1), 1);
    const conversation = await db.conversation.findFirst({
        where: { id: args.conversationId, locationId: args.locationId },
        include: {
            contact: {
                select: {
                    phone: true,
                    lid: true,
                    contactType: true,
                },
            },
            syncRecords: {
                where: { provider: "whatsapp_web_bridge" },
                select: {
                    providerConversationId: true,
                    providerThreadId: true,
                },
            },
        },
    });
    if (!conversation) {
        await updateRefetchProgress({
            locationId: args.locationId,
            conversationId: args.conversationId,
            messageId: args.messageId,
            update: {
                attemptId: args.attemptId,
                status: "failed",
                stage: "conversation_missing",
                error: "Conversation not found.",
            },
        });
        return { success: false as const, error: "Conversation not found." };
    }

    const message = await db.message.findUnique({
        where: { id: args.messageId },
        include: {
            attachments: true,
            syncRecords: {
                where: { provider: "whatsapp_web_bridge" },
                select: {
                    providerThreadId: true,
                },
            },
        },
    });
    if (!message || message.conversationId !== conversation.id || !message.wamId) {
        await updateRefetchProgress({
            locationId: args.locationId,
            conversationId: args.conversationId,
            messageId: args.messageId,
            update: {
                attemptId: args.attemptId,
                status: "failed",
                stage: "message_missing",
                error: "Message not found or missing WhatsApp message id.",
            },
        });
        return { success: false as const, error: "Message not found or missing WhatsApp message id." };
    }

    const chatCandidates = resolveRefetchChatCandidates(conversation, message);
    if (chatCandidates.length === 0) {
        await updateRefetchProgress({
            locationId: args.locationId,
            conversationId: args.conversationId,
            messageId: args.messageId,
            update: {
                attemptId: args.attemptId,
                status: "failed",
                stage: "missing_chat_id",
                error: "Contact phone or WhatsApp LID is missing.",
            },
        });
        return { success: false as const, error: "Contact phone or WhatsApp LID is missing." };
    }

    let matched: any = null;
    let matchedChatId = "";
    let scannedMessages = 0;
    let lastFetchError = "";

    for (const chatId of chatCandidates) {
        await updateRefetchProgress({
            locationId: args.locationId,
            conversationId: args.conversationId,
            messageId: args.messageId,
            update: {
                attemptId: args.attemptId,
                status: "processing",
                stage: "fetching_from_bridge",
                chatId,
                message: "Fetching media from WhatsApp Web.",
            },
        });

        try {
            const response = await fetchWhatsAppWebBridgeMessages({
                locationId: args.locationId,
                chatId,
                limit,
                includeMedia: true,
                targetMessageId: message.wamId,
            });
            const records = Array.isArray(response?.messages) ? response.messages : [];
            scannedMessages += records.length;
            const candidate = records.find((item: any) => String(item?.id || item?.messageId || "").trim() === message.wamId);
            if (candidate) {
                matched = candidate;
                matchedChatId = chatId;
                break;
            }
        } catch (error: any) {
            lastFetchError = error?.message || String(error || "Unknown bridge fetch error.");
            if (shouldRetryTransientMediaRefetchIngest({ error, queueAttempt, queueMaxAttempts })) {
                await updateRefetchProgress({
                    locationId: args.locationId,
                    conversationId: args.conversationId,
                    messageId: args.messageId,
                    update: {
                        attemptId: args.attemptId,
                        status: "processing",
                        stage: "bridge_fetch_retrying",
                        error: lastFetchError,
                        chatId,
                        scannedMessages,
                        message: `WhatsApp Web media fetch failed temporarily; retry ${queueAttempt + 1} of ${queueMaxAttempts} is scheduled.`,
                    },
                });
                throw error;
            }
        }
    }

    if (!matched) {
        const error = lastFetchError || `Could not locate this Web Bridge message. Scanned ${scannedMessages} messages.`;
        await updateRefetchProgress({
            locationId: args.locationId,
            conversationId: args.conversationId,
            messageId: args.messageId,
            update: {
                attemptId: args.attemptId,
                status: "failed",
                stage: "bridge_message_missing",
                error,
                scannedMessages,
            },
        });
        return { success: false as const, error };
    }

    if (!matched?.media?.data) {
        const error = matched?.mediaError?.message || matched?.mediaError || "WhatsApp Web did not return media data for this message.";
        await updateRefetchProgress({
            locationId: args.locationId,
            conversationId: args.conversationId,
            messageId: args.messageId,
            update: {
                attemptId: args.attemptId,
                status: "failed",
                stage: "missing_media_payload",
                error,
                chatId: matchedChatId,
                scannedMessages,
            },
            mediaState: {
                status: "failed",
                reason: matched?.mediaError?.code || "missing_media_payload",
                error,
                meta: matched?.mediaMeta || null,
            },
        });
        return { success: false as const, error };
    }

    await updateRefetchProgress({
        locationId: args.locationId,
        conversationId: args.conversationId,
        messageId: args.messageId,
        update: {
            attemptId: args.attemptId,
            status: "processing",
            stage: "storing_media",
            chatId: matchedChatId,
            scannedMessages,
            mediaType: String(matched.type || "media"),
            message: "Storing media in Estio.",
        },
    });

    const snapshot = snapshotAttachments(message.attachments || []);

    if (snapshot.length > 0) {
        await db.messageAttachment.deleteMany({ where: { messageId: message.id } });
    }

    let ingestResult: any;
    try {
        ingestResult = await ingestWhatsAppWebBridgeMediaAttachment({
            wamId: message.wamId,
            media: matched.media,
            messageType: String(matched.type || "text"),
            maxTransientAttempts: 5,
            transientBackoffMs: 750,
        });
    } catch (error: any) {
        await restoreAttachmentSnapshot(message.id, snapshot);
        const errorMessage = error?.message || "Failed to ingest Web Bridge media.";
        if (shouldRetryTransientMediaRefetchIngest({ error, queueAttempt, queueMaxAttempts })) {
            await updateRefetchProgress({
                locationId: args.locationId,
                conversationId: args.conversationId,
                messageId: args.messageId,
                update: {
                    attemptId: args.attemptId,
                    status: "processing",
                    stage: "ingest_retrying",
                    error: errorMessage,
                    chatId: matchedChatId,
                    scannedMessages,
                    message: `Storage failed temporarily; retry ${queueAttempt + 1} of ${queueMaxAttempts} is scheduled.`,
                },
                mediaState: {
                    status: "processing",
                    reason: "transient_ingest_retry",
                    error: errorMessage,
                    meta: matched?.mediaMeta || null,
                },
            });
            throw error;
        }
        await updateRefetchProgress({
            locationId: args.locationId,
            conversationId: args.conversationId,
            messageId: args.messageId,
            update: {
                attemptId: args.attemptId,
                status: "failed",
                stage: "ingest_failed",
                error: errorMessage,
                chatId: matchedChatId,
                scannedMessages,
            },
            mediaState: {
                status: "failed",
                reason: "ingest_exception",
                error: errorMessage,
                meta: matched?.mediaMeta || null,
            },
        });
        return { success: false as const, error: errorMessage };
    }

    if (ingestResult?.status !== "stored") {
        await restoreAttachmentSnapshot(message.id, snapshot);
        const reason = ingestResult?.reason || "unknown";
        await updateRefetchProgress({
            locationId: args.locationId,
            conversationId: args.conversationId,
            messageId: args.messageId,
            update: {
                attemptId: args.attemptId,
                status: "failed",
                stage: "ingest_skipped",
                error: formatWhatsAppWebBridgeMediaFailure(reason),
                chatId: matchedChatId,
                scannedMessages,
            },
            mediaState: {
                status: ingestResult?.status || "skipped",
                reason,
                error: null,
                meta: matched?.mediaMeta || null,
            },
        });
        return { success: false as const, error: formatWhatsAppWebBridgeMediaFailure(reason) };
    }

    if (args.deleteStoredObject !== false && snapshot.length > 0) {
        for (const attachment of snapshot) {
            const r2 = parseR2Uri(String(attachment.url || ""));
            if (!r2) continue;
            await deleteWhatsAppMediaObject(r2.key).catch(() => null);
        }
    }

    const createdAttachment = await db.messageAttachment.findFirst({
        where: { messageId: message.id },
        orderBy: { createdAt: "desc" },
        select: { id: true },
    }).catch(() => null);

    await updateRefetchProgress({
        locationId: args.locationId,
        conversationId: args.conversationId,
        messageId: args.messageId,
        update: {
            attemptId: args.attemptId,
            status: "completed",
            stage: "completed",
            message: "Media stored. Audio transcription is queued automatically for voice notes.",
            chatId: matchedChatId,
            scannedMessages,
            attachmentId: createdAttachment?.id || null,
            mediaType: String(matched.type || "media"),
        },
        mediaState: {
            status: "stored",
            key: ingestResult.key || null,
            error: null,
            reason: null,
            meta: matched?.mediaMeta || null,
        },
    });

    return {
        success: true as const,
        mediaType: String(matched.type || "media"),
        remoteJid: matchedChatId,
        scannedMessages,
        attachmentId: createdAttachment?.id || null,
    };
}
