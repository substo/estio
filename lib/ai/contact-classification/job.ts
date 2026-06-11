import { randomUUID } from "crypto";
import db from "@/lib/db";
import { verifyContactProfile } from "@/lib/ai/contact-verification/service";
import { normalizeContactProfileVerificationConfig } from "@/lib/ai/contact-profile-verification/config";
import { triggerGlobalContactProfileRecertification } from "@/lib/ai/contact-profile-verification/cron";
import { settingsService } from "@/lib/settings/service";
import { SETTINGS_DOMAINS } from "@/lib/settings/constants";
import { reprocessVerifiedContactProfileBlocks } from "@/lib/property-match-campaigns/service";

export type ContactClassificationRunStatus = "queued" | "running" | "paused" | "completed" | "failed" | "canceled";

const ACTIVE_RUN_STATUSES: ContactClassificationRunStatus[] = ["queued", "running", "paused"];
const STALE_LOCK_MS = 10 * 60 * 1000;

type RunRow = {
    id: string;
    locationId: string;
    status: ContactClassificationRunStatus;
    source: string;
    model: string;
    totalQueued: number;
    checked: number;
    verified: number;
    proposals: number;
    skipped: number;
    failures: number;
    reprocessedCampaignBlocks: number;
    startedAt?: Date | null;
    finishedAt?: Date | null;
    lastHeartbeatAt?: Date | null;
    pauseRequestedAt?: Date | null;
    cancelRequestedAt?: Date | null;
    lastError?: string | null;
    createdAt: Date;
    updatedAt: Date;
};

type RunItemRow = {
    id: string;
    runId: string;
    locationId: string;
    contactId: string;
    status: string;
    attemptCount: number;
    lastError?: string | null;
};

function runModel() {
    return (db as any).contactClassificationRun;
}

function itemModel() {
    return (db as any).contactClassificationRunItem;
}

function addHours(date: Date, hours: number) {
    return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function serializeDate(value?: Date | string | null) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function getLocationVerificationSettings(locationId: string) {
    const doc = await settingsService.getDocument<any>({
        scopeType: "LOCATION",
        scopeId: locationId,
        domain: SETTINGS_DOMAINS.LOCATION_AI,
    }).catch(() => null);
    return normalizeContactProfileVerificationConfig(doc?.payload?.contactProfileVerification);
}

async function recordSuccess(args: {
    contactId: string;
    now: Date;
}) {
    await db.contact.update({
        where: { id: args.contactId },
        data: {
            profileVerificationLastAttemptAt: args.now,
            profileVerificationLastError: null,
            profileVerificationAttemptCount: { increment: 1 },
            profileVerificationDueAt: null,
        } as any,
    });
}

async function recordFailure(args: {
    contact: { id: string; profileVerificationAttemptCount?: number | null };
    now: Date;
    error: string;
}) {
    const attempts = Number(args.contact.profileVerificationAttemptCount || 0) + 1;
    const backoffHours = Math.min(24, Math.max(1, 2 ** Math.min(5, attempts - 1)));
    await db.contact.update({
        where: { id: args.contact.id },
        data: {
            profileVerificationLastAttemptAt: args.now,
            profileVerificationLastError: args.error.slice(0, 4000),
            profileVerificationAttemptCount: { increment: 1 },
            profileVerificationDueAt: addHours(args.now, backoffHours),
        } as any,
    });
}

function toPublicRun(run: RunRow | null, counts?: {
    queued?: number;
    running?: number;
    completed?: number;
    skipped?: number;
    failed?: number;
}) {
    if (!run) return null;
    const totalQueued = Number(run.totalQueued || 0);
    const checked = Number(run.checked || 0);
    const terminalCount = checked + Number(run.skipped || 0) + Number(run.failures || 0);
    const remaining = Math.max(0, totalQueued - terminalCount);
    const finishedAt = serializeDate(run.finishedAt);
    return {
        id: run.id,
        locationId: run.locationId,
        status: run.status,
        source: run.source,
        model: run.model,
        totalQueued,
        checked,
        verified: Number(run.verified || 0),
        proposals: Number(run.proposals || 0),
        skipped: Number(run.skipped || 0),
        failures: Number(run.failures || 0),
        reprocessedCampaignBlocks: Number(run.reprocessedCampaignBlocks || 0),
        remaining,
        progressPercent: totalQueued > 0
            ? Math.max(0, Math.min(100, Math.round((terminalCount / totalQueued) * 100)))
            : 100,
        startedAt: serializeDate(run.startedAt),
        finishedAt,
        lastHeartbeatAt: serializeDate(run.lastHeartbeatAt),
        lastError: run.lastError || null,
        createdAt: serializeDate(run.createdAt),
        updatedAt: serializeDate(run.updatedAt),
        counts: counts || null,
    };
}

export async function getCurrentContactClassificationRun(args: {
    locationId: string;
}) {
    const activeRun = await runModel().findFirst({
        where: {
            locationId: args.locationId,
            status: { in: ACTIVE_RUN_STATUSES },
        },
        orderBy: { createdAt: "desc" },
    });
    const run = activeRun || await runModel().findFirst({
        where: { locationId: args.locationId },
        orderBy: { createdAt: "desc" },
    });
    if (!run) return null;

    const grouped = await itemModel().groupBy({
        by: ["status"],
        where: { runId: run.id },
        _count: { _all: true },
    });
    const counts = Object.fromEntries(
        grouped.map((row: any) => [row.status, Number(row._count?._all || 0)])
    );
    return toPublicRun(run, counts);
}

export async function startContactClassificationRun(args: {
    locationId: string;
    model: string;
    requestedByUserId?: string | null;
}) {
    const existingRun = await runModel().findFirst({
        where: {
            locationId: args.locationId,
            status: { in: ACTIVE_RUN_STATUSES },
        },
        orderBy: { createdAt: "desc" },
    });
    if (existingRun) {
        if (existingRun.status === "paused") {
            await runModel().update({
                where: { id: existingRun.id },
                data: {
                    status: "queued",
                    pauseRequestedAt: null,
                    lastHeartbeatAt: new Date(),
                },
            });
        }
        return {
            created: false,
            run: await getCurrentContactClassificationRun({ locationId: args.locationId }),
        };
    }

    const now = new Date();
    await triggerGlobalContactProfileRecertification({ locationId: args.locationId, now });
    const contacts = await db.contact.findMany({
        where: {
            locationId: args.locationId,
            contactType: { in: ["Lead", "Contact"] },
            profileVerificationDueAt: { lte: now },
            requirementProposals: {
                none: { proposalType: "verification", status: "pending" },
            },
        } as any,
        select: { id: true },
        orderBy: [{ profileVerificationDueAt: "asc" }, { createdAt: "asc" }],
        take: 10000,
    });

    const run = await runModel().create({
        data: {
            locationId: args.locationId,
            status: contacts.length > 0 ? "queued" : "completed",
            source: "manual",
            model: args.model,
            totalQueued: contacts.length,
            requestedByUserId: args.requestedByUserId || null,
            startedAt: contacts.length > 0 ? now : null,
            finishedAt: contacts.length > 0 ? null : now,
            lastHeartbeatAt: now,
        },
    });

    if (contacts.length > 0) {
        await itemModel().createMany({
            data: contacts.map((contact) => ({
                runId: run.id,
                locationId: args.locationId,
                contactId: contact.id,
                status: "queued",
            })),
            skipDuplicates: true,
        });
    }

    console.info("[contact-classification:job] Run started", {
        locationId: args.locationId,
        runId: run.id,
        model: args.model,
        totalQueued: contacts.length,
    });

    return {
        created: true,
        run: await getCurrentContactClassificationRun({ locationId: args.locationId }),
    };
}

export async function pauseContactClassificationRun(args: {
    locationId: string;
    runId: string;
}) {
    await runModel().updateMany({
        where: { id: args.runId, locationId: args.locationId, status: { in: ["queued", "running"] } },
        data: { status: "paused", pauseRequestedAt: new Date(), lastHeartbeatAt: new Date() },
    });
    return getCurrentContactClassificationRun({ locationId: args.locationId });
}

export async function resumeContactClassificationRun(args: {
    locationId: string;
    runId: string;
}) {
    await runModel().updateMany({
        where: { id: args.runId, locationId: args.locationId, status: "paused" },
        data: { status: "queued", pauseRequestedAt: null, lastHeartbeatAt: new Date() },
    });
    return getCurrentContactClassificationRun({ locationId: args.locationId });
}

export async function cancelContactClassificationRun(args: {
    locationId: string;
    runId: string;
}) {
    const now = new Date();
    const skippedItems = await itemModel().updateMany({
        where: { runId: args.runId, status: { in: ["queued", "running"] } },
        data: { status: "skipped", finishedAt: now, lockedAt: null, lockedBy: null, lastError: "Run canceled." },
    });
    await runModel().updateMany({
        where: { id: args.runId, locationId: args.locationId, status: { in: ACTIVE_RUN_STATUSES } },
        data: {
            status: "canceled",
            cancelRequestedAt: now,
            finishedAt: now,
            lastHeartbeatAt: now,
            skipped: skippedItems.count > 0 ? { increment: skippedItems.count } : undefined,
        },
    });
    return getCurrentContactClassificationRun({ locationId: args.locationId });
}

export async function recoverStaleContactClassificationRuns(args?: {
    now?: Date;
}) {
    const now = args?.now || new Date();
    const staleBefore = new Date(now.getTime() - STALE_LOCK_MS);
    const staleItems = await itemModel().updateMany({
        where: {
            status: "running",
            lockedAt: { lt: staleBefore },
        },
        data: {
            status: "queued",
            lockedAt: null,
            lockedBy: null,
            lastError: "Recovered stale processing lock.",
        },
    });
    const staleRuns = await runModel().updateMany({
        where: {
            status: "running",
            lastHeartbeatAt: { lt: staleBefore },
        },
        data: {
            status: "queued",
            lastError: "Recovered stale processing lock.",
        },
    });
    return { items: staleItems.count, runs: staleRuns.count };
}

async function claimNextItem(args: {
    runId: string;
    workerId: string;
    now: Date;
}): Promise<RunItemRow | null> {
    const nextItem = await itemModel().findFirst({
        where: { runId: args.runId, status: "queued" },
        orderBy: { createdAt: "asc" },
    });
    if (!nextItem) return null;

    const updated = await itemModel().updateMany({
        where: { id: nextItem.id, status: "queued" },
        data: {
            status: "running",
            lockedAt: args.now,
            lockedBy: args.workerId,
            startedAt: args.now,
            attemptCount: { increment: 1 },
        },
    });
    if (updated.count !== 1) return null;
    return itemModel().findUnique({ where: { id: nextItem.id } });
}

async function refreshRunCounters(runId: string) {
    const grouped = await itemModel().groupBy({
        by: ["status"],
        where: { runId },
        _count: { _all: true },
    });
    const counts = Object.fromEntries(
        grouped.map((row: any) => [row.status, Number(row._count?._all || 0)])
    );
    const run = await runModel().findUnique({ where: { id: runId } });
    if (!run) return null;
    const terminalCount = Number(counts.completed || 0) + Number(counts.skipped || 0) + Number(counts.failed || 0);
    const now = new Date();
    if (terminalCount >= Number(run.totalQueued || 0) && !["paused", "canceled"].includes(run.status)) {
        const status = Number(run.failures || 0) > 0 ? "failed" : "completed";
        return runModel().update({
            where: { id: runId },
            data: {
                status,
                finishedAt: now,
                lastHeartbeatAt: now,
                lastError: status === "failed" ? `${Number(run.failures || 0)} contact(s) failed.` : null,
            },
        });
    }
    return run;
}

export async function processContactClassificationRun(args: {
    runId: string;
    workerId?: string;
    maxContacts?: number;
}) {
    const workerId = args.workerId || `contact-classification:${randomUUID()}`;
    const maxContacts = Math.max(1, Math.min(250, Number(args.maxContacts || 250)));
    await recoverStaleContactClassificationRuns();

    let processed = 0;
    while (processed < maxContacts) {
        const now = new Date();
        const run = await runModel().findUnique({ where: { id: args.runId } }) as RunRow | null;
        if (!run) return { outcome: "missing_run" as const, processed };
        if (run.status === "paused") return { outcome: "paused" as const, processed };
        if (run.status === "canceled") return { outcome: "canceled" as const, processed };
        if (!["queued", "running"].includes(run.status)) return { outcome: "not_active" as const, processed };

        await runModel().update({
            where: { id: run.id },
            data: {
                status: "running",
                startedAt: run.startedAt || now,
                lastHeartbeatAt: now,
            },
        });

        const item = await claimNextItem({ runId: run.id, workerId, now });
        if (!item) {
            await refreshRunCounters(run.id);
            return { outcome: "drained" as const, processed };
        }

        processed += 1;
        console.info("[contact-classification:job] Contact started", {
            locationId: run.locationId,
            runId: run.id,
            itemId: item.id,
            contactId: item.contactId,
            model: run.model,
            processed,
        });

        const contact = await db.contact.findFirst({
            where: { id: item.contactId, locationId: run.locationId },
            select: {
                id: true,
                profileVerificationAttemptCount: true,
                conversations: {
                    where: { locationId: run.locationId, deletedAt: null },
                    orderBy: { lastMessageAt: "desc" },
                    take: 1,
                    select: { id: true },
                },
            } as any,
        } as any);

        if (!contact) {
            await itemModel().update({
                where: { id: item.id },
                data: {
                    status: "failed",
                    finishedAt: new Date(),
                    lockedAt: null,
                    lockedBy: null,
                    lastError: "Contact not found.",
                },
            });
            await runModel().update({
                where: { id: run.id },
                data: { failures: { increment: 1 }, lastHeartbeatAt: new Date(), lastError: "Contact not found." },
            });
            continue;
        }

        try {
            const result = await verifyContactProfile({
                locationId: run.locationId,
                contactId: contact.id,
                conversationId: contact.conversations?.[0]?.id || null,
                sourceType: "manual_verification",
                reprocessCampaignBlocks: false,
                modelOverride: run.model,
            });

            if (!result.success) {
                const error = result.error || "Verification failed.";
                await recordFailure({ contact, now: new Date(), error });
                await itemModel().update({
                    where: { id: item.id },
                    data: {
                        status: "failed",
                        finishedAt: new Date(),
                        lockedAt: null,
                        lockedBy: null,
                        lastError: error.slice(0, 4000),
                    },
                });
                await runModel().update({
                    where: { id: run.id },
                    data: { failures: { increment: 1 }, lastHeartbeatAt: new Date(), lastError: error.slice(0, 4000) },
                });
                continue;
            }

            if (!result.assessment && /pending contact verification proposal/i.test(String(result.reason || ""))) {
                await itemModel().update({
                    where: { id: item.id },
                    data: {
                        status: "skipped",
                        resultStatus: "pending_verification_proposal",
                        finishedAt: new Date(),
                        lockedAt: null,
                        lockedBy: null,
                    },
                });
                await runModel().update({
                    where: { id: run.id },
                    data: { skipped: { increment: 1 }, lastHeartbeatAt: new Date() },
                });
                continue;
            }

            await recordSuccess({ contactId: contact.id, now: new Date() });
            const settings = await getLocationVerificationSettings(run.locationId);
            let reprocessedCampaignBlocks = 0;
            if (result.assessment?.status === "verified_lead" && settings.autoReprocessCampaignBlocks) {
                const reprocessed = await reprocessVerifiedContactProfileBlocks({
                    locationId: run.locationId,
                    contactId: contact.id,
                    limit: 100,
                });
                reprocessedCampaignBlocks = Number(reprocessed.reprocessed || 0);
            }

            const resultStatus = result.assessment?.status || (result.created ? "proposal_created" : "unchanged");
            await itemModel().update({
                where: { id: item.id },
                data: {
                    status: "completed",
                    resultStatus,
                    proposalId: result.created ? result.proposal?.id || null : null,
                    finishedAt: new Date(),
                    lockedAt: null,
                    lockedBy: null,
                    lastError: null,
                },
            });
            await runModel().update({
                where: { id: run.id },
                data: {
                    checked: { increment: 1 },
                    verified: result.assessment?.status === "verified_lead" ? { increment: 1 } : undefined,
                    proposals: result.created ? { increment: 1 } : undefined,
                    reprocessedCampaignBlocks: reprocessedCampaignBlocks > 0 ? { increment: reprocessedCampaignBlocks } : undefined,
                    lastHeartbeatAt: new Date(),
                    lastError: null,
                },
            });

            console.info("[contact-classification:job] Contact completed", {
                locationId: run.locationId,
                runId: run.id,
                itemId: item.id,
                contactId: item.contactId,
                model: run.model,
                status: resultStatus,
                createdProposal: Boolean(result.created),
            });
        } catch (error: any) {
            const message = String(error?.message || "Verification failed.");
            await recordFailure({ contact, now: new Date(), error: message });
            await itemModel().update({
                where: { id: item.id },
                data: {
                    status: "failed",
                    finishedAt: new Date(),
                    lockedAt: null,
                    lockedBy: null,
                    lastError: message.slice(0, 4000),
                },
            });
            await runModel().update({
                where: { id: run.id },
                data: {
                    failures: { increment: 1 },
                    lastHeartbeatAt: new Date(),
                    lastError: message.slice(0, 4000),
                },
            });
            console.error("[contact-classification:job] Contact failed", {
                locationId: run.locationId,
                runId: run.id,
                itemId: item.id,
                contactId: item.contactId,
                error: message,
            });
        }

        await refreshRunCounters(run.id);
    }

    return { outcome: "processed_limit" as const, processed };
}

export async function listActiveContactClassificationRunIds(args?: {
    limit?: number;
}) {
    const runs = await runModel().findMany({
        where: { status: { in: ["queued", "running"] } },
        orderBy: { createdAt: "asc" },
        select: { id: true },
        take: Math.max(1, Math.min(200, Number(args?.limit || 100))),
    });
    return runs.map((run: { id: string }) => run.id);
}
