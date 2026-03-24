import { randomUUID } from "crypto";
import db from "@/lib/db";
import { enqueueWhatsAppOutboundOutboxJob, initWhatsAppOutboundWorker } from "@/lib/queue/whatsapp-outbound";
import { computeWhatsAppTypingDelay, type WhatsAppTypingDelayResult } from "@/lib/whatsapp/outbound-typing";

type WhatsAppOutboundKind = "text" | "image" | "audio" | "document";

type WhatsAppOutboundAttachmentInput = {
    objectKey: string;
    contentType: string;
    fileName: string;
    size: number;
};

type EnqueueWhatsAppOutboundInput = {
    locationId: string;
    conversationInternalId: string;
    conversationGhlId: string;
    contactId: string;
    body: string;
    kind: WhatsAppOutboundKind;
    source: string;
    clientMessageId?: string | null;
    attachment?: WhatsAppOutboundAttachmentInput;
    caption?: string | null;
};

export type EnqueueWhatsAppOutboundResult = {
    queued: true;
    messageId: string;
    clientMessageId: string;
    outboxJobId: string;
    scheduledAt: string;
    typing: WhatsAppTypingDelayResult;
    queueAccepted: boolean;
};

function normalizeClientMessageId(value?: string | null): string {
    const trimmed = String(value || "").trim();
    if (trimmed) return trimmed;
    return `cmid_${randomUUID()}`;
}

function normalizeBody(value: string): string {
    return String(value || "").trim();
}

function extractUniqueErrorColumns(error: any): string {
    const target = (error as any)?.meta?.target;
    if (Array.isArray(target)) return target.join(",");
    return String(target || "");
}

async function tryResolveExistingByClientMessageId(clientMessageId: string): Promise<EnqueueWhatsAppOutboundResult | null> {
    if (!clientMessageId) return null;

    const existing = await (db as any).message.findUnique({
        where: { clientMessageId },
        include: {
            outboundWhatsAppOutbox: {
                select: {
                    id: true,
                    scheduledAt: true,
                    payload: true,
                },
            },
        },
    });

    if (!existing?.id || !existing?.outboundWhatsAppOutbox?.id) return null;

    return {
        queued: true,
        messageId: String(existing.id),
        clientMessageId,
        outboxJobId: String(existing.outboundWhatsAppOutbox.id),
        scheduledAt: new Date(existing.outboundWhatsAppOutbox.scheduledAt || new Date()).toISOString(),
        typing: {
            delayMs: Number((existing.outboundWhatsAppOutbox.payload || {})?.initialTypingDelayMs || 0),
            reason: "length_based",
            snapshot: (existing.outboundWhatsAppOutbox.payload || {})?.typingPolicySnapshot || {},
        },
        queueAccepted: true,
    };
}

export async function enqueueWhatsAppOutbound(input: EnqueueWhatsAppOutboundInput): Promise<EnqueueWhatsAppOutboundResult> {
    const locationId = String(input.locationId || "").trim();
    const conversationInternalId = String(input.conversationInternalId || "").trim();
    const conversationGhlId = String(input.conversationGhlId || "").trim();
    const contactId = String(input.contactId || "").trim();
    const source = String(input.source || "app_user").trim() || "app_user";
    const kind = input.kind;
    const normalizedBody = normalizeBody(input.body);
    const clientMessageId = normalizeClientMessageId(input.clientMessageId);

    if (!locationId || !conversationInternalId || !conversationGhlId || !contactId) {
        throw new Error("Missing required WhatsApp enqueue identifiers.");
    }
    if (!normalizedBody) {
        throw new Error("Cannot queue an empty WhatsApp message.");
    }

    const attachment = input.attachment;
    if (kind !== "text") {
        if (!attachment?.objectKey || !attachment?.contentType || !attachment?.fileName) {
            throw new Error("Missing media attachment metadata for WhatsApp outbound enqueue.");
        }
    }

    const messageCreatedAt = new Date();

    let txResult: {
        messageId: string;
        outboxId: string;
        scheduledAt: Date;
        typing: WhatsAppTypingDelayResult;
    };

    try {
        txResult = await db.$transaction(async (tx) => {
            const lastInbound = await tx.message.findFirst({
                where: {
                    conversationId: conversationInternalId,
                    direction: "inbound",
                },
                orderBy: [{ createdAt: "desc" }, { id: "desc" }],
                select: { createdAt: true },
            });

            const typing = computeWhatsAppTypingDelay({
                body: normalizedBody,
                messageCreatedAt,
                lastInboundMessageAt: lastInbound?.createdAt || null,
                isRetryAttempt: false,
            });

            const scheduledAt = new Date(messageCreatedAt.getTime() + Math.max(typing.delayMs, 0));
            const idempotencyKey = `wa_outbox:${locationId}:${conversationInternalId}:${clientMessageId}`;

            const message = await (tx as any).message.create({
                data: {
                    conversationId: conversationInternalId,
                    body: normalizedBody,
                    type: "TYPE_WHATSAPP",
                    direction: "outbound",
                    status: "sending",
                    source,
                    clientMessageId,
                    createdAt: messageCreatedAt,
                    updatedAt: messageCreatedAt,
                    ...(attachment ? {
                        attachments: {
                            create: [
                                {
                                    fileName: attachment.fileName,
                                    contentType: attachment.contentType,
                                    size: Number(attachment.size || 0),
                                    url: `r2://${attachment.objectKey}`,
                                },
                            ],
                        },
                    } : {}),
                },
                select: { id: true },
            });

            const outbox = await (tx as any).whatsAppOutboundOutbox.create({
                data: {
                    messageId: message.id,
                    conversationId: conversationInternalId,
                    contactId,
                    locationId,
                    transport: "evolution",
                    kind,
                    scheduledAt,
                    idempotencyKey,
                    payload: {
                        text: kind === "text" ? normalizedBody : undefined,
                        caption: input.caption ? String(input.caption) : undefined,
                        objectKey: attachment?.objectKey,
                        contentType: attachment?.contentType,
                        fileName: attachment?.fileName,
                        mediaSize: attachment?.size,
                        messageCreatedAt: messageCreatedAt.toISOString(),
                        typingPolicySnapshot: typing.snapshot,
                        typingDelayReason: typing.reason,
                        initialTypingDelayMs: typing.delayMs,
                        clientMessageId,
                        conversationGhlId,
                    },
                },
                select: {
                    id: true,
                    scheduledAt: true,
                },
            });

            return {
                messageId: String(message.id),
                outboxId: String(outbox.id),
                scheduledAt: new Date(outbox.scheduledAt),
                typing,
            };
        });
    } catch (error: any) {
        const uniqueTarget = extractUniqueErrorColumns(error);
        if ((error as any)?.code === "P2002" && uniqueTarget.includes("clientMessageId")) {
            const existing = await tryResolveExistingByClientMessageId(clientMessageId);
            if (existing) return existing;
        }
        throw error;
    }

    const enqueueDelayMs = Math.max(txResult.scheduledAt.getTime() - Date.now(), 0);
    let queueAccepted = false;

    try {
        await initWhatsAppOutboundWorker();
    } catch (workerError) {
        console.warn("[WhatsApp Outbox] Worker init failed during enqueue; cron sweeper will recover:", workerError);
    }

    try {
        const queueRes = await enqueueWhatsAppOutboundOutboxJob({
            outboxId: txResult.outboxId,
            delayMs: enqueueDelayMs,
        });
        queueAccepted = !!queueRes.accepted;
    } catch (queueError) {
        console.warn("[WhatsApp Outbox] Queue add failed during enqueue; cron sweeper will recover:", queueError);
    }

    return {
        queued: true,
        messageId: txResult.messageId,
        clientMessageId,
        outboxJobId: txResult.outboxId,
        scheduledAt: txResult.scheduledAt.toISOString(),
        typing: txResult.typing,
        queueAccepted,
    };
}
