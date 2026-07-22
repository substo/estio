import db from "@/lib/db";
import { publishConversationRealtimeEvent } from "@/lib/realtime/conversation-events";
import { updateConversationLastMessage } from "@/lib/conversations/update";
import { enqueueGhlMessageMirror } from "@/lib/integrations/provider-outbox-enqueue";
import { Prisma } from "@prisma/client";
import { dispatchWhatsAppOutbound } from "@/lib/whatsapp/outbound-dispatch";
import { classifyOutboundSendFailure } from "@/lib/conversations/outbound-send-failure";
import { isDeviceEgressOfflineError } from "@/lib/device-tunnel/status";
import { isWhatsAppWebBridgeDeliveryUnconfirmedError } from "@/lib/whatsapp/web-bridge-send";
import {
    buildWhatsAppRateLimitWindows,
    createWhatsAppRateLimitMember,
    evaluateWhatsAppRateLimit,
    getWhatsAppRateLimitMode,
    getWhatsAppRateLimitStore,
    resolveWhatsAppRateLimitPolicyValues,
    type WhatsAppRateLimitDecision,
} from "@/lib/whatsapp/rate-limit";
import {
    acquireWhatsAppDispatchGuard,
    createPrismaWhatsAppDispatchLockStore,
    getWhatsAppRedisDispatchLockStore,
    releaseWhatsAppDispatchGuard,
    type WhatsAppDispatchGuard,
    type WhatsAppDatabaseDispatchLockStore,
    type WhatsAppRedisDispatchLockStore,
} from "@/lib/whatsapp/dispatch-serialization";

const MAX_OUTBOX_ATTEMPTS = Math.max(Number(process.env.WHATSAPP_OUTBOX_MAX_ATTEMPTS || 6), 1);
const STALE_PROCESSING_LOCK_MS = Math.max(Number(process.env.WHATSAPP_OUTBOX_STALE_LOCK_MS || 5 * 60 * 1000), 60_000);
const DISPATCH_ACK_TIMEOUT_MS = Math.max(Number(process.env.WHATSAPP_OUTBOX_DISPATCH_ACK_TIMEOUT_MS || 60 * 1000), 30_000);
const DISPATCH_LOCK_TTL_MS = Math.max(Number(process.env.WHATSAPP_OUTBOUND_DISPATCH_LOCK_TTL_MS || 5 * 60 * 1000), 60_000);

export type WhatsAppOutboundOutboxProcessOutcome = "success" | "failed" | "deferred" | "dead" | "skipped";

export type WhatsAppOutboundOutboxProcessResult = {
    outcome: WhatsAppOutboundOutboxProcessOutcome;
    requeueDelayMs?: number;
    error?: string;
};

export function resolveWhatsAppOutboundCompletionState(args: { transport: string; wamId?: string | null }) {
    const transport = String(args.transport || "").trim();
    const wamId = String(args.wamId || "").trim();
    const awaitsProviderAck = transport === "web_bridge" && !!wamId;
    const deliveryUnconfirmed = transport === "web_bridge" && !wamId;

    return {
        awaitsProviderAck,
        deliveryUnconfirmed,
        messageStatus: deliveryUnconfirmed
            ? "delivery_unconfirmed"
            : awaitsProviderAck
                ? "dispatch_accepted"
                : "sent",
        outboxStatus: deliveryUnconfirmed
            ? "delivery_unconfirmed"
            : awaitsProviderAck
                ? "dispatch_accepted"
                : "completed",
        processedAt: awaitsProviderAck ? null : new Date(),
        lastError: deliveryUnconfirmed
            ? "WhatsApp Web dispatch completed but did not return a provider message id; not retrying to avoid duplicate sends."
            : null,
    };
}

export function resolveWhatsAppDispatchAckTimeoutState(messageStatus: string) {
    const status = String(messageStatus || "").trim().toLowerCase();
    const providerConfirmed = status === "sent" || status === "delivered" || status === "read";
    return providerConfirmed
        ? { outboxStatus: "completed", shouldMarkMessageUnconfirmed: false }
        : { outboxStatus: "delivery_unconfirmed", shouldMarkMessageUnconfirmed: status === "dispatch_accepted" };
}

function normalizeError(error: unknown): string {
    if (error instanceof Error) return error.message;
    try {
        return JSON.stringify(error);
    } catch {
        return String(error);
    }
}

function logWhatsAppSendLifecycle(event: string, payload: Record<string, unknown>) {
    console.info(JSON.stringify({
        scope: "whatsapp_send_lifecycle",
        event,
        at: new Date().toISOString(),
        ...payload,
    }));
}

function computeBackoffMs(attemptCount: number): number {
    const exponent = Math.max(0, attemptCount - 1);
    const baseSeconds = Math.min(30 * 60, Math.pow(2, exponent) * 15);
    const jitter = 0.85 + (Math.random() * 0.3);
    return Math.round(baseSeconds * 1000 * jitter);
}

function computeSerializationDelayMs() {
    return 1_000 + Math.floor(Math.random() * 2_000);
}

class WhatsAppRateLimitDeferredError extends Error {
    constructor(readonly decision: WhatsAppRateLimitDecision) {
        super(decision.reason || "WhatsApp rate limit reached");
        this.name = "WhatsAppRateLimitDeferredError";
    }
}

export function buildWhatsAppRateLimitDeferralUpdate(args: {
    reason: string;
    scheduledAt: Date;
    nextEligibleAt: Date;
}) {
    return {
        status: "rate_limited",
        scheduledAt: args.scheduledAt,
        lockedAt: null,
        lockedBy: null,
        lastError: args.reason,
        rateLimitReason: args.reason,
        rateLimitNextEligibleAt: args.nextEligibleAt,
    };
}

export function buildDeviceEgressBlockedUpdate(args: { reason: string; scheduledAt: Date }) {
    return {
        status: "blocked_egress",
        lastError: args.reason,
        scheduledAt: args.scheduledAt,
        lockedAt: null,
        lockedBy: null,
    };
}

export function buildWhatsAppDeliveryUnconfirmedUpdate(args: { reason: string; attemptCount: number }) {
    return {
        status: "delivery_unconfirmed",
        processedAt: new Date(),
        attemptCount: args.attemptCount,
        lastError: args.reason,
        lockedAt: null,
        lockedBy: null,
    };
}

async function deferWhatsAppOutboundWithoutAttempt(args: {
    row: any;
    reason: string;
    retryDelayMs: number;
    nextEligibleAt?: Date | null;
}) {
    const retryDelayMs = Math.max(1_000, Math.trunc(args.retryDelayMs));
    const scheduledAt = new Date(Date.now() + retryDelayMs);
    const nextEligibleAt = args.nextEligibleAt || scheduledAt;
    await (db as any).whatsAppOutboundOutbox.updateMany({
        where: { id: args.row.id, status: "processing" },
        data: buildWhatsAppRateLimitDeferralUpdate({ reason: args.reason, scheduledAt, nextEligibleAt }),
    });
    logWhatsAppSendLifecycle("rate_limit_deferred", {
        messageId: args.row.messageId,
        outboxJobId: args.row.id,
        attemptCount: Number(args.row.attemptCount || 0),
        reason: args.reason,
        nextEligibleAt: nextEligibleAt.toISOString(),
        scheduledAt: scheduledAt.toISOString(),
    });
    void publishConversationRealtimeEvent({
        locationId: args.row.locationId,
        conversationId: args.row.conversationId,
        type: "message.status",
        payload: {
            channel: "whatsapp",
            mode: args.row.kind,
            messageId: args.row.messageId,
            clientMessageId: args.row.message?.clientMessageId || null,
            status: "sending",
            outboxJobId: args.row.id,
            outboxStatus: "rate_limited",
            attemptCount: Number(args.row.attemptCount || 0),
            scheduledAt: scheduledAt.toISOString(),
            rateLimitReason: args.reason,
            rateLimitNextEligibleAt: nextEligibleAt.toISOString(),
            lastError: args.reason,
        },
    });
    return { outcome: "deferred" as const, requeueDelayMs: retryDelayMs, error: args.reason };
}

async function resolveOutboundRateLimitContext(row: any) {
    const transport = String(row.transport || "web_bridge");
    const session = transport === "web_bridge"
        ? await (db as any).whatsAppWebBridgeSession.findUnique({
            where: { locationId: row.locationId },
            select: { id: true, createdAt: true },
        })
        : null;
    const policyRow = await (db as any).whatsAppRateLimitPolicy.findUnique({
        where: { locationId: row.locationId },
        select: { enabled: true, trustTier: true, limits: true },
    }).catch(() => null);
    const sessionScope = session?.id || `${transport}:${row.locationId}`;
    const recipientScope = String(row.contact?.phone || row.contactId || row.conversationId || "unknown");
    const now = new Date();
    return {
        enabled: policyRow?.enabled !== false,
        sessionScope,
        dispatchScopeKey: `whatsapp:${sessionScope}`,
        policy: resolveWhatsAppRateLimitPolicyValues({
            trustTier: policyRow?.trustTier || null,
            sessionCreatedAt: session?.createdAt || row.location?.createdAt || row.createdAt || now,
            now,
            overrides: policyRow?.limits && typeof policyRow.limits === "object" ? policyRow.limits : null,
        }),
        recipientScope,
    };
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
    const workerPickupStartedAtMs = Date.now();
    const lockClaim = await (db as any).whatsAppOutboundOutbox.updateMany({
        where: {
            id: outboxId,
            status: { in: ["pending", "failed", "blocked_egress", "rate_limited"] },
            scheduledAt: { lte: now },
        },
        data: {
            status: "processing",
            lockedAt: now,
            lockedBy: args.workerId,
            rateLimitReason: null,
            rateLimitNextEligibleAt: null,
        },
    });

    if (!Number(lockClaim?.count || 0)) {
        logWhatsAppSendLifecycle("worker_pick_skipped", {
            outboxJobId: outboxId,
            workerId: args.workerId,
        });
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
    const rateLimitMode = getWhatsAppRateLimitMode();
    let dispatchGuard: WhatsAppDispatchGuard | null = null;
    let redisDispatchStore: WhatsAppRedisDispatchLockStore | null = null;
    let databaseDispatchStore: WhatsAppDatabaseDispatchLockStore | null = null;
    const messageCreatedAtMs = Date.parse(String(payload?.messageCreatedAt || row.message?.createdAt || ""));
    const scheduledAtMs = row.scheduledAt ? new Date(row.scheduledAt).getTime() : NaN;
    logWhatsAppSendLifecycle("worker_picked_job", {
        clientMessageId: row.message?.clientMessageId || payload?.clientMessageId || null,
        messageId: row.messageId,
        outboxJobId: row.id,
        workerId: args.workerId,
        attemptCount,
        worker_pickup_ms: Number.isFinite(scheduledAtMs) ? Math.max(0, workerPickupStartedAtMs - scheduledAtMs) : null,
        scheduled_wait_ms: Number.isFinite(messageCreatedAtMs) && Number.isFinite(scheduledAtMs) ? Math.max(0, scheduledAtMs - messageCreatedAtMs) : null,
    });

    void publishConversationRealtimeEvent({
        locationId: row.locationId,
        conversationId: row.conversationId || null,
        type: "message.status",
        payload: {
            channel: "whatsapp",
            mode: row.kind,
            messageId: row.messageId,
            clientMessageId: row.message?.clientMessageId || payload?.clientMessageId || null,
            wamId: row.message?.wamId || null,
            status: "sending",
            outboxJobId: row.id,
            outboxStatus: "processing",
            attemptCount,
            scheduledAt: row.scheduledAt ? new Date(row.scheduledAt).toISOString() : null,
        },
    });

    try {
        const rateLimitContext = rateLimitMode === "disabled" ? null : await resolveOutboundRateLimitContext(row);
        const effectiveRateLimitMode = rateLimitContext?.enabled ? rateLimitMode : "disabled";
        if (effectiveRateLimitMode === "enforce") {
            try {
                redisDispatchStore = await getWhatsAppRedisDispatchLockStore();
                databaseDispatchStore = createPrismaWhatsAppDispatchLockStore(db as any);
                dispatchGuard = await acquireWhatsAppDispatchGuard({
                    redisStore: redisDispatchStore,
                    databaseStore: databaseDispatchStore,
                    scopeKey: rateLimitContext!.dispatchScopeKey,
                    locationId: row.locationId,
                    outboxId: row.id,
                    ownerId: args.workerId,
                    ttlMs: DISPATCH_LOCK_TTL_MS,
                });
            } catch (error) {
                return await deferWhatsAppOutboundWithoutAttempt({
                    row,
                    reason: `Rate-limit safety service unavailable; send held safely. ${normalizeError(error)}`,
                    retryDelayMs: 60_000,
                });
            }
            if (!dispatchGuard) {
                return await deferWhatsAppOutboundWithoutAttempt({
                    row,
                    reason: "Another message for this WhatsApp session is currently sending.",
                    retryDelayMs: computeSerializationDelayMs(),
                });
            }
        }

        const providerSendStartedAtMs = Date.now();
        logWhatsAppSendLifecycle("provider_dispatch_started", {
            clientMessageId: row.message?.clientMessageId || payload?.clientMessageId || null,
            messageId: row.messageId,
            outboxJobId: row.id,
            transport: row.transport,
            kind: row.kind,
        });
        const { transport, provider, providerAccountId, wamId } = await dispatchWhatsAppOutbound(row, {
            beforeProviderDispatch: async () => {
                if (effectiveRateLimitMode === "disabled" || !rateLimitContext) return;
                try {
                    const store = await getWhatsAppRateLimitStore();
                    const decision = await evaluateWhatsAppRateLimit({
                        store,
                        mode: effectiveRateLimitMode,
                        windows: buildWhatsAppRateLimitWindows({
                            sessionScope: rateLimitContext.sessionScope,
                            recipientScope: rateLimitContext.recipientScope,
                            policy: rateLimitContext.policy,
                        }),
                        member: createWhatsAppRateLimitMember(row.id, attemptCount),
                    });
                    if (!decision.allowed) throw new WhatsAppRateLimitDeferredError(decision);
                } catch (error) {
                    if (error instanceof WhatsAppRateLimitDeferredError) throw error;
                    if (effectiveRateLimitMode === "shadow") {
                        console.warn("[WhatsApp Rate Limit] Shadow evaluation unavailable; dispatch continuing:", error);
                        return;
                    }
                    throw new WhatsAppRateLimitDeferredError({
                        allowed: false,
                        mode: "enforce",
                        reason: `Rate-limit safety service unavailable; send held safely. ${normalizeError(error)}`,
                        action: "reschedule",
                        nextEligibleAt: new Date(Date.now() + 60_000),
                        retryDelayMs: 60_000,
                    });
                }
            },
        });
        const providerSendMs = Date.now() - providerSendStartedAtMs;
        logWhatsAppSendLifecycle("provider_dispatch_completed", {
            clientMessageId: row.message?.clientMessageId || payload?.clientMessageId || null,
            messageId: row.messageId,
            outboxJobId: row.id,
            transport,
            provider,
            wamId,
            provider_send_ms: providerSendMs,
            total_to_sent_ms: Number.isFinite(messageCreatedAtMs) ? Date.now() - messageCreatedAtMs : null,
        });

        const completionState = resolveWhatsAppOutboundCompletionState({ transport, wamId });
        const { messageStatus, outboxStatus } = completionState;
        try {
            if (wamId) {
                await (db as any).message.update({
                    where: { id: row.messageId },
                    data: { wamId, ghlMessageId: wamId, updatedAt: new Date() },
                });
            }
        } catch (error) {
            if (!isUniqueConstraintError(error)) throw error;

            const existingByWam = wamId
                ? await db.message.findUnique({
                    where: { wamId },
                    select: { id: true },
                })
                : null;
            if (!existingByWam?.id) throw error;
        }

        await db.message.updateMany({
            where: {
                id: row.messageId,
                status: { in: ["sending", "queued", "pending", "processing", "dispatch_accepted", "delivery_unconfirmed"] },
            },
            data: {
                status: messageStatus,
                updatedAt: new Date(),
            },
        });

        await (db as any).whatsAppOutboundOutbox.updateMany({
            where: { id: row.id, status: "processing" },
            data: {
                status: outboxStatus,
                processedAt: completionState.processedAt,
                attemptCount,
                lastError: completionState.lastError,
                rateLimitReason: null,
                rateLimitNextEligibleAt: null,
                lockedAt: null,
                lockedBy: null,
            },
        });

        const settledState = await (db as any).whatsAppOutboundOutbox.findUnique({
            where: { id: row.id },
            select: {
                status: true,
                message: { select: { status: true, wamId: true } },
            },
        });
        const settledMessageStatus = String(settledState?.message?.status || messageStatus);
        const settledOutboxStatus = String(settledState?.status || outboxStatus);
        const settledWamId = String(settledState?.message?.wamId || wamId || "") || null;
        const settledDeliveryUnconfirmed = settledMessageStatus === "delivery_unconfirmed";
        const settledSyncStatus = settledDeliveryUnconfirmed
            ? "pending"
            : settledMessageStatus === "failed"
                ? "failed"
                : "synced";

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
                providerMessageId: settledWamId,
                providerThreadId: row.conversation?.ghlConversationId || row.conversationId,
                status: settledSyncStatus,
                remoteUpdatedAt: new Date(),
                lastSyncedAt: new Date(),
                metadata: {
                    transport,
                    deliveryUnconfirmed: settledDeliveryUnconfirmed,
                    pricingIntent: payload?.pricingIntent || null,
                    templateName: payload?.templateName || null,
                    templateLanguage: payload?.templateLanguage || null,
                    templateCategory: payload?.templateCategory || null,
                },
            },
            update: {
                ...(settledWamId ? { providerMessageId: settledWamId } : {}),
                providerThreadId: row.conversation?.ghlConversationId || row.conversationId,
                status: settledSyncStatus,
                remoteUpdatedAt: new Date(),
                lastSyncedAt: new Date(),
                lastError: null,
                metadata: {
                    transport,
                    deliveryUnconfirmed: settledDeliveryUnconfirmed,
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
            wamId: settledWamId,
            status: settledMessageStatus,
            outboxJobId: row.id,
            outboxStatus: settledOutboxStatus,
            attemptCount,
            provider_send_ms: providerSendMs,
            total_to_sent_ms: Number.isFinite(messageCreatedAtMs) ? Date.now() - messageCreatedAtMs : null,
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
        if (error instanceof WhatsAppRateLimitDeferredError) {
            return await deferWhatsAppOutboundWithoutAttempt({
                row,
                reason: error.decision.reason || "WhatsApp rate limit reached.",
                retryDelayMs: error.decision.retryDelayMs,
                nextEligibleAt: error.decision.nextEligibleAt,
            });
        }
        const message = normalizeError(error);
        if (isWhatsAppWebBridgeDeliveryUnconfirmedError(error)) {
            // message_create can adopt the pending app message while the send
            // request is still in flight. Include that intermediate state so a
            // later request timeout cannot leave the row spinning forever.
            await (db as any).whatsAppOutboundOutbox.updateMany({
                where: { id: row.id, status: { in: ["processing", "dispatch_accepted"] } },
                data: buildWhatsAppDeliveryUnconfirmedUpdate({ reason: message, attemptCount }),
            });
            await db.message.updateMany({
                where: {
                    id: row.messageId,
                    status: { in: ["sending", "queued", "pending", "processing", "dispatch_accepted"] },
                },
                data: { status: "delivery_unconfirmed", updatedAt: new Date() },
            });
            const settledState = await (db as any).whatsAppOutboundOutbox.findUnique({
                where: { id: row.id },
                select: {
                    status: true,
                    message: { select: { status: true } },
                },
            });
            const settledMessageStatus = String(settledState?.message?.status || "delivery_unconfirmed");
            const settledOutboxStatus = String(settledState?.status || "delivery_unconfirmed");
            logWhatsAppSendLifecycle("delivery_unconfirmed_no_retry", {
                messageId: row.messageId,
                outboxJobId: row.id,
                attemptCount,
                settledMessageStatus,
                settledOutboxStatus,
            });
            void publishConversationRealtimeEvent({
                locationId: row.locationId,
                conversationId: row.conversationId,
                type: "message.status",
                payload: {
                    channel: "whatsapp",
                    messageId: row.messageId,
                    status: settledMessageStatus,
                    outboxJobId: row.id,
                    outboxStatus: settledOutboxStatus,
                    attemptCount,
                    lastError: settledMessageStatus === "delivery_unconfirmed" ? message : null,
                },
            });
            return { outcome: "success" };
        }
        if (isDeviceEgressOfflineError(error)) {
            const retryDelayMs = 60_000;
            const nextScheduledAt = new Date(Date.now() + retryDelayMs);
            await (db as any).whatsAppOutboundOutbox.update({
                where: { id: row.id },
                data: buildDeviceEgressBlockedUpdate({ reason: message, scheduledAt: nextScheduledAt }),
            });
            await db.message.update({
                where: { id: row.messageId },
                data: { status: "blocked_egress", updatedAt: new Date() },
            }).catch(() => undefined);
            void publishConversationRealtimeEvent({
                locationId: row.locationId,
                conversationId: row.conversationId,
                type: "message.status",
                payload: {
                    channel: "whatsapp",
                    messageId: row.messageId,
                    status: "blocked_egress",
                    outboxJobId: row.id,
                    outboxStatus: "blocked_egress",
                    scheduledAt: nextScheduledAt.toISOString(),
                    lastError: message,
                },
            });
            return { outcome: "failed", requeueDelayMs: retryDelayMs, error: message };
        }
        const retryable = isRetryableOutboundError(error);
        const canRetry = retryable && attemptCount < MAX_OUTBOX_ATTEMPTS;

        if (canRetry) {
            const backoffMs = computeBackoffMs(attemptCount);
            const nextScheduledAt = new Date(Date.now() + backoffMs);
            await (db as any).whatsAppOutboundOutbox.update({
                where: { id: row.id },
                data: {
                    status: "failed",
                    attemptCount,
                    lastError: message,
                    scheduledAt: nextScheduledAt,
                    lockedAt: null,
                    lockedBy: null,
                },
            });
            logWhatsAppSendLifecycle("failure_retry_scheduled", {
                clientMessageId: row.message?.clientMessageId || payload?.clientMessageId || null,
                messageId: row.messageId,
                outboxJobId: row.id,
                attemptCount,
                retryDelayMs: backoffMs,
                error: message,
            });
            void publishConversationRealtimeEvent({
                locationId: row.locationId,
                conversationId: row.conversation?.id || row.conversationId,
                type: "message.status",
                payload: {
                    channel: "whatsapp",
                    mode: row.kind,
                    messageId: row.messageId,
                    clientMessageId: row.message?.clientMessageId || payload?.clientMessageId || null,
                    wamId: row.message?.wamId || null,
                    status: "sending",
                    outboxJobId: row.id,
                    outboxStatus: "failed",
                    attemptCount,
                    scheduledAt: nextScheduledAt.toISOString(),
                    lastError: message,
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
            outboxJobId: row.id,
            outboxStatus: "dead",
            attemptCount,
            lastError: message,
        };
        logWhatsAppSendLifecycle("failure_dead_lettered", {
            clientMessageId: row.message?.clientMessageId || payload?.clientMessageId || null,
            messageId: row.messageId,
            outboxJobId: row.id,
            attemptCount,
            error: message,
        });

        void publishConversationRealtimeEvent({
            locationId: row.locationId,
            conversationId: row.conversation?.id || row.conversationId,
            type: "message.status",
            payload: failurePayload,
        });

        return { outcome: "dead", error: message };
    } finally {
        if (dispatchGuard && redisDispatchStore && databaseDispatchStore) {
            await releaseWhatsAppDispatchGuard({
                guard: dispatchGuard,
                redisStore: redisDispatchStore,
                databaseStore: databaseDispatchStore,
            });
        }
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
    const ackTimeoutBefore = new Date(Date.now() - DISPATCH_ACK_TIMEOUT_MS);
    const unconfirmedRows = await (db as any).whatsAppOutboundOutbox.findMany({
        where: {
            transport: "web_bridge",
            status: "dispatch_accepted",
            updatedAt: { lt: ackTimeoutBefore },
        },
        select: {
            id: true,
            messageId: true,
            message: {
                select: { status: true },
            },
        },
        take: 250,
    });
    const confirmedRows = unconfirmedRows.filter((row: any) =>
        resolveWhatsAppDispatchAckTimeoutState(row.message?.status).outboxStatus === "completed"
    );
    const timedOutRows = unconfirmedRows.filter((row: any) =>
        resolveWhatsAppDispatchAckTimeoutState(row.message?.status).outboxStatus === "delivery_unconfirmed"
    );
    const confirmedOutboxIds = confirmedRows.map((row: any) => String(row.id));
    const unconfirmedOutboxIds = timedOutRows.map((row: any) => String(row.id));
    const unconfirmedMessageIds = timedOutRows
        .filter((row: any) => resolveWhatsAppDispatchAckTimeoutState(row.message?.status).shouldMarkMessageUnconfirmed)
        .map((row: any) => String(row.messageId));
    if (confirmedOutboxIds.length > 0) {
        await (db as any).whatsAppOutboundOutbox.updateMany({
            where: { id: { in: confirmedOutboxIds }, status: "dispatch_accepted" },
            data: {
                status: "completed",
                processedAt: now,
                lastError: null,
                lockedAt: null,
                lockedBy: null,
            },
        });
    }
    if (unconfirmedOutboxIds.length > 0) {
        const message = `WhatsApp Web dispatch accepted but no delivery ack arrived within ${Math.round(DISPATCH_ACK_TIMEOUT_MS / 1000)} seconds.`;
        await db.$transaction([
            (db as any).whatsAppOutboundOutbox.updateMany({
                where: { id: { in: unconfirmedOutboxIds }, status: "dispatch_accepted" },
                data: {
                    status: "delivery_unconfirmed",
                    lastError: message,
                    lockedAt: null,
                    lockedBy: null,
                },
            }),
            db.message.updateMany({
                where: {
                    id: { in: unconfirmedMessageIds },
                    status: "dispatch_accepted",
                },
                data: {
                    status: "delivery_unconfirmed",
                    updatedAt: now,
                },
            }),
        ]);
    }
    return Number(recovered?.count || 0) + unconfirmedRows.length;
}

export async function listDueWhatsAppOutboundOutboxIds(limit = 200): Promise<string[]> {
    const rows = await (db as any).whatsAppOutboundOutbox.findMany({
        where: {
            status: { in: ["pending", "failed", "blocked_egress", "rate_limited"] },
            scheduledAt: { lte: new Date() },
        },
        orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }],
        take: Math.max(1, Math.min(Number(limit || 200), 1000)),
        select: { id: true },
    });
    return rows.map((row: any) => String(row.id));
}
