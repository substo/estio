import db from "@/lib/db";
import { evolutionClient } from "@/lib/evolution/client";
import {
    buildWhatsAppInboundAttachmentKey,
    putWhatsAppMediaObject,
} from "@/lib/whatsapp/media-r2";

export type ParsedEvolutionMessageContent = {
    type: "text" | "image" | "document" | "audio" | "video" | "other";
    body: string;
    media?: {
        kind: "image";
        fileName?: string;
        mimetype?: string;
        fileLength?: number;
        width?: number;
        height?: number;
        caption?: string;
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

export function parseEvolutionMessageContent(message: any): ParsedEvolutionMessageContent {
    const content = unwrapMessageContent(message);

    const text =
        content.conversation ||
        content.extendedTextMessage?.text ||
        content.imageMessage?.caption ||
        "";

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
        return { type: "audio", body: text || "[Audio]" };
    }
    if (content.videoMessage) {
        return { type: "video", body: text || "[Video]" };
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
    const { instanceName, evolutionMessageData, wamId } = params;

    if (!instanceName || !evolutionMessageData || !wamId) return { status: "skipped" as const, reason: "missing_input" };

    const parsed = parseEvolutionMessageContent(evolutionMessageData.message);
    if (parsed.type !== "image") {
        return { status: "skipped" as const, reason: "not_image" };
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
    const contentType = String(mediaRes?.mimetype || parsed.media?.mimetype || "image/jpeg");
    const fileName =
        String(mediaRes?.fileName || parsed.media?.fileName || `${wamId}.jpg`);
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

    await db.messageAttachment.create({
        data: {
            messageId: message.id,
            fileName,
            contentType,
            size,
            url: uploaded.r2Uri,
        },
    });

    return { status: "stored" as const, key: uploaded.key };
}

