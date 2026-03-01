import db from "@/lib/db";
import { evolutionClient } from "@/lib/evolution/client";
import {
    buildWhatsAppInboundAttachmentKey,
    putWhatsAppMediaObject,
    sanitizeWhatsAppMediaFilename,
} from "@/lib/whatsapp/media-r2";

export type ParsedEvolutionMessageContent = {
    type: "text" | "image" | "document" | "audio" | "video" | "sticker" | "reaction" | "other";
    body: string;
    media?: {
        kind: "image" | "audio";
        fileName?: string;
        mimetype?: string;
        fileLength?: number;
        width?: number;
        height?: number;
        caption?: string;
        seconds?: number;
        ptt?: boolean;
    };
    reaction?: {
        emoji?: string;
        removed?: boolean;
        targetMessageId?: string;
        targetRemoteJid?: string;
        targetParticipant?: string;
    };
    sticker?: {
        emoji?: string;
        mimetype?: string;
        fileLength?: number;
        isAnimated?: boolean;
    };
};

function unwrapMessageContent(message: any) {
    let current = message;
    let safety = 0;

    while (current && safety < 8) {
        safety += 1;

        if (current.ephemeralMessage?.message) {
            current = current.ephemeralMessage.message;
            continue;
        }
        if (current.viewOnceMessage?.message) {
            current = current.viewOnceMessage.message;
            continue;
        }
        if (current.viewOnceMessageV2?.message) {
            current = current.viewOnceMessageV2.message;
            continue;
        }
        if (current.viewOnceMessageV2Extension?.message) {
            current = current.viewOnceMessageV2Extension.message;
            continue;
        }
        break;
    }

    return current || {};
}

function pickFirstNonEmptyString(...values: unknown[]) {
    for (const value of values) {
        if (typeof value !== "string") continue;
        const trimmed = value.trim();
        if (trimmed) return value;
    }
    return "";
}

export function parseEvolutionMessageContent(message: any): ParsedEvolutionMessageContent {
    const content = unwrapMessageContent(message);

    const text = pickFirstNonEmptyString(
        content.conversation,
        content.extendedTextMessage?.text,
        content.imageMessage?.caption,
        content.videoMessage?.caption,
        content.documentMessage?.caption,
        content.buttonsResponseMessage?.selectedDisplayText,
        content.templateButtonReplyMessage?.selectedDisplayText,
        content.listResponseMessage?.title,
    );

    if (content.imageMessage) {
        const image = content.imageMessage;
        return {
            type: "image",
            body: text || "[Image]",
            media: {
                kind: "image",
                fileName: image.fileName,
                mimetype: image.mimetype,
                fileLength: Number(String(image.fileLength || "0")) || undefined,
                width: typeof image.width === "number" ? image.width : undefined,
                height: typeof image.height === "number" ? image.height : undefined,
                caption: image.caption,
            },
        };
    }

    if (content.documentMessage) {
        return { type: "document", body: text || "[Document]" };
    }
    if (content.audioMessage) {
        const audio = content.audioMessage;
        return {
            type: "audio",
            body: text || "[Audio]",
            media: {
                kind: "audio",
                fileName: audio.fileName,
                mimetype: audio.mimetype,
                fileLength: Number(String(audio.fileLength || "0")) || undefined,
                seconds: Number(String(audio.seconds || "0")) || undefined,
                ptt: typeof audio.ptt === "boolean" ? audio.ptt : undefined,
            },
        };
    }
    if (content.videoMessage) {
        return { type: "video", body: text || "[Video]" };
    }

    if (content.stickerMessage) {
        const sticker = content.stickerMessage;
        const stickerEmoji = typeof sticker.emoji === "string" && sticker.emoji.trim() ? sticker.emoji : undefined;
        return {
            type: "sticker",
            body: stickerEmoji ? `Sticker: ${stickerEmoji}` : "[Sticker]",
            sticker: {
                emoji: stickerEmoji,
                mimetype: typeof sticker.mimetype === "string" ? sticker.mimetype : undefined,
                fileLength: Number(String(sticker.fileLength || "0")) || undefined,
                isAnimated: typeof sticker.isAnimated === "boolean" ? sticker.isAnimated : undefined,
            },
        };
    }

    if (content.reactionMessage) {
        const reaction = content.reactionMessage;
        const emoji = typeof reaction.text === "string" ? reaction.text.trim() : "";
        const removed = emoji.length === 0;

        return {
            type: "reaction",
            body: removed ? "[Reaction removed]" : `Reaction: ${emoji}`,
            reaction: {
                emoji: emoji || undefined,
                removed,
                targetMessageId: typeof reaction.key?.id === "string" ? reaction.key.id : undefined,
                targetRemoteJid: typeof reaction.key?.remoteJid === "string" ? reaction.key.remoteJid : undefined,
                targetParticipant: typeof reaction.key?.participant === "string" ? reaction.key.participant : undefined,
            },
        };
    }

    // Some versions/features may only expose the encrypted reaction wrapper.
    if (content.encReactionMessage) {
        return { type: "reaction", body: "[Reaction]" };
    }

    if (text) {
        return { type: "text", body: text };
    }

    return { type: "other", body: "[Media]" };
}

function decodeBase64Payload(base64: string) {
    const cleaned = base64.includes(",") ? base64.slice(base64.indexOf(",") + 1) : base64;
    return Buffer.from(cleaned, "base64");
}

export async function ingestEvolutionImageAttachment(params: {
    instanceName: string;
    evolutionMessageData: any;
    wamId: string;
}) {
    const parsed = parseEvolutionMessageContent(params.evolutionMessageData?.message);
    if (parsed.type !== "image") {
        return { status: "skipped" as const, reason: "not_image" };
    }

    return ingestEvolutionMediaAttachment(params);
}

export async function ingestEvolutionMediaAttachment(params: {
    instanceName: string;
    evolutionMessageData: any;
    wamId: string;
}) {
    const { instanceName, evolutionMessageData, wamId } = params;

    if (!instanceName || !evolutionMessageData || !wamId) return { status: "skipped" as const, reason: "missing_input" };

    const parsed = parseEvolutionMessageContent(evolutionMessageData.message);
    if (parsed.type !== "image" && parsed.type !== "audio") {
        return { status: "skipped" as const, reason: "unsupported_media_type" };
    }

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

    if (!message) {
        return { status: "skipped" as const, reason: "message_not_found" };
    }

    if (message.attachments.length > 0) {
        return { status: "skipped" as const, reason: "attachment_exists" };
    }

    const mediaRes = await evolutionClient.getBase64FromMediaMessage(instanceName, evolutionMessageData);
    const base64 = String(mediaRes?.base64 || "");
    if (!base64) {
        return { status: "skipped" as const, reason: "missing_base64" };
    }

    const buffer = decodeBase64Payload(base64);
    const fallbackContentType = parsed.type === "audio" ? "audio/ogg" : "image/jpeg";
    const contentType = String(mediaRes?.mimetype || parsed.media?.mimetype || fallbackContentType);
    const fileName = String(
        mediaRes?.fileName ||
        parsed.media?.fileName ||
        sanitizeWhatsAppMediaFilename(wamId, contentType)
    );
    const size =
        Number(String(mediaRes?.size?.fileLength || mediaRes?.fileLength || parsed.media?.fileLength || buffer.length)) ||
        buffer.length;

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

    if (parsed.type === "audio") {
        void (async () => {
            const {
                enqueueWhatsAppAudioTranscription,
                initWhatsAppAudioTranscriptionWorker,
            } = await import("@/lib/queue/whatsapp-audio-transcription");

            try {
                await initWhatsAppAudioTranscriptionWorker();
            } catch (error) {
                console.warn(`[WhatsApp Audio] Worker init failed for ${wamId}, continuing with enqueue fallback:`, error);
            }

            try {
                await enqueueWhatsAppAudioTranscription({
                    locationId: message.conversation.locationId,
                    messageId: message.id,
                    attachmentId: createdAttachment.id,
                });
            } catch (error) {
                console.error(`[WhatsApp Audio] Failed to enqueue transcription for ${wamId}:`, error);
            }
        })();
    }

    return { status: "stored" as const, key: uploaded.key };
}
