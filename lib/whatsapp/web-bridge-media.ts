import db from "@/lib/db";
import {
    buildWhatsAppInboundAttachmentKey,
    putWhatsAppMediaObject,
    sanitizeWhatsAppMediaFilename,
} from "@/lib/whatsapp/media-r2";

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

export async function ingestWhatsAppWebBridgeMediaAttachment(params: {
    wamId: string;
    media: {
        data?: string | null;
        mimetype?: string | null;
        filename?: string | null;
        size?: number | null;
    };
    messageType?: string | null;
}) {
    const wamId = String(params.wamId || "").trim();
    const base64 = String(params.media?.data || "").trim();
    if (!wamId || !base64) return { status: "skipped" as const, reason: "missing_input" };

    const kind = normalizeBridgeMediaType(params.media?.mimetype || params.messageType);
    if (!kind) return { status: "skipped" as const, reason: "unsupported_media_type" };

    const message = await db.message.findFirst({
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
    const size = Number(params.media?.size || buffer.length) || buffer.length;

    const key = buildWhatsAppInboundAttachmentKey({
        locationId: message.conversation.locationId,
        contactId: message.conversation.contactId,
        conversationId: message.conversation.id,
        messageId: message.id,
        fileName,
        contentType,
    });

    const uploaded = await putWhatsAppMediaObject({
        key,
        body: buffer,
        contentType,
        contentLength: size,
    });

    const createdAttachment = await db.messageAttachment.create({
        data: {
            messageId: message.id,
            fileName,
            contentType,
            size,
            url: uploaded.r2Uri,
        },
    });

    if (kind === "audio") {
        void (async () => {
            const {
                enqueueWhatsAppAudioTranscription,
                initWhatsAppAudioTranscriptionWorker,
            } = await import("@/lib/queue/whatsapp-audio-transcription");

            try {
                await initWhatsAppAudioTranscriptionWorker();
                await enqueueWhatsAppAudioTranscription({
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
