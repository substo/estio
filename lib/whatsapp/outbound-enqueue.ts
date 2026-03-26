import { randomUUID } from "crypto";
import db from "@/lib/db";
import { enqueueWhatsAppOutboundOutboxJob, initWhatsAppOutboundWorker } from "@/lib/queue/whatsapp-outbound";
import { computeWhatsAppTypingDelay, type WhatsAppTypingDelayResult } from "@/lib/whatsapp/outbound-typing";
import { processWhatsAppOutboundOutboxJob } from "@/lib/whatsapp/outbound-outbox";

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
    dispatchMode: "queued" | "inline_fallback_sent" | "inline_fallback_deferred";
    warning?: string;
    errorCode?: "queue_enqueue_failed" | "inline_dispatch_failed";
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

function normalizeErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    try {
        return JSON.stringify(error);
    } catch {
        return String(error);
    }
}

async function markOutboxQueueDegraded(outboxId: string, message: string) {
    const normalizedOutboxId = String(outboxId || "").trim();
    if (!normalizedOutboxId) return;

    const normalizedMessage = String(message || "").trim();
    if (!normalizedMessage) return;

    const safeMessage = normalizedMessage.slice(0, 2000);
    try {
        await (db as any).whatsAppOutboundOutbox.updateMany({
            where: {
                id: normalizedOutboxId,
                status: { in: ["pending", "failed"] },
            },
            data: {
                lastError: safeMessage,
            },
        });
    } catch (error) {
        console.warn("[WhatsApp Outbox] Failed to persist enqueue degradation metadata:", error);
    }
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
        dispatchMode: "queued",
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
    let dispatchMode: EnqueueWhatsAppOutboundResult["dispatchMode"] = "queued";
    let warning: string | undefined;
    let errorCode: EnqueueWhatsAppOutboundResult["errorCode"] | undefined;
    let queueDegradedMessage: string | null = null;

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
        if (!queueAccepted) {
            queueDegradedMessage = `Queue rejected enqueue request (${String((queueRes as any)?.reason || "unknown_reason")}).`;
        }
    } catch (queueError) {
        console.warn("[WhatsApp Outbox] Queue add failed during enqueue; cron sweeper will recover:", queueError);
        queueDegradedMessage = normalizeErrorMessage(queueError);
    }

    if (!queueAccepted) {
        dispatchMode = "inline_fallback_deferred";
        errorCode = "queue_enqueue_failed";

        const queueErrorDetail = queueDegradedMessage || "Queue did not accept outbound enqueue.";
        await markOutboxQueueDegraded(
            txResult.outboxId,
            `[enqueue_degraded] Queue enqueue failed: ${queueErrorDetail}`
        );

        try {
            const inlineResult = await processWhatsAppOutboundOutboxJob({
                outboxId: txResult.outboxId,
                workerId: `wa_outbound_inline_${randomUUID()}`,
            });

            if (inlineResult.outcome === "success") {
                dispatchMode = "inline_fallback_sent";
                warning = "Queue enqueue degraded; bypassed typing delay and dispatched immediately via inline fallback.";
            } else {
                dispatchMode = "inline_fallback_deferred";
                warning = "Queue enqueue degraded; inline fallback did not complete send. Durable retry remains active.";
                if (inlineResult.outcome === "dead") {
                    errorCode = "inline_dispatch_failed";
                }

                if (inlineResult.error) {
                    await markOutboxQueueDegraded(
                        txResult.outboxId,
                        `[enqueue_degraded] Inline fallback outcome=${inlineResult.outcome}: ${inlineResult.error}`
                    );
                }
            }
        } catch (inlineError) {
            errorCode = "inline_dispatch_failed";
            warning = "Queue enqueue degraded; inline fallback errored. Durable retry remains active.";
            await markOutboxQueueDegraded(
                txResult.outboxId,
                `[enqueue_degraded] Inline fallback error: ${normalizeErrorMessage(inlineError)}`
            );
        }
    }

    return {
        queued: true,
        messageId: txResult.messageId,
        clientMessageId,
        outboxJobId: txResult.outboxId,
        scheduledAt: txResult.scheduledAt.toISOString(),
        typing: txResult.typing,
        queueAccepted,
        dispatchMode,
        ...(warning ? { warning } : {}),
        ...(errorCode ? { errorCode } : {}),
    };
}
