import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import db from '@/lib/db';
import { verifyUserIsLocationAdmin } from '@/lib/auth/permissions';
import { getScrapingQueueDiagnostics } from '@/lib/queue/scraping-queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SNAPSHOT_INTERVAL_MS = 2_500;
const HEARTBEAT_INTERVAL_MS = 20_000;
const RUN_LIMIT = 20;
const STAGE_LIMIT = 60;

function buildSnapshotFingerprint(payload: {
    runs: Array<{
        id: string;
        status: string;
        updatedAt: string;
        completedAt: string | null;
        errorsTotal: number;
        stages: Array<{ id: string; createdAt: string; status: string; reasonCode: string | null }>;
    }>;
    diagnostics: {
        workerAlive: boolean;
        workerReady: boolean;
        workerHeartbeatAgeSeconds: number | null;
        queueDepth: {
            waiting: number;
            active: number;
            delayed: number;
            paused: number;
            failed: number;
            completed: number;
        };
        recentFailedJobs: Array<{ id: string; failedReason: string | null; finishedOn: string | null }>;
    };
}) {
    return JSON.stringify({
        runs: payload.runs.map((run) => ({
            id: run.id,
            status: run.status,
            updatedAt: run.updatedAt,
            completedAt: run.completedAt,
            errorsTotal: run.errorsTotal,
            stages: run.stages.map((stage) => ({
                id: stage.id,
                createdAt: stage.createdAt,
                status: stage.status,
                reasonCode: stage.reasonCode,
            })),
        })),
        diagnostics: payload.diagnostics,
    });
}

export async function GET(req: NextRequest) {
    const { userId } = await auth();
    if (!userId) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const locationId = req.nextUrl.searchParams.get('locationId')?.trim();
    if (!locationId) {
        return NextResponse.json({ success: false, error: 'Missing locationId' }, { status: 400 });
    }

    const isAdmin = await verifyUserIsLocationAdmin(userId, locationId);
    if (!isAdmin) {
        return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const encoder = new TextEncoder();
    let cancelCleanup: (() => void) | null = null;

    const stream = new ReadableStream({
        start(controller) {
            let closed = false;
            let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
            let snapshotTimer: ReturnType<typeof setInterval> | null = null;
            let snapshotInFlight = false;
            let lastFingerprint: string | null = null;

            const sendComment = (comment: string) => {
                if (closed) return;
                controller.enqueue(encoder.encode(`:${comment}\n\n`));
            };

            const sendEvent = (event: string, data: unknown) => {
                if (closed) return;
                controller.enqueue(encoder.encode(`event: ${event}\n`));
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
            };

            const loadSnapshot = async () => {
                const [runs, diagnostics] = await Promise.all([
                    db.deepScrapeRun.findMany({
                        where: { locationId },
                        include: {
                            stages: {
                                orderBy: { createdAt: 'desc' },
                                take: STAGE_LIMIT,
                            },
                        },
                        orderBy: { createdAt: 'desc' },
                        take: RUN_LIMIT,
                    }),
                    getScrapingQueueDiagnostics(),
                ]);

                const serializedRuns = runs.map((run) => ({
                    ...run,
                    createdAt: run.createdAt.toISOString(),
                    updatedAt: run.updatedAt.toISOString(),
                    queuedAt: run.queuedAt ? run.queuedAt.toISOString() : null,
                    startedAt: run.startedAt ? run.startedAt.toISOString() : null,
                    completedAt: run.completedAt ? run.completedAt.toISOString() : null,
                    stages: run.stages.map((stage) => ({
                        ...stage,
                        createdAt: stage.createdAt.toISOString(),
                    })),
                }));

                return {
                    locationId,
                    ts: new Date().toISOString(),
                    runs: serializedRuns,
                    diagnostics,
                };
            };

            const emitSnapshot = async (force = false) => {
                if (closed || snapshotInFlight) return;
                snapshotInFlight = true;
                try {
                    const snapshot = await loadSnapshot();
                    const fingerprint = buildSnapshotFingerprint({
                        runs: snapshot.runs,
                        diagnostics: {
                            workerAlive: snapshot.diagnostics.workerAlive,
                            workerReady: snapshot.diagnostics.workerReady,
                            workerHeartbeatAgeSeconds: snapshot.diagnostics.workerHeartbeatAgeSeconds,
                            queueDepth: snapshot.diagnostics.queueDepth,
                            recentFailedJobs: snapshot.diagnostics.recentFailedJobs.map((job) => ({
                                id: job.id,
                                failedReason: job.failedReason,
                                finishedOn: job.finishedOn,
                            })),
                        },
                    });

                    if (force || lastFingerprint !== fingerprint) {
                        lastFingerprint = fingerprint;
                        sendEvent('snapshot', snapshot);
                    }
                } catch (error: any) {
                    sendEvent('error', {
                        message: error?.message || 'Failed to load deep run snapshot',
                    });
                } finally {
                    snapshotInFlight = false;
                }
            };

            const cleanup = () => {
                if (closed) return;
                closed = true;
                cancelCleanup = null;
                if (heartbeatTimer) {
                    clearInterval(heartbeatTimer);
                    heartbeatTimer = null;
                }
                if (snapshotTimer) {
                    clearInterval(snapshotTimer);
                    snapshotTimer = null;
                }
                try {
                    controller.close();
                } catch {
                    // Ignore close errors on aborted streams.
                }
            };
            cancelCleanup = cleanup;

            const onAbort = () => {
                cleanup();
            };
            req.signal.addEventListener('abort', onAbort);

            sendEvent('connected', {
                locationId,
                ts: new Date().toISOString(),
            });
            void emitSnapshot(true);

            snapshotTimer = setInterval(() => {
                void emitSnapshot(false);
            }, SNAPSHOT_INTERVAL_MS);

            heartbeatTimer = setInterval(() => {
                sendComment(`heartbeat ${Date.now()}`);
            }, HEARTBEAT_INTERVAL_MS);
        },
        cancel() {
            if (cancelCleanup) {
                cancelCleanup();
                cancelCleanup = null;
            }
        },
    });

    return new Response(stream, {
        status: 200,
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
        },
    });
}
