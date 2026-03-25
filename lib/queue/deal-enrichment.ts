import db from "@/lib/db";
import { ensureLocalContactSynced } from "@/lib/crm/contact-sync";
import { getConversation } from "@/lib/ghl/conversations";
import { publishConversationRealtimeEvent } from "@/lib/realtime/conversation-events";
import {
    collectDealPropertyIdsFromContacts,
    getDealEnrichmentJobId,
    mergeDealEnrichmentMetadata,
} from "@/lib/deals/enrichment";
import { buildQueueJobId, isDuplicateQueueJobError } from "@/lib/queue/job-id";

const REDIS_CONNECTION = {
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: Number(process.env.REDIS_PORT || 6379),
};

const QUEUE_NAME = "deal-enrichment";

type DealEnrichmentJobData = {
    dealId: string;
    queuedAt: string;
};

export type EnqueueDealEnrichmentResult = {
    accepted: boolean;
    mode: "queued" | "already-queued" | "inline-fallback" | "queue-unavailable";
    jobId: string;
    error?: string;
};

let _queuePromise: Promise<any> | null = null;
let _workerPromise: Promise<any> | null = null;

async function getQueueInstance() {
    if (!_queuePromise) {
        _queuePromise = (async () => {
            const { Queue } = await import("bullmq");
            return new Queue<DealEnrichmentJobData>(QUEUE_NAME, {
                connection: REDIS_CONNECTION,
                defaultJobOptions: {
                    removeOnComplete: true,
                    removeOnFail: 200,
                },
            });
        })();
    }

    try {
        return await _queuePromise;
    } catch (error) {
        _queuePromise = null;
        throw error;
    }
}

async function updateDealEnrichmentState(args: {
    dealId: string;
    metadata: unknown;
    patch: Parameters<typeof mergeDealEnrichmentMetadata>[1];
    propertyIds?: string[];
}) {
    const nextMetadata = mergeDealEnrichmentMetadata(args.metadata, args.patch);
    await db.dealContext.update({
        where: { id: args.dealId },
        data: {
            ...(Array.isArray(args.propertyIds) ? { propertyIds: args.propertyIds } : {}),
            metadata: nextMetadata,
        },
    });
    return nextMetadata;
}

export async function processDealEnrichment(dealId: string): Promise<void> {
    const normalizedDealId = String(dealId || "").trim();
    if (!normalizedDealId) return;

    const deal = await db.dealContext.findFirst({
        where: { id: normalizedDealId },
        include: {
            location: {
                select: {
                    id: true,
                    ghlAccessToken: true,
                },
            },
        },
    });

    if (!deal) return;

    const startedAt = new Date().toISOString();
    let currentMetadata: unknown = await updateDealEnrichmentState({
        dealId: normalizedDealId,
        metadata: deal.metadata,
        patch: {
            status: "processing",
            startedAt,
            error: null,
            failedAt: null,
        },
    });

    try {
        const localConversations = await db.conversation.findMany({
            where: {
                locationId: deal.locationId,
                ghlConversationId: { in: deal.conversationIds },
            },
            select: {
                ghlConversationId: true,
                contactId: true,
                contact: {
                    select: {
                        ghlContactId: true,
                    },
                },
            },
        });

        const localContactIds = new Set<string>();
        const ghlContactIds = new Set<string>();

        for (const conversation of localConversations) {
            const localContactId = String(conversation.contactId || "").trim();
            if (localContactId) localContactIds.add(localContactId);

            const ghlContactId = String(conversation.contact?.ghlContactId || "").trim();
            if (ghlContactId) ghlContactIds.add(ghlContactId);
        }

        const accessToken = String(deal.location?.ghlAccessToken || "").trim();
        if (accessToken) {
            const unresolvedConversationIds = deal.conversationIds.filter((conversationId) => {
                const localConversation = localConversations.find((conversation) => conversation.ghlConversationId === conversationId);
                return !localConversation?.contact?.ghlContactId;
            });

            const conversationIdsToResolve = unresolvedConversationIds.length > 0
                ? unresolvedConversationIds
                : deal.conversationIds;

            const remoteConversations = await Promise.allSettled(
                conversationIdsToResolve.map((conversationId) => getConversation(accessToken, conversationId))
            );

            for (const result of remoteConversations) {
                if (result.status !== "fulfilled") continue;
                const ghlContactId = String(result.value?.conversation?.contactId || "").trim();
                if (ghlContactId) ghlContactIds.add(ghlContactId);
            }

            await Promise.allSettled(
                Array.from(ghlContactIds).map((ghlContactId) =>
                    ensureLocalContactSynced(ghlContactId, deal.locationId, accessToken)
                )
            );
        }

        const contactFilters: any[] = [];
        if (localContactIds.size > 0) {
            contactFilters.push({ id: { in: Array.from(localContactIds) } });
        }
        if (ghlContactIds.size > 0) {
            contactFilters.push({ ghlContactId: { in: Array.from(ghlContactIds) } });
        }

        const contacts = contactFilters.length > 0
            ? await db.contact.findMany({
                where: {
                    locationId: deal.locationId,
                    OR: contactFilters,
                },
                include: {
                    propertyRoles: { select: { propertyId: true } },
                    viewings: { select: { propertyId: true } },
                },
            })
            : [];

        const propertyIds = collectDealPropertyIdsFromContacts(contacts);
        const completedAt = new Date().toISOString();

        currentMetadata = await updateDealEnrichmentState({
            dealId: normalizedDealId,
            metadata: currentMetadata,
            propertyIds,
            patch: {
                status: "ready",
                completedAt,
                error: null,
                propertyCount: propertyIds.length,
            },
        });

        await publishConversationRealtimeEvent({
            locationId: deal.locationId,
            type: "deal.update",
            payload: {
                dealId: normalizedDealId,
                mutation: "enrichment_ready",
                propertyCount: propertyIds.length,
            },
        });
    } catch (error) {
        const message = String((error as any)?.message || "Deal enrichment failed.");
        const failedAt = new Date().toISOString();

        await updateDealEnrichmentState({
            dealId: normalizedDealId,
            metadata: currentMetadata,
            patch: {
                status: "failed",
                failedAt,
                error: message,
            },
        });

        await publishConversationRealtimeEvent({
            locationId: deal.locationId,
            type: "deal.update",
            payload: {
                dealId: normalizedDealId,
                mutation: "enrichment_failed",
                error: message,
            },
        });

        throw error;
    }
}

export async function enqueueDealEnrichment(args: {
    dealId: string;
    allowInlineFallback?: boolean;
}): Promise<EnqueueDealEnrichmentResult> {
    const dealId = String(args.dealId || "").trim();
    const allowInlineFallback = args.allowInlineFallback !== false;
    const jobId = buildQueueJobId(getDealEnrichmentJobId(dealId));

    try {
        const queue = await getQueueInstance();
        const existingJob = await queue.getJob(jobId);
        if (existingJob) {
            return {
                accepted: true,
                mode: "already-queued",
                jobId,
            };
        }

        await queue.add(
            "enrich-deal",
            {
                dealId,
                queuedAt: new Date().toISOString(),
            },
            {
                attempts: 3,
                backoff: {
                    type: "exponential",
                    delay: 1000,
                },
                jobId,
            }
        );

        return {
            accepted: true,
            mode: "queued",
            jobId,
        };
    } catch (queueError) {
        if (isDuplicateQueueJobError(queueError)) {
            return {
                accepted: true,
                mode: "already-queued",
                jobId,
            };
        }

        if (!allowInlineFallback) {
            return {
                accepted: false,
                mode: "queue-unavailable",
                jobId,
                error: String((queueError as any)?.message || "Failed to enqueue deal enrichment."),
            };
        }

        console.warn("[Queue] Failed to enqueue deal enrichment job. Falling back to inline processing:", queueError);
        void processDealEnrichment(dealId).catch((error) => {
            console.error("[Queue] Inline deal enrichment fallback failed:", error);
        });

        return {
            accepted: true,
            mode: "inline-fallback",
            jobId,
        };
    }
}

export async function initDealEnrichmentWorker() {
    if (_workerPromise) return _workerPromise;

    _workerPromise = (async () => {
        const { Worker } = await import("bullmq");

        const worker = new Worker<DealEnrichmentJobData>(
            QUEUE_NAME,
            async (job: any) => {
                await processDealEnrichment(job.data.dealId);
            },
            {
                connection: REDIS_CONNECTION,
                concurrency: 2,
            }
        );

        worker.on("ready", () => {
            console.log("[Queue] Deal enrichment worker is ready.");
        });

        worker.on("failed", (job: any, err: Error) => {
            console.error(`[Queue] Deal enrichment job failed (${job?.id || "unknown"}): ${err.message}`);
        });

        return worker;
    })();

    try {
        return await _workerPromise;
    } catch (error) {
        _workerPromise = null;
        throw error;
    }
}
