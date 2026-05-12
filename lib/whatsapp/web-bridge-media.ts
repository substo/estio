import db from "@/lib/db";
import {
    buildWhatsAppInboundAttachmentKey,
    putWhatsAppMediaObject,
    sanitizeWhatsAppMediaFilename,
} from "@/lib/whatsapp/media-r2";

function normalizeBridgeMediaType(type: string | null | undefined): "image" | "audio" | "document" | null {
    const value = String(type || "").toLowerCase();
    if (value === "image" || value.startsWith("image/")) return "image";
    if (value === "audio" || value === "ptt" || value.startsWith("audio/")) return "audio";
    if (value === "document" || value.startsWith("application/") || value.startsWith("text/")) return "document";
    return null;
}

function fallbackContentType(kind: "image" | "audio" | "document") {
    if (kind === "image") return "image/jpeg";
    if (kind === "audio") return "audio/ogg";
    return "application/octet-stream";
}

function decodeBase64Payload(value: string) {
    const trimmed = String(value || "").trim();
    const comma = trimmed.indexOf(",");
    const base64 = trimmed.startsWith("data:") && comma >= 0 ? trimmed.slice(comma + 1) : trimmed;
    return Buffer.from(base64, "base64");
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

    const buffer = decodeBase64Payload(base64);
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
