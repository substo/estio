import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import db from "@/lib/db";
import { getProviderCapabilities } from "@/lib/integrations/provider-capabilities";
import { buildProviderOutboxIdempotencyKey } from "@/lib/integrations/provider-outbox-keys";

const MAX_PROVIDER_OUTBOX_ATTEMPTS = Math.max(Number(process.env.PROVIDER_OUTBOX_MAX_ATTEMPTS || 6), 1);
const STALE_PROVIDER_OUTBOX_LOCK_MS = Math.max(Number(process.env.PROVIDER_OUTBOX_STALE_LOCK_MS || 5 * 60 * 1000), 60_000);

export type ProviderOutboxProcessOutcome = "success" | "failed" | "dead" | "disabled" | "skipped";

export type ProviderOutboxProcessResult = {
    outcome: ProviderOutboxProcessOutcome;
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

function isRetryableProviderError(error: unknown): boolean {
    const status = Number((error as any)?.response?.status || (error as any)?.status || 0);
    if (status === 408 || status === 409 || status === 425 || status === 429 || status >= 500) return true;
    if (status >= 400 && status < 500) return false;
    const code = String((error as any)?.code || (error as any)?.cause?.code || "");
    if (["ECONNABORTED", "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN"].includes(code)) return true;
    return status <= 0;
}

export function operationCapability(operation: string): keyof ReturnType<typeof getProviderCapabilities> | null {
    if (operation === "mirror_conversation") return "canMirrorOutbound";
    if (operation === "mirror_message") return "canMirrorOutbound";
    if (operation === "sync_contact") return "canSyncContacts";
    if (operation === "sync_status") return "canUpdateStatus";
    return null;
}

export async function enqueueProviderOutboxJob(args: {
    locationId: string;
    provider: "ghl" | "google" | "outlook";
    operation: "mirror_conversation" | "mirror_message" | "sync_contact" | "sync_status";
    providerAccountId?: string | null;
    conversationId?: string | null;
    messageId?: string | null;
    contactId?: string | null;
    payload?: Prisma.InputJsonValue | null;
    scheduledAt?: Date;
}) {
    const providerAccountId = String(args.providerAccountId || "default").trim() || "default";
    const idempotencyKey = buildProviderOutboxIdempotencyKey({
        provider: args.provider,
        providerAccountId,
        operation: args.operation,
        locationId: args.locationId,
        conversationId: args.conversationId,
        messageId: args.messageId,
        contactId: args.contactId,
    });

    return (db as any).providerOutbox.upsert({
        where: { idempotencyKey },
        create: {
            locationId: args.locationId,
            provider: args.provider,
            providerAccountId,
            operation: args.operation,
            conversationId: args.conversationId || null,
            messageId: args.messageId || null,
            contactId: args.contactId || null,
            payload: args.payload || undefined,
            scheduledAt: args.scheduledAt || new Date(),
            idempotencyKey,
        },
        update: {
            scheduledAt: args.scheduledAt || new Date(),
            payload: args.payload || undefined,
            status: "pending",
            lastError: null,
        },
    });
}

function getProviderAccountId(row: any): string {
    if (row.provider === "ghl") return String(row.location?.ghlLocationId || row.providerAccountId || "default");
    return String(row.providerAccountId || "default");
}

async function upsertContactSync(args: {
    contactId: string;
    provider: string;
    providerAccountId: string;
    providerContactId?: string | null;
    status?: string;
    remoteUpdatedAt?: Date | null;
    lastError?: string | null;
}) {
    const now = new Date();
    await (db as any).contactSync.upsert({
        where: {
            contactId_provider_providerAccountId: {
                contactId: args.contactId,
                provider: args.provider,
                providerAccountId: args.providerAccountId,
            },
        },
        create: {
            contactId: args.contactId,
            provider: args.provider,
            providerAccountId: args.providerAccountId,
            providerContactId: args.providerContactId || null,
            status: args.status || "synced",
            remoteUpdatedAt: args.remoteUpdatedAt || undefined,
            lastSyncedAt: now,
            lastAttemptAt: now,
            attemptCount: 1,
            lastError: args.lastError || null,
        },
        update: {
            providerContactId: args.providerContactId || undefined,
            status: args.status || "synced",
            remoteUpdatedAt: args.remoteUpdatedAt || undefined,
            lastSyncedAt: now,
            lastAttemptAt: now,
            lastError: args.lastError || null,
        },
    });
}

async function upsertConversationSync(args: {
    conversationId: string;
    locationId: string;
    provider: string;
    providerAccountId: string;
    providerConversationId?: string | null;
    providerThreadId?: string | null;
    status?: string;
    metadata?: Prisma.InputJsonValue | null;
}) {
    const now = new Date();
    await (db as any).conversationSync.upsert({
        where: {
            conversationId_provider_providerAccountId: {
                conversationId: args.conversationId,
                provider: args.provider,
                providerAccountId: args.providerAccountId,
            },
        },
        create: {
            conversationId: args.conversationId,
            locationId: args.locationId,
            provider: args.provider,
            providerAccountId: args.providerAccountId,
            providerConversationId: args.providerConversationId || null,
            providerThreadId: args.providerThreadId || args.providerConversationId || null,
            status: args.status || "synced",
            lastSyncedAt: now,
            lastAttemptAt: now,
            metadata: args.metadata || undefined,
            lastError: null,
        },
        update: {
            providerConversationId: args.providerConversationId || undefined,
            providerThreadId: args.providerThreadId || args.providerConversationId || undefined,
            status: args.status || "synced",
            lastSyncedAt: now,
            lastAttemptAt: now,
            metadata: args.metadata || undefined,
            lastError: null,
        },
    });
}

async function upsertMessageSync(args: {
    messageId: string;
    conversationId: string;
    locationId: string;
    provider: string;
    providerAccountId: string;
    providerMessageId?: string | null;
    providerThreadId?: string | null;
    status?: string;
}) {
    const now = new Date();
    await (db as any).messageSync.upsert({
        where: {
            messageId_provider_providerAccountId: {
                messageId: args.messageId,
                provider: args.provider,
                providerAccountId: args.providerAccountId,
            },
        },
        create: {
            messageId: args.messageId,
            conversationId: args.conversationId,
            locationId: args.locationId,
            provider: args.provider,
            providerAccountId: args.providerAccountId,
            providerMessageId: args.providerMessageId || null,
            providerThreadId: args.providerThreadId || null,
            status: args.status || "synced",
            remoteUpdatedAt: now,
            lastSyncedAt: now,
            lastAttemptAt: now,
            lastError: null,
        },
        update: {
            providerMessageId: args.providerMessageId || undefined,
            providerThreadId: args.providerThreadId || undefined,
            status: args.status || "synced",
            remoteUpdatedAt: now,
            lastSyncedAt: now,
            lastAttemptAt: now,
            lastError: null,
        },
    });
}

async function markProviderOutboxDisabled(row: any, reason: string, attemptCount: number): Promise<ProviderOutboxProcessResult> {
    await (db as any).providerOutbox.update({
        where: { id: row.id },
        data: {
            status: "disabled",
            processedAt: new Date(),
            attemptCount,
            lastError: reason,
            lockedAt: null,
            lockedBy: null,
        },
    });
    return { outcome: "disabled", error: reason };
}

async function resolveGhlRemoteContact(row: any): Promise<{ remoteContactId?: string; disabled?: string; providerAccountId: string }> {
    const location = row.location;
    const providerAccountId = getProviderAccountId(row);
    if (!location?.ghlAccessToken) {
        return { disabled: "GHL is not connected for this location.", providerAccountId };
    }

    const contactId = row.contactId || row.conversation?.contactId || row.message?.contactId;
    if (!contactId) {
        return { disabled: "No contact is associated with this provider mirror job.", providerAccountId };
    }

    const { ensureRemoteContact } = await import("@/lib/crm/contact-sync");
    const remoteContactId = await ensureRemoteContact(contactId, location.ghlLocationId || "", location.ghlAccessToken);
    if (!remoteContactId) {
        return { disabled: "Could not resolve a GHL contact for this job.", providerAccountId };
    }

    await upsertContactSync({
        contactId,
        provider: "ghl",
        providerAccountId,
        providerContactId: remoteContactId,
        status: "synced",
    });

    return { remoteContactId, providerAccountId };
}

async function processGhlSyncContact(row: any) {
    const resolved = await resolveGhlRemoteContact(row);
    if (resolved.disabled) return { disabled: resolved.disabled };
    return { completed: true };
}

async function processGhlMirrorConversation(row: any) {
    const resolved = await resolveGhlRemoteContact(row);
    if (resolved.disabled) return { disabled: resolved.disabled };

    if (!row.conversationId) {
        return { disabled: "No conversation is associated with this provider mirror job." };
    }

    await upsertConversationSync({
        conversationId: row.conversationId,
        locationId: row.locationId,
        provider: "ghl",
        providerAccountId: resolved.providerAccountId,
        status: "synced",
        metadata: {
            source: (row.payload as any)?.source || "provider_outbox",
            remoteContactId: resolved.remoteContactId,
            remoteThreadState: "contact_ready_no_remote_thread",
        },
    });

    return { completed: true };
}

async function processGhlMirrorMessage(row: any) {
    const resolved = await resolveGhlRemoteContact(row);
    if (resolved.disabled) return { disabled: resolved.disabled };

    if (!row.conversationId) {
        return { disabled: "No conversation is associated with this provider mirror job." };
    }

    const message = row.message;
    if (!message?.id) {
        return { disabled: "Message was deleted before it could be mirrored." };
    }

    const body = String((row.payload as any)?.body || message.body || "").trim();
    if (!body) {
        return { disabled: "Message body is empty; nothing to mirror." };
    }

    const { sendMessage } = await import("@/lib/ghl/conversations");
    const customProviderId = process.env.GHL_CUSTOM_PROVIDER_ID;
    const payload: any = {
        contactId: resolved.remoteContactId,
        type: customProviderId ? "Custom" : "WhatsApp",
        message: body,
    };
    if (customProviderId) payload.conversationProviderId = customProviderId;

    const res = await sendMessage(location.ghlAccessToken, payload);
    const providerMessageId = String(res?.messageId || res?.message?.id || "").trim() || null;
    const providerConversationId = String(res?.conversationId || res?.conversation?.id || "").trim() || null;

    if (providerConversationId && row.conversationId) {
        await upsertConversationSync({
            conversationId: row.conversationId,
            locationId: row.locationId,
            provider: "ghl",
            providerAccountId: resolved.providerAccountId,
            providerConversationId,
            providerThreadId: providerConversationId,
            status: "synced",
            metadata: {
                source: (row.payload as any)?.source || "provider_outbox",
                remoteContactId: resolved.remoteContactId,
            },
        });
    } else if (row.conversationId) {
        await upsertConversationSync({
            conversationId: row.conversationId,
            locationId: row.locationId,
            provider: "ghl",
            providerAccountId: resolved.providerAccountId,
            status: "synced",
            metadata: {
                source: (row.payload as any)?.source || "provider_outbox",
                remoteContactId: resolved.remoteContactId,
                remoteThreadState: "message_sent_without_returned_thread",
            },
        });
    }

    if (providerMessageId && row.messageId && row.conversationId) {
        await upsertMessageSync({
            messageId: row.messageId,
            conversationId: row.conversationId,
            locationId: row.locationId,
            provider: "ghl",
            providerAccountId: resolved.providerAccountId,
            providerMessageId,
            providerThreadId: providerConversationId,
            status: "synced",
        });
    }

    return { completed: true };
}

async function processGhlProviderOutbox(row: any) {
    if (row.operation === "sync_contact") return processGhlSyncContact(row);
    if (row.operation === "mirror_conversation") return processGhlMirrorConversation(row);
    if (row.operation === "mirror_message") return processGhlMirrorMessage(row);
    if (row.operation === "sync_status") {
        return { disabled: "GHL status sync is intentionally not enabled; Estio owns conversation status." };
    }
    return { disabled: `Unsupported GHL provider outbox operation: ${row.operation}` };
}

async function processGoogleProviderOutbox(row: any) {
    if (row.operation !== "sync_contact") {
        return { disabled: `Google provider outbox only supports sync_contact in this wave.` };
    }

    const contactId = row.contactId || row.conversation?.contactId || row.message?.contactId;
    if (!contactId) {
        return { disabled: "No contact is associated with this Google sync job." };
    }

    const providerAccountId = String(row.providerAccountId || "").trim();
    if (!providerAccountId || providerAccountId === "default") {
        return { disabled: "Google contact sync requires providerAccountId to be the connected user id." };
    }

    const user = await db.user.findFirst({
        where: {
            id: providerAccountId,
            googleSyncEnabled: true,
            locations: { some: { id: row.locationId } },
        },
        select: { id: true },
    });
    if (!user) {
        return { disabled: "Google is not connected/enabled for this user and location." };
    }

    const { syncContactToGoogle } = await import("@/lib/google/people");
    await syncContactToGoogle(user.id, contactId);

    const contact = await db.contact.findUnique({
        where: { id: contactId },
        select: {
            googleContactId: true,
            googleContactUpdatedAt: true,
            lastGoogleSync: true,
        },
    });
    if (!contact) {
        return { disabled: "Contact was deleted before it could be synced to Google." };
    }
    if (!contact.googleContactId) {
        return { disabled: "Could not resolve a Google contact id after sync." };
    }

    await upsertContactSync({
        contactId,
        provider: "google",
        providerAccountId: user.id,
        providerContactId: contact.googleContactId,
        remoteUpdatedAt: contact.googleContactUpdatedAt || undefined,
        status: "synced",
    });

    return { completed: true };
}

async function executeProviderOutbox(row: any) {
    if (row.provider === "outlook") {
        return { disabled: "Outlook provider outbox is intentionally disabled; this app does not use Outlook." };
    }

    const capability = operationCapability(String(row.operation || ""));
    const caps = getProviderCapabilities(row.provider);
    if (!capability || !caps[capability]) {
        return { disabled: `Provider ${row.provider} cannot perform ${row.operation}.` };
    }

    if (row.provider === "ghl") return processGhlProviderOutbox(row);
    if (row.provider === "google") return processGoogleProviderOutbox(row);
    return { disabled: `${row.provider} mirror worker is not connected for ${row.operation} yet.` };
}

export async function processProviderOutboxJob(args: {
    outboxId: string;
    workerId?: string;
}): Promise<ProviderOutboxProcessResult> {
    const outboxId = String(args.outboxId || "").trim();
    if (!outboxId) return { outcome: "skipped", error: "Missing outbox id." };

    const now = new Date();
    const workerId = args.workerId || `provider-outbox:${randomUUID()}`;
    const lockClaim = await (db as any).providerOutbox.updateMany({
        where: {
            id: outboxId,
            status: { in: ["pending", "failed"] },
            scheduledAt: { lte: now },
        },
        data: {
            status: "processing",
            lockedAt: now,
            lockedBy: workerId,
        },
    });
    if (!Number(lockClaim?.count || 0)) return { outcome: "skipped" };

    const row = await (db as any).providerOutbox.findUnique({
        where: { id: outboxId },
        include: {
            location: true,
            conversation: true,
            message: true,
            contact: true,
        },
    });
    if (!row) return { outcome: "skipped", error: "Outbox row no longer exists." };

    const attemptCount = Number(row.attemptCount || 0) + 1;
    try {
        const result = await executeProviderOutbox(row);
        if ((result as any)?.disabled) {
            return markProviderOutboxDisabled(row, String((result as any).disabled), attemptCount);
        }

        await (db as any).providerOutbox.update({
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
        return { outcome: "success" };
    } catch (error) {
        const message = normalizeError(error);
        const canRetry = isRetryableProviderError(error) && attemptCount < MAX_PROVIDER_OUTBOX_ATTEMPTS;
        if (canRetry) {
            const backoffMs = computeBackoffMs(attemptCount);
            await (db as any).providerOutbox.update({
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
            return { outcome: "failed", requeueDelayMs: backoffMs, error: message };
        }

        await (db as any).providerOutbox.update({
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
        return { outcome: "dead", error: message };
    }
}

export async function recoverStaleProviderOutboxLocks() {
    const staleBefore = new Date(Date.now() - STALE_PROVIDER_OUTBOX_LOCK_MS);
    const recovered = await (db as any).providerOutbox.updateMany({
        where: {
            status: "processing",
            lockedAt: { lt: staleBefore },
        },
        data: {
            status: "failed",
            lockedAt: null,
            lockedBy: null,
            scheduledAt: new Date(),
            lastError: "Recovered stale processing lock; re-queued.",
        },
    });
    return Number(recovered?.count || 0);
}

export async function listDueProviderOutboxIds(limit = 200): Promise<string[]> {
    const rows = await (db as any).providerOutbox.findMany({
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
