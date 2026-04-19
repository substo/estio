import db from "@/lib/db";
import { applyPropertyInterestToContact } from "@/lib/leads/contact-property-interest";
import { importOldCrmPropertyToLocalDb } from "@/lib/crm/old-crm-property-import-service";
import { getOldCrmImportCapabilityForUser, type LegacyCrmRefCandidate } from "@/lib/crm/old-crm-import";
import { buildQueueJobId, isDuplicateQueueJobError } from "@/lib/queue/job-id";

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
    queuedAt: string;
}

export interface EnqueuePasteLeadPropertyImportInput extends Omit<PasteLeadPropertyImportJobData, "queuedAt"> {}

export type EnqueuePasteLeadPropertyImportResult = {
    accepted: boolean;
    mode: "queued" | "already-queued" | "queue-unavailable";
    jobId: string;
    error?: string;
};

let _queuePromise: Promise<any> | null = null;
let _workerPromise: Promise<any> | null = null;

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

export async function processPasteLeadPropertyImportJob(job: PasteLeadPropertyImportJobData) {
    const startedAt = Date.now();
    const capability = await getOldCrmImportCapabilityForUser({
        locationId: job.locationId,
        userId: job.actorUserId,
    });

    if (!capability.canImportOldCrmProperties) {
        console.warn("[PasteLeadPropertyImport] Skipping job due to missing CRM capability", {
            conversationId: job.conversationId,
            contactId: job.contactId,
            publicReference: job.publicReference,
            missing: capability.missing,
        });
        return { skipped: true, reason: "missing_capability" as const };
    }

    const existingProperty = await db.property.findFirst({
        where: {
            locationId: job.locationId,
            reference: job.publicReference,
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

    if (existingProperty) {
        await applyPropertyInterestToContact({
            contactId: job.contactId,
            property: existingProperty,
        });
        console.log("[PasteLeadPropertyImport] Linked existing property", {
            conversationId: job.conversationId,
            contactId: job.contactId,
            propertyId: existingProperty.id,
            publicReference: job.publicReference,
            latencyMs: Date.now() - startedAt,
        });
        return { skipped: false, propertyId: existingProperty.id };
    }

    const imported = await importOldCrmPropertyToLocalDb({
        actorUserId: job.actorUserId,
        locationId: job.locationId,
        oldCrmPropertyId: job.oldCrmPropertyId,
        publicReference: job.publicReference,
    });

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

    if (property) {
        await applyPropertyInterestToContact({
            contactId: job.contactId,
            property,
        });
    }

    console.log("[PasteLeadPropertyImport] Imported property in background", {
        conversationId: job.conversationId,
        contactId: job.contactId,
        propertyId: imported.propertyId,
        publicReference: job.publicReference,
        warnings: imported.warnings,
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
            console.error(`[Queue] Paste lead property import job ${job?.id} failed: ${err.message}`);
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
            return {
                accepted: true,
                mode: "already-queued",
                jobId,
            };
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
            conversationId: input.conversationId,
            publicReference: input.publicReference,
            error: String((error as any)?.message || error),
        });
        return {
            accepted: false,
            mode: "queue-unavailable",
            jobId,
            error: String((error as any)?.message || "Failed to enqueue job."),
        };
    }
}
