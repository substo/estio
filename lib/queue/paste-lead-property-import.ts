import db from "@/lib/db";
import { applyPropertyInterestToContact } from "@/lib/leads/contact-property-interest";
import { importOldCrmPropertyToLocalDb } from "@/lib/crm/old-crm-property-import-service";
import { normalizeOldCrmPropertyPullError, type OldCrmPropertyPullError } from "@/lib/crm/old-crm-property-pull-service";
import { getOldCrmImportCapabilityForUser, type LegacyCrmRefCandidate } from "@/lib/crm/old-crm-import";
import { buildQueueJobId, isDuplicateQueueJobError } from "@/lib/queue/job-id";
import { createPasteLeadStatusRecorder } from "@/lib/conversations/paste-lead-status";

const REDIS_CONNECTION = {
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: Number(process.env.REDIS_PORT || 6379),
};

const QUEUE_NAME = "paste-lead-property-import";

export interface PasteLeadPropertyImportJobData {
    locationId: string;
    conversationId: string;
    contactId: string;
    actorUserId: string;
    publicReference: string;
    oldCrmPropertyId: string;
    source: LegacyCrmRefCandidate["source"];
    interestSource?: string | null;
    queuedAt: string;
    pasteLeadTraceId?: string;
}

export interface EnqueuePasteLeadPropertyImportInput extends Omit<PasteLeadPropertyImportJobData, "queuedAt"> {}

export type EnqueuePasteLeadPropertyImportResult = {
    accepted: boolean;
    mode: "queued" | "already-queued" | "queue-unavailable";
    jobId: string;
    error?: string;
};

export type PendingPasteLeadPropertyImport = {
    jobId: string;
    publicReference: string;
    state: string;
};

const PENDING_PROPERTY_IMPORT_STATES = ["waiting", "active", "delayed", "prioritized", "paused"] as const;

let _queuePromise: Promise<any> | null = null;
let _workerPromise: Promise<any> | null = null;

type PasteLeadPropertyImportFailureJob = {
    id?: string;
    attemptsMade?: number;
    opts?: {
        attempts?: number;
    };
    data?: PasteLeadPropertyImportJobData;
};

async function getQueueInstance() {
    if (!_queuePromise) {
        _queuePromise = (async () => {
            const { Queue } = await import("bullmq");
            return new Queue<PasteLeadPropertyImportJobData>(QUEUE_NAME, {
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

export function isPendingPasteLeadPropertyImportState(state: string): boolean {
    return (PENDING_PROPERTY_IMPORT_STATES as readonly string[]).includes(state);
}

/**
 * Best-effort draft preflight. Queue/status outages must never prevent an agent
 * from drafting, so lookup failures deliberately return an empty list.
 */
export async function getPendingPasteLeadPropertyImports(args: {
    locationId: string;
    conversationId: string;
}): Promise<PendingPasteLeadPropertyImport[]> {
    try {
        const queue = await getQueueInstance();
        const jobs = await queue.getJobs([...PENDING_PROPERTY_IMPORT_STATES], 0, 100, false);
        const pending = await Promise.all(jobs.map(async (job: any) => {
            const data = job?.data as PasteLeadPropertyImportJobData | undefined;
            if (data?.locationId !== args.locationId || data?.conversationId !== args.conversationId) return null;
            const state = String(await job.getState());
            if (!isPendingPasteLeadPropertyImportState(state)) return null;
            return {
                jobId: String(job.id || ""),
                publicReference: String(data.publicReference || "property"),
                state,
            } satisfies PendingPasteLeadPropertyImport;
        }));
        return pending.filter((item): item is PendingPasteLeadPropertyImport => !!item);
    } catch (error) {
        console.warn("[PasteLeadPropertyImport] Draft preflight status unavailable; allowing draft generation", {
            conversationId: args.conversationId,
            error: truncateJobError(error),
        });
        return [];
    }
}

function truncateJobError(error: unknown): string {
    const message = String((error as any)?.message || error || "Unknown error").replace(/\s+/g, " ").trim();
    return message.length > 220 ? `${message.slice(0, 217)}...` : message;
}

function logQueueStatus(
    event: Parameters<ReturnType<typeof createPasteLeadStatusRecorder>>[0],
    state: Parameters<ReturnType<typeof createPasteLeadStatusRecorder>>[1],
    args: {
        pasteLeadTraceId?: string;
        detail?: string;
        latencyMs?: number;
    }
) {
    return createPasteLeadStatusRecorder({
        pasteLeadTraceId: args.pasteLeadTraceId,
        logPrefix: "[PasteLeadPropertyImportStatus]",
    })(event, state, args.detail, args.latencyMs);
}

function getFailedImportConversationNoteBody(args: {
    publicReference?: string;
    oldCrmPropertyId?: string;
    errorMessage: string;
    structuredError: OldCrmPropertyPullError;
}): string {
    const reference = args.publicReference || args.oldCrmPropertyId || "property";
    if (args.structuredError.code === "PROPERTY_NOT_FOUND") {
        return `Property ${reference} was not found in Old CRM.`;
    }
    if (args.structuredError.code === "MISSING_CRM_CONFIG" || args.structuredError.code === "LOGIN_FAILED") {
        return "Old CRM credentials need attention.";
    }
    if (args.structuredError.retryable) {
        return "Old CRM pull failed temporarily; retry is safe.";
    }
    return `Property ${reference} import failed: ${args.errorMessage}`;
}

async function addPropertyImportConversationNote(args: {
    conversationId: string;
    body: string;
}) {
    try {
        await db.message.create({
            data: {
                conversationId: args.conversationId,
                body: args.body,
                direction: "system",
                type: "TYPE_NOTE",
                status: "read",
                createdAt: new Date(),
                source: "system",
            },
        });
    } catch (error) {
        console.error("[PasteLeadPropertyImport] Failed to add conversation note", {
            conversationId: args.conversationId,
            error: truncateJobError(error),
        });
    }
}

function isUnrecoverableQueueError(error: unknown): boolean {
    return String((error as any)?.name || "") === "UnrecoverableError";
}

export function shouldApplyPropertyInterestForImportJob(interestSource?: string | null, pasteLeadTraceId?: string | null): boolean {
    const normalized = String(interestSource || "").trim();
    if (!normalized) return !String(pasteLeadTraceId || "").startsWith("requirements:");
    return normalized === "client_inquired_property"
        || normalized === "agent_note"
        || normalized === "transcript";
}

export async function handlePasteLeadPropertyImportJobFailure(args: {
    job?: PasteLeadPropertyImportFailureJob | null;
    err: Error;
    addNote?: typeof addPropertyImportConversationNote;
}) {
    const job = args.job;
    const addNote = args.addNote || addPropertyImportConversationNote;
    const attemptsMade = Number(job?.attemptsMade || 0);
    const attempts = Number(job?.opts?.attempts || 1);
    const data = job?.data as PasteLeadPropertyImportJobData | undefined;
    const errorMessage = truncateJobError(args.err);
    const structuredError = normalizeOldCrmPropertyPullError(args.err);
    const terminalFailure = attemptsMade >= attempts || isUnrecoverableQueueError(args.err);

    console.error("[Queue] Paste lead property import job failed", {
        pasteLeadTraceId: data?.pasteLeadTraceId,
        jobId: job?.id,
        attemptsMade,
        attempts,
        terminalFailure,
        publicReference: data?.publicReference,
        oldCrmPropertyId: data?.oldCrmPropertyId,
        conversationId: data?.conversationId,
        contactId: data?.contactId,
        error: errorMessage,
        errorCode: structuredError.code,
        retryable: structuredError.retryable,
    });

    logQueueStatus(terminalFailure ? "background_task_failed" : "background_task_started", terminalFailure ? "failed" : "running", {
        pasteLeadTraceId: data?.pasteLeadTraceId,
        detail: `${data?.publicReference || "property"}: ${errorMessage}`,
    });

    if (data?.conversationId && terminalFailure) {
        await addNote({
            conversationId: data.conversationId,
            body: getFailedImportConversationNoteBody({
                publicReference: data.publicReference,
                oldCrmPropertyId: data.oldCrmPropertyId,
                errorMessage,
                structuredError,
            }),
        });
    }
}

export async function processPasteLeadPropertyImportJob(job: PasteLeadPropertyImportJobData) {
    const startedAt = Date.now();
    logQueueStatus("background_task_started", "running", {
        pasteLeadTraceId: job.pasteLeadTraceId,
        detail: `Old CRM pull ${job.publicReference}`,
    });
    const capability = await getOldCrmImportCapabilityForUser({
        locationId: job.locationId,
        userId: job.actorUserId,
    });

    if (!capability.canImportOldCrmProperties) {
        console.warn("[PasteLeadPropertyImport] Skipping job due to missing CRM capability", {
            pasteLeadTraceId: job.pasteLeadTraceId,
            conversationId: job.conversationId,
            contactId: job.contactId,
            publicReference: job.publicReference,
            missing: capability.missing,
            errorCode: "MISSING_CRM_CONFIG",
            retryable: false,
        });
        logQueueStatus("background_task_failed", "failed", {
            pasteLeadTraceId: job.pasteLeadTraceId,
            detail: `Old CRM capability missing for ${job.publicReference}`,
            latencyMs: Date.now() - startedAt,
        });
        return { skipped: true, reason: "missing_capability" as const };
    }

    logQueueStatus("property_existing_lookup_started", "running", {
        pasteLeadTraceId: job.pasteLeadTraceId,
        detail: job.publicReference,
    });
    const existingProperty = await db.property.findFirst({
        where: {
            locationId: job.locationId,
            reference: {
                equals: job.publicReference,
                mode: "insensitive",
            },
        },
        select: {
            id: true,
            goal: true,
            title: true,
            slug: true,
            propertyLocation: true,
            city: true,
        },
    });

    const shouldApplyPropertyInterest = shouldApplyPropertyInterestForImportJob(job.interestSource, job.pasteLeadTraceId);

    if (existingProperty) {
        if (shouldApplyPropertyInterest) {
            await applyPropertyInterestToContact({
                contactId: job.contactId,
                property: existingProperty,
            });
        }
        await addPropertyImportConversationNote({
            conversationId: job.conversationId,
            body: `Property ${job.publicReference} linked from existing app record.`,
        });
        console.log("[PasteLeadPropertyImport] Linked existing property", {
            pasteLeadTraceId: job.pasteLeadTraceId,
            conversationId: job.conversationId,
            contactId: job.contactId,
            propertyId: existingProperty.id,
            publicReference: job.publicReference,
            latencyMs: Date.now() - startedAt,
        });
        logQueueStatus("property_existing_linked", "completed", {
            pasteLeadTraceId: job.pasteLeadTraceId,
            detail: job.publicReference,
            latencyMs: Date.now() - startedAt,
        });
        logQueueStatus("background_task_completed", "completed", {
            pasteLeadTraceId: job.pasteLeadTraceId,
            detail: `Old CRM pull ${job.publicReference}`,
            latencyMs: Date.now() - startedAt,
        });
        return { skipped: false, propertyId: existingProperty.id };
    }

    let imported;
    try {
        imported = await importOldCrmPropertyToLocalDb({
            actorUserId: job.actorUserId,
            locationId: job.locationId,
            oldCrmPropertyId: job.oldCrmPropertyId,
            publicReference: job.publicReference,
            pullMaxAttempts: 1,
        });
    } catch (error) {
        const structuredError = normalizeOldCrmPropertyPullError(error);
        logQueueStatus("background_task_failed", structuredError.retryable ? "running" : "failed", {
            pasteLeadTraceId: job.pasteLeadTraceId,
            detail: `${job.publicReference}: ${structuredError.message}`,
            latencyMs: Date.now() - startedAt,
        });
        if (!structuredError.retryable) {
            const { UnrecoverableError } = await import("bullmq");
            const unrecoverableError = new UnrecoverableError(structuredError.message);
            (unrecoverableError as any).oldCrmPropertyPullError = structuredError;
            throw unrecoverableError;
        }
        throw error;
    }

    const property = await db.property.findUnique({
        where: { id: imported.propertyId },
        select: {
            id: true,
            goal: true,
            title: true,
            slug: true,
            propertyLocation: true,
            city: true,
        },
    });

    if (property && shouldApplyPropertyInterest) {
        await applyPropertyInterestToContact({
            contactId: job.contactId,
            property,
        });
    }

    await addPropertyImportConversationNote({
        conversationId: job.conversationId,
        body: `Property ${job.publicReference} imported and linked.`,
    });

    console.log("[PasteLeadPropertyImport] Imported property in background", {
        pasteLeadTraceId: job.pasteLeadTraceId,
        conversationId: job.conversationId,
        contactId: job.contactId,
        propertyId: imported.propertyId,
        publicReference: job.publicReference,
        warnings: imported.warnings,
        latencyMs: Date.now() - startedAt,
    });

    logQueueStatus("property_existing_linked", "completed", {
        pasteLeadTraceId: job.pasteLeadTraceId,
        detail: job.publicReference,
        latencyMs: Date.now() - startedAt,
    });
    logQueueStatus("background_task_completed", "completed", {
        pasteLeadTraceId: job.pasteLeadTraceId,
        detail: `Old CRM pull ${job.publicReference}`,
        latencyMs: Date.now() - startedAt,
    });

    return {
        skipped: false,
        propertyId: imported.propertyId,
        warnings: imported.warnings,
    };
}

export async function initPasteLeadPropertyImportWorker() {
    if (_workerPromise) return _workerPromise;

    _workerPromise = (async () => {
        const { Worker } = await import("bullmq");
        const worker = new Worker<PasteLeadPropertyImportJobData>(
            QUEUE_NAME,
            async (job: any) => processPasteLeadPropertyImportJob(job.data),
            {
                connection: REDIS_CONNECTION,
                concurrency: 2,
            }
        );

        worker.on("ready", () => {
            console.log("[Queue] Paste lead property import worker is ready.");
        });

        worker.on("failed", (job: any, err: Error) => {
            void handlePasteLeadPropertyImportJobFailure({ job, err });
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

export async function enqueuePasteLeadPropertyImport(
    input: EnqueuePasteLeadPropertyImportInput
): Promise<EnqueuePasteLeadPropertyImportResult> {
    const jobId = buildQueueJobId("paste_lead_property_import", input.conversationId, input.publicReference);

    try {
        await initPasteLeadPropertyImportWorker();
        const queue = await getQueueInstance();
        const existingJob = await queue.getJob(jobId);
        if (existingJob) {
            const existingState = await existingJob.getState();
            if (existingState === "failed") {
                await existingJob.remove();
                console.warn("[PasteLeadPropertyImport] Removed failed duplicate job before requeue", {
                    pasteLeadTraceId: input.pasteLeadTraceId,
                    jobId,
                    conversationId: input.conversationId,
                    publicReference: input.publicReference,
                    failedReason: truncateJobError(existingJob.failedReason),
                });
            } else {
                logQueueStatus("property_import_already_queued", "completed", {
                    pasteLeadTraceId: input.pasteLeadTraceId,
                    detail: input.publicReference,
                });
                return {
                    accepted: true,
                    mode: "already-queued",
                    jobId,
                };
            }
        }

        await queue.add(
            "import-property",
            {
                ...input,
                queuedAt: new Date().toISOString(),
            },
            {
                jobId,
                attempts: 3,
                backoff: {
                    type: "exponential",
                    delay: 2000,
                },
            }
        );

        logQueueStatus("property_import_queued", "completed", {
            pasteLeadTraceId: input.pasteLeadTraceId,
            detail: input.publicReference,
        });

        return {
            accepted: true,
            mode: "queued",
            jobId,
        };
    } catch (error) {
        if (isDuplicateQueueJobError(error)) {
            return {
                accepted: true,
                mode: "already-queued",
                jobId,
            };
        }
        console.error("[PasteLeadPropertyImport] Queue unavailable", {
            pasteLeadTraceId: input.pasteLeadTraceId,
            conversationId: input.conversationId,
            publicReference: input.publicReference,
            error: String((error as any)?.message || error),
        });
        logQueueStatus("property_import_failed_to_queue", "failed", {
            pasteLeadTraceId: input.pasteLeadTraceId,
            detail: `${input.publicReference}: ${String((error as any)?.message || error)}`,
        });
        return {
            accepted: false,
            mode: "queue-unavailable",
            jobId,
            error: String((error as any)?.message || "Failed to enqueue job."),
        };
    }
}
