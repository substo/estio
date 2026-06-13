import db from "@/lib/db";
import {
    buildWhatsAppInboundAttachmentKey,
    headWhatsAppMediaObject,
    putWhatsAppMediaObject,
    sanitizeWhatsAppMediaFilename,
    toR2Uri,
} from "@/lib/whatsapp/media-r2";
import { isVCardMedia } from "@/lib/contacts/vcard";

const DEFAULT_TRANSIENT_INGEST_ATTEMPTS = 5;
const DEFAULT_TRANSIENT_INGEST_BACKOFF_MS = 1000;

type WebBridgeMediaIngestDependencies = {
    dbClient?: typeof db;
    putMediaObject?: typeof putWhatsAppMediaObject;
    headMediaObject?: typeof headWhatsAppMediaObject;
    toMediaUri?: typeof toR2Uri;
    initAudioTranscriptionWorker?: () => Promise<unknown>;
    enqueueAudioTranscription?: (input: {
        locationId: string;
        messageId: string;
        attachmentId: string;
    }) => Promise<unknown>;
    sleep?: (ms: number) => Promise<void>;
};

export function normalizeBridgeMediaType(type: string | null | undefined): "image" | "audio" | "document" | null {
    const value = String(type || "").toLowerCase();
    if (value === "image" || value.startsWith("image/")) return "image";
    if (value === "audio" || value === "ptt" || value.startsWith("audio/")) return "audio";
    if (
        value === "document" ||
        value === "pdf" ||
        value.startsWith("application/") ||
        value.startsWith("text/") ||
        [
            "application/pdf",
            "application/msword",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/vnd.ms-excel",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "application/vnd.ms-powerpoint",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "text/csv",
            "text/plain",
        ].includes(value)
    ) return "document";
    return null;
}

function fallbackContentType(kind: "image" | "audio" | "document") {
    if (kind === "image") return "image/jpeg";
    if (kind === "audio") return "audio/ogg";
    return "application/octet-stream";
}

export function decodeBridgeBase64Payload(value: string) {
    const trimmed = String(value || "").trim();
    const comma = trimmed.indexOf(",");
    const base64 = trimmed.startsWith("data:") && comma >= 0 ? trimmed.slice(comma + 1) : trimmed;
    if (!base64) return null;
    if (!/^[A-Za-z0-9+/=\s_-]+$/.test(base64)) return null;
    const normalized = base64.replace(/-/g, "+").replace(/_/g, "/").replace(/\s+/g, "");
    const buffer = Buffer.from(normalized, "base64");
    if (buffer.length <= 0) return null;
    return buffer;
}

export function formatWhatsAppWebBridgeMediaFailure(reason: string | undefined) {
    switch (reason) {
        case "missing_input":
            return "missing media payload";
        case "unsupported_media_type":
            return "unsupported media type";
        case "message_not_found":
            return "message row missing";
        case "attachment_exists":
            return "attachment already exists";
        case "invalid_base64":
            return "media payload could not be decoded";
        case "empty_decoded_payload":
            return "decoded media file is empty";
        default:
            return reason || "unknown reason";
    }
}

export function isTransientWebBridgeMediaIngestError(error: unknown): boolean {
    const message = String((error as any)?.message || error || "").toLowerCase();
    const code = String((error as any)?.code || (error as any)?.cause?.code || "").toLowerCase();
    return [
        "econnreset",
        "etimedout",
        "econnaborted",
        "socket hang up",
        "aborted",
        "timeout",
        "timed out",
        "connection reset",
        "network error",
    ].some((needle) => message.includes(needle) || code.includes(needle));
}

async function defaultSleep(ms: number) {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

async function runWithTransientRetry<T>(args: {
    maxAttempts: number;
    backoffMs: number;
    sleep: (ms: number) => Promise<void>;
    onRetry?: (error: unknown, attempt: number) => void;
    work: () => Promise<T>;
}) {
    for (let attempt = 1; attempt <= args.maxAttempts; attempt++) {
        try {
            return await args.work();
        } catch (error) {
            const isLastAttempt = attempt >= args.maxAttempts;
            if (!isTransientWebBridgeMediaIngestError(error) || isLastAttempt) throw error;
            args.onRetry?.(error, attempt);
            await args.sleep(args.backoffMs * attempt);
        }
    }
    throw new Error("Transient media ingest retry exhausted.");
}

function logMediaIngestStage(stage: string, wamId: string, detail?: Record<string, unknown>) {
    console.log(`[WhatsApp Web Bridge] media ingest ${stage}`, {
        wamId,
        ...(detail || {}),
    });
}

const mediaIngestLocks = new Map<string, Promise<any>>();

export async function ingestWhatsAppWebBridgeMediaAttachment(params: {
    wamId: string;
    media: {
        data?: string | null;
        mimetype?: string | null;
        filename?: string | null;
        size?: number | null;
    };
    messageType?: string | null;
    maxTransientAttempts?: number;
    transientBackoffMs?: number;
    dependencies?: WebBridgeMediaIngestDependencies;
}) {
    const wamId = String(params.wamId || "").trim();
    if (!wamId) return ingestWhatsAppWebBridgeMediaAttachmentUnlocked(params);

    const existing = mediaIngestLocks.get(wamId);
    if (existing) return existing;

    const promise = ingestWhatsAppWebBridgeMediaAttachmentUnlocked(params).finally(() => {
        if (mediaIngestLocks.get(wamId) === promise) {
            mediaIngestLocks.delete(wamId);
        }
    });
    mediaIngestLocks.set(wamId, promise);
    return promise;
}

async function ingestWhatsAppWebBridgeMediaAttachmentUnlocked(params: {
    wamId: string;
    media: {
        data?: string | null;
        mimetype?: string | null;
        filename?: string | null;
        size?: number | null;
    };
    messageType?: string | null;
    maxTransientAttempts?: number;
    transientBackoffMs?: number;
    dependencies?: WebBridgeMediaIngestDependencies;
}) {
    const dbClient = (params.dependencies?.dbClient || db) as any;
    const putMediaObject = params.dependencies?.putMediaObject || putWhatsAppMediaObject;
    const headMediaObject = params.dependencies?.headMediaObject || headWhatsAppMediaObject;
    const toMediaUri = params.dependencies?.toMediaUri || toR2Uri;
    const sleep = params.dependencies?.sleep || defaultSleep;
    const maxTransientAttempts = Math.max(
        1,
        Math.min(Number(params.maxTransientAttempts || DEFAULT_TRANSIENT_INGEST_ATTEMPTS), 5)
    );
    const transientBackoffMs = Math.max(0, Number(params.transientBackoffMs ?? DEFAULT_TRANSIENT_INGEST_BACKOFF_MS));
    const wamId = String(params.wamId || "").trim();
    const base64 = String(params.media?.data || "").trim();
    if (!wamId || !base64) return { status: "skipped" as const, reason: "missing_input" };

    const kind = isVCardMedia({ contentType: params.media?.mimetype, fileName: params.media?.filename })
        ? "document"
        : normalizeBridgeMediaType(params.media?.mimetype || params.messageType);
    if (!kind) return { status: "skipped" as const, reason: "unsupported_media_type" };

    const message = await dbClient.message.findFirst({
        where: { wamId },
        include: {
            attachments: true,
            conversation: {
                select: {
                    id: true,
                    locationId: true,
                    contactId: true,
                },
            },
        },
    });

    if (!message) return { status: "skipped" as const, reason: "message_not_found" };
    if (message.attachments.length > 0) return { status: "skipped" as const, reason: "attachment_exists" };

    const buffer = decodeBridgeBase64Payload(base64);
    if (!buffer) return { status: "failed" as const, reason: "invalid_base64" };
    if (buffer.length <= 0) return { status: "failed" as const, reason: "empty_decoded_payload" };

    const contentType = String(params.media?.mimetype || fallbackContentType(kind));
    const fileName = sanitizeWhatsAppMediaFilename(
        String(params.media?.filename || wamId),
        contentType,
    );
    const size = buffer.length;

    const key = buildWhatsAppInboundAttachmentKey({
        locationId: message.conversation.locationId,
        contactId: message.conversation.contactId,
        conversationId: message.conversation.id,
        messageId: message.id,
        fileName,
        contentType,
    });

    const uploaded = await runWithTransientRetry({
        maxAttempts: maxTransientAttempts,
        backoffMs: transientBackoffMs,
        sleep,
        onRetry: (error, attempt) => {
            logMediaIngestStage("upload_retry", wamId, {
                attempt,
                key,
                error: (error as any)?.message || String(error),
            });
        },
        work: async () => {
            logMediaIngestStage("upload_start", wamId, { key, contentType, size });
            try {
                const result = await putMediaObject({
                    key,
                    body: buffer,
                    contentType,
                    contentLength: size,
                });
                logMediaIngestStage("upload_success", wamId, { key });
                return result;
            } catch (error) {
                if (!isTransientWebBridgeMediaIngestError(error)) throw error;

                const existing = await headMediaObject(key).catch(() => null);
                logMediaIngestStage("upload_transient_head_result", wamId, {
                    key,
                    exists: Boolean(existing?.exists),
                    error: (error as any)?.message || String(error),
                });
                if (!existing?.exists) throw error;

                console.warn(
                    `[WhatsApp Web Bridge] Media upload reported transient failure, but object exists; continuing attachment ingest for ${wamId}.`,
                    { key, error: (error as any)?.message || String(error) }
                );
                return { key, r2Uri: toMediaUri(key) };
            }
        },
    });

    const existingAttachment = typeof dbClient.messageAttachment.findFirst === "function"
        ? await dbClient.messageAttachment.findFirst({
            where: {
                messageId: message.id,
                fileName,
                contentType,
                size,
            },
            orderBy: { createdAt: "desc" },
        }).catch(() => null)
        : null;

    if (existingAttachment?.id) {
        logMediaIngestStage("attachment_create_existing", wamId, {
            attachmentId: existingAttachment.id,
            key: uploaded.key,
        });
    }

    const createdAttachment = existingAttachment || await runWithTransientRetry({
        maxAttempts: maxTransientAttempts,
        backoffMs: transientBackoffMs,
        sleep,
        onRetry: (error, attempt) => {
            logMediaIngestStage("attachment_create_retry", wamId, {
                attempt,
                key: uploaded.key,
                error: (error as any)?.message || String(error),
            });
        },
        work: async () => {
            logMediaIngestStage("attachment_create_start", wamId, { key: uploaded.key });
            try {
                const createdAttachment = await dbClient.messageAttachment.create({
                    data: {
                        messageId: message.id,
                        fileName,
                        contentType,
                        size,
                        url: uploaded.r2Uri,
                    },
                });

                logMediaIngestStage("attachment_create_success", wamId, {
                    attachmentId: createdAttachment.id,
                    key: uploaded.key,
                });
                return createdAttachment;
            } catch (error) {
                if (!isTransientWebBridgeMediaIngestError(error)) throw error;

                const existing = typeof dbClient.messageAttachment.findFirst === "function"
                    ? await dbClient.messageAttachment.findFirst({
                        where: {
                            messageId: message.id,
                            url: uploaded.r2Uri,
                        },
                        orderBy: { createdAt: "desc" },
                    }).catch(() => null)
                    : null;
                logMediaIngestStage("attachment_create_transient_lookup", wamId, {
                    key: uploaded.key,
                    found: Boolean(existing?.id),
                    error: (error as any)?.message || String(error),
                });
                if (existing?.id) return existing;
                throw error;
            }
        },
    });

    if (kind === "audio") {
        void (async () => {
            const queue = params.dependencies?.enqueueAudioTranscription
                ? {
                    initWhatsAppAudioTranscriptionWorker: params.dependencies?.initAudioTranscriptionWorker || (async () => undefined),
                    enqueueWhatsAppAudioTranscription: params.dependencies.enqueueAudioTranscription,
                }
                : await import("@/lib/queue/whatsapp-audio-transcription");

            try {
                await queue.initWhatsAppAudioTranscriptionWorker();
                await queue.enqueueWhatsAppAudioTranscription({
                    locationId: message.conversation.locationId,
                    messageId: message.id,
                    attachmentId: createdAttachment.id,
                });
            } catch (error) {
                console.error(`[WhatsApp Web Bridge] Failed to enqueue audio transcription for ${wamId}:`, error);
            }
        })();
    }

    return { status: "stored" as const, key: uploaded.key };
}
