import db from "@/lib/db";
import { evolutionClient } from "@/lib/evolution/client";
import {
    buildWhatsAppInboundAttachmentKey,
    putWhatsAppMediaObject,
    sanitizeWhatsAppMediaFilename,
} from "@/lib/whatsapp/media-r2";

export type SharedContactInfo = {
    displayName: string;
    phoneNumber?: string;
    organization?: string;
    email?: string;
    rawVcard?: string;
};

export type ParsedEvolutionMessageContent = {
    type: "text" | "image" | "document" | "audio" | "video" | "sticker" | "reaction" | "contact" | "other";
    body: string;
    media?: {
        kind: "image" | "audio" | "document";
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
    contacts?: SharedContactInfo[];
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

/**
 * Lightweight vCard 3.0 parser — extracts key fields from a vCard string.
 * Handles the line-based format without requiring an npm dependency.
 */
function parseVcard(vcard: string): SharedContactInfo {
    const lines = vcard.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    let displayName = "";
    let phoneNumber: string | undefined;
    let organization: string | undefined;
    let email: string | undefined;

    for (const line of lines) {
        const upper = line.toUpperCase();

        // Full Name (FN:John Doe)
        if (upper.startsWith("FN:") || upper.startsWith("FN;")) {
            displayName = line.slice(line.indexOf(":") + 1).trim();
        }
        // Telephone (TEL;TYPE=CELL:5511888888888 or TEL:...)
        else if (upper.startsWith("TEL") && line.includes(":")) {
            const raw = line.slice(line.indexOf(":") + 1).trim();
            if (raw && !phoneNumber) {
                // Normalize: keep digits and leading +
                phoneNumber = raw.replace(/[^\d+]/g, "");
                if (phoneNumber && !phoneNumber.startsWith("+")) {
                    phoneNumber = `+${phoneNumber}`;
                }
            }
        }
        // Organization (ORG:Company Name; or ORG:Company)
        else if (upper.startsWith("ORG:") || upper.startsWith("ORG;")) {
            organization = line.slice(line.indexOf(":") + 1).replace(/;+$/, "").trim() || undefined;
        }
        // Email (EMAIL:..., EMAIL;TYPE=INTERNET:...)
        else if (upper.startsWith("EMAIL") && line.includes(":")) {
            const raw = line.slice(line.indexOf(":") + 1).trim();
            if (raw && !email) {
                email = raw;
            }
        }
    }

    // Fallback: if FN was empty, try N field
    if (!displayName) {
        for (const line of lines) {
            if (line.toUpperCase().startsWith("N:") || line.toUpperCase().startsWith("N;")) {
                const parts = line.slice(line.indexOf(":") + 1).split(";").map(s => s.trim()).filter(Boolean);
                displayName = parts.join(" ");
                break;
            }
        }
    }

    return {
        displayName: displayName || "Unknown Contact",
        phoneNumber: phoneNumber || undefined,
        organization: organization || undefined,
        email: email || undefined,
        rawVcard: vcard,
    };
}

/**
 * Parse a single contactMessage payload into a SharedContactInfo.
 */
function parseContactMessage(contactMsg: any): SharedContactInfo | null {
    if (!contactMsg) return null;

    const vcard = typeof contactMsg.vcard === "string" ? contactMsg.vcard : "";
    const displayName = typeof contactMsg.displayName === "string" ? contactMsg.displayName.trim() : "";

    if (vcard) {
        const parsed = parseVcard(vcard);
        // Prefer displayName from the contactMessage over vCard FN
        if (displayName) parsed.displayName = displayName;
        return parsed;
    }

    if (displayName) {
        return { displayName };
    }

    return null;
}

/**
 * Build a human-readable body and structured data suffix for contact messages.
 * Format: "📇 Contact: Name (+phone)\n---CONTACTS_DATA---\n[{...}]"
 */
function buildContactMessageBody(contacts: SharedContactInfo[]): string {
    if (contacts.length === 0) return "[Contact]";

    // Human-readable prefix
    let readable: string;
    if (contacts.length === 1) {
        const c = contacts[0];
        const phonePart = c.phoneNumber ? ` (${c.phoneNumber})` : "";
        readable = `📇 Contact: ${c.displayName}${phonePart}`;
    } else {
        const names = contacts.map(c => c.displayName).join(", ");
        readable = `📇 ${contacts.length} Contacts: ${names}`;
    }

    // Strip rawVcard from the serialized data to keep body size reasonable
    const serializable = contacts.map(({ rawVcard: _rv, ...rest }) => rest);
    return `${readable}\n---CONTACTS_DATA---\n${JSON.stringify(serializable)}`;
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
        const doc = content.documentMessage;
        return {
            type: "document",
            body: text || "[Document]",
            media: {
                kind: "document",
                fileName: doc.fileName,
                mimetype: doc.mimetype,
                fileLength: Number(String(doc.fileLength || "0")) || undefined,
                caption: doc.caption,
            },
        };
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

    // --- Contact Message (single vCard) ---
    if (content.contactMessage) {
        const parsed = parseContactMessage(content.contactMessage);
        if (parsed) {
            const contacts = [parsed];
            return {
                type: "contact",
                body: buildContactMessageBody(contacts),
                contacts,
            };
        }
    }

    // --- Contact Array Message (multiple vCards) ---
    if (content.contactsArrayMessage) {
        const arr = content.contactsArrayMessage;
        const rawContacts: any[] = Array.isArray(arr.contacts) ? arr.contacts : [];
        const contacts: SharedContactInfo[] = [];

        for (const entry of rawContacts) {
            const parsed = parseContactMessage(entry);
            if (parsed) contacts.push(parsed);
        }

        if (contacts.length > 0) {
            return {
                type: "contact",
                body: buildContactMessageBody(contacts),
                contacts,
            };
        }
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
    if (parsed.type !== "image" && parsed.type !== "audio" && parsed.type !== "document") {
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
    const fallbackContentType = parsed.type === "audio" ? "audio/ogg" : parsed.type === "document" ? "application/octet-stream" : "image/jpeg";
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
