import db from "@/lib/db";
import { publishConversationRealtimeEvent } from "@/lib/realtime/conversation-events";
import { updateConversationLastMessage } from "@/lib/conversations/update";
import { enqueueGhlMessageMirror } from "@/lib/integrations/provider-outbox-enqueue";
import { Prisma } from "@prisma/client";
import { dispatchWhatsAppOutbound } from "@/lib/whatsapp/outbound-dispatch";
import { classifyOutboundSendFailure } from "@/lib/conversations/outbound-send-failure";

const MAX_OUTBOX_ATTEMPTS = Math.max(Number(process.env.WHATSAPP_OUTBOX_MAX_ATTEMPTS || 6), 1);
const STALE_PROCESSING_LOCK_MS = Math.max(Number(process.env.WHATSAPP_OUTBOX_STALE_LOCK_MS || 5 * 60 * 1000), 60_000);

export type WhatsAppOutboundOutboxProcessOutcome = "success" | "failed" | "dead" | "skipped";

export type WhatsAppOutboundOutboxProcessResult = {
    outcome: WhatsAppOutboundOutboxProcessOutcome;
    requeueDelayMs?: number;
    error?: string;
};

function normalizeError(error: unknown): string {
    if (error instanceof Error) return error.message;
    try {
        return JSON.stringify(error);
    } catch {
        return String(error);
    }
}

function computeBackoffMs(attemptCount: number): number {
    const exponent = Math.max(0, attemptCount - 1);
    const baseSeconds = Math.min(30 * 60, Math.pow(2, exponent) * 15);
    const jitter = 0.85 + (Math.random() * 0.3);
    return Math.round(baseSeconds * 1000 * jitter);
}

function isRetryableOutboundError(error: unknown): boolean {
    const classification = classifyOutboundSendFailure(error);
    if (classification.code === "WHATSAPP_NUMBER_NOT_FOUND") return false;

    const explicitRetryable = (error as any)?.providerClassification?.retryable;
    if (typeof explicitRetryable === "boolean") return explicitRetryable;

    const status = Number((error as any)?.response?.status || (error as any)?.status || 0);
    if (status === 408 || status === 409 || status === 425 || status === 429 || status >= 500) {
        return true;
    }
    if (status >= 400 && status < 500) {
        return false;
    }

    const code = String((error as any)?.code || (error as any)?.cause?.code || "");
    if (["ECONNABORTED", "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN"].includes(code)) {
        return true;
    }

    return status <= 0;
}

function isUniqueConstraintError(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function queueSuccessfulOutboundProviderMirrors(args: {
    locationId: string;
    conversationId: string;
    messageId: string;
    contactId: string;
    body: string;
}) {
    try {
        await enqueueGhlMessageMirror({
            locationId: args.locationId,
            conversationId: args.conversationId,
            messageId: args.messageId,
            contactId: args.contactId,
            payload: { body: args.body, source: "whatsapp_outbound" },
        });
    } catch (error) {
        console.error("[WhatsApp Outbox] Failed to enqueue provider mirror:", error);
    }
}

export async function processWhatsAppOutboundOutboxJob(args: {
    outboxId: string;
    workerId: string;
}): Promise<WhatsAppOutboundOutboxProcessResult> {
    const outboxId = String(args.outboxId || "").trim();
    if (!outboxId) return { outcome: "skipped", error: "Missing outbox id." };

    const now = new Date();
    const lockClaim = await (db as any).whatsAppOutboundOutbox.updateMany({
        where: {
            id: outboxId,
            status: { in: ["pending", "failed"] },
            scheduledAt: { lte: now },
        },
        data: {
            status: "processing",
            lockedAt: now,
            lockedBy: args.workerId,
        },
    });

    if (!Number(lockClaim?.count || 0)) {
        return { outcome: "skipped" };
    }

    const row = await (db as any).whatsAppOutboundOutbox.findUnique({
        where: { id: outboxId },
        include: {
            message: true,
            conversation: true,
            contact: true,
            location: true,
        },
    });

    if (!row) {
        return { outcome: "skipped", error: "Outbox row no longer exists." };
    }

    const payload = (row.payload || {}) as any;
    const attemptCount = Number(row.attemptCount || 0) + 1;

    try {
        const { transport, provider, providerAccountId, wamId } = await dispatchWhatsAppOutbound(row);

        const messageStatus = "sent";
        try {
            await (db as any).message.update({
                where: { id: row.messageId },
                data: {
                    wamId,
                    ghlMessageId: wamId,
                    status: messageStatus,
                    updatedAt: new Date(),
                },
            });
        } catch (error) {
            if (!isUniqueConstraintError(error)) throw error;

            const existingByWam = await db.message.findUnique({
                where: { wamId },
                select: { id: true },
            });
            if (!existingByWam?.id) throw error;

            await db.message.update({
                where: { id: row.messageId },
                data: {
                    status: messageStatus,
                    updatedAt: new Date(),
                },
            }).catch(() => undefined);
        }

        await (db as any).whatsAppOutboundOutbox.update({
            where: { id: row.id },
            data: {
                status: "completed",
                processedAt: new Date(),
                attemptCount,
                lastError: null,
                lockedAt: null,
                lockedBy: null,
            },
        });

        await (db as any).messageSync.upsert({
            where: {
                messageId_provider_providerAccountId: {
                    messageId: row.messageId,
                    provider,
                    providerAccountId,
                },
            },
            create: {
                messageId: row.messageId,
                conversationId: row.conversationId,
                locationId: row.locationId,
                provider,
                providerAccountId,
                providerMessageId: wamId,
                providerThreadId: row.conversation?.ghlConversationId || row.conversationId,
                status: "synced",
                remoteUpdatedAt: new Date(),
                lastSyncedAt: new Date(),
                metadata: {
                    transport,
                    pricingIntent: payload?.pricingIntent || null,
                    templateName: payload?.templateName || null,
                    templateLanguage: payload?.templateLanguage || null,
                    templateCategory: payload?.templateCategory || null,
                },
            },
            update: {
                providerMessageId: wamId,
                providerThreadId: row.conversation?.ghlConversationId || row.conversationId,
                status: "synced",
                remoteUpdatedAt: new Date(),
                lastSyncedAt: new Date(),
                lastError: null,
                metadata: {
                    transport,
                    pricingIntent: payload?.pricingIntent || null,
                    templateName: payload?.templateName || null,
                    templateLanguage: payload?.templateLanguage || null,
                    templateCategory: payload?.templateCategory || null,
                },
            },
        }).catch((err: any) => {
            console.error(`[WhatsApp Outbox] Failed to persist ${provider} message sync:`, err);
        });

        await updateConversationLastMessage({
            conversationId: row.conversationId,
            messageBody: String(row.message?.body || ""),
            messageType: "TYPE_WHATSAPP",
            messageDate: row.message?.createdAt || new Date(),
            direction: "outbound",
        }).catch((err) => {
            console.error("[WhatsApp Outbox] Failed to update conversation summary:", err);
        });

        void queueSuccessfulOutboundProviderMirrors({
            locationId: row.locationId,
            conversationId: row.conversationId,
            messageId: row.messageId,
            contactId: row.contactId,
            body: String(row.message?.body || ""),
        });

        const outboundPayload = {
            channel: "whatsapp",
            mode: row.kind,
            messageId: row.messageId,
            clientMessageId: row.message?.clientMessageId || null,
            wamId,
            status: "sent",
        };

        void publishConversationRealtimeEvent({
            locationId: row.locationId,
            conversationId: row.conversationId || null,
            type: "message.outbound",
            payload: outboundPayload,
        });

        void publishConversationRealtimeEvent({
            locationId: row.locationId,
            conversationId: row.conversationId || null,
            type: "message.status",
            payload: outboundPayload,
        });

        return { outcome: "success" };
    } catch (error) {
        const message = normalizeError(error);
        const retryable = isRetryableOutboundError(error);
        const canRetry = retryable && attemptCount < MAX_OUTBOX_ATTEMPTS;

        if (canRetry) {
            const backoffMs = computeBackoffMs(attemptCount);
            await (db as any).whatsAppOutboundOutbox.update({
                where: { id: row.id },
                data: {
                    status: "failed",
                    attemptCount,
                    lastError: message,
                    scheduledAt: new Date(Date.now() + backoffMs),
                    lockedAt: null,
                    lockedBy: null,
                },
            });
            return {
                outcome: "failed",
                requeueDelayMs: backoffMs,
                error: message,
            };
        }

        await (db as any).whatsAppOutboundOutbox.update({
            where: { id: row.id },
            data: {
                status: "dead",
                processedAt: new Date(),
                attemptCount,
                lastError: message,
                lockedAt: null,
                lockedBy: null,
            },
        });

        await db.message.update({
            where: { id: row.messageId },
            data: {
                status: "failed",
                updatedAt: new Date(),
            },
        }).catch(() => undefined);

        const failurePayload = {
            channel: "whatsapp",
            mode: row.kind,
            messageId: row.messageId,
            clientMessageId: row.message?.clientMessageId || null,
            wamId: row.message?.wamId || null,
            status: "failed",
        };

        void publishConversationRealtimeEvent({
            locationId: row.locationId,
            conversationId: row.conversation?.id || row.conversationId,
            type: "message.status",
            payload: failurePayload,
        });

        return { outcome: "dead", error: message };
    }
}

export async function recoverStaleWhatsAppOutboundOutboxLocks() {
    const staleBefore = new Date(Date.now() - STALE_PROCESSING_LOCK_MS);
    const now = new Date();
    const recovered = await (db as any).whatsAppOutboundOutbox.updateMany({
        where: {
            status: "processing",
            lockedAt: { lt: staleBefore },
        },
        data: {
            status: "failed",
            lockedAt: null,
            lockedBy: null,
            scheduledAt: now,
            lastError: "Recovered stale processing lock; re-queued.",
        },
    });
    return Number(recovered?.count || 0);
}

export async function listDueWhatsAppOutboundOutboxIds(limit = 200): Promise<string[]> {
    const rows = await (db as any).whatsAppOutboundOutbox.findMany({
        where: {
            status: { in: ["pending", "failed"] },
            scheduledAt: { lte: new Date() },
        },
        orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }],
        take: Math.max(1, Math.min(Number(limit || 200), 1000)),
        select: { id: true },
    });
    return rows.map((row: any) => String(row.id));
}
