'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    getDeepScrapeQueueDiagnostics,
    getDeepScrapeRunDetails,
    getDeepScrapeRuns,
    type DeepScrapeQueueDiagnostics,
    type DeepScrapeRunOverview,
    type ManualDeepScrapeTriggerResult,
} from '../actions';
import { isQueuedRunStale } from '@/lib/scraping/deep-scrape-types';
import {
    AlertTriangle,
    CheckCircle2,
    ChevronDown,
    ChevronRight,
    Clock3,
    Loader2,
    MinusCircle,
    XCircle,
} from 'lucide-react';

interface DeepScrapeRunStage {
    id: string;
    createdAt: Date | string;
    taskId: string | null;
    stage: string;
    status: string;
    reasonCode: string | null;
    message: string | null;
    counters?: Record<string, unknown> | null;
    metadata?: Record<string, unknown> | null;
}

interface DeepScrapeRun {
    id: string;
    createdAt: Date | string;
    updatedAt?: Date | string;
    queuedAt?: Date | string | null;
    startedAt?: Date | string | null;
    status: string;
    queueJobId?: string | null;
    completedAt: Date | string | null;
    triggeredBy: string | null;
    triggeredByUserId: string | null;
    seedListingsFound: number;
    contactsWithPhone: number;
    contactsWithoutPhone: number;
    portfolioListingsDeepScraped: number;
    omittedAgency: number;
    omittedUncertain: number;
    omittedMissingPhone: number;
    omittedNonRealEstate: number;
    omittedDuplicate: number;
    omittedBudgetExhausted: number;
    errorsTotal: number;
    errorLog: string | null;
    configSnapshot?: Record<string, unknown> | null;
    stages: DeepScrapeRunStage[];
}

function isInFlightStatus(status: string) {
    return status === 'queued' || status === 'running';
}

function formatTime(value: Date | string | null | undefined) {
    if (!value) return '—';
    const d = new Date(value);
    if (!Number.isFinite(d.getTime())) return '—';
    return d.toLocaleString('en-GB', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
}

function formatDuration(start: Date | string, end: Date | string | null) {
    const startMs = new Date(start).getTime();
    if (!Number.isFinite(startMs)) return '—';

    const endMs = end ? new Date(end).getTime() : Date.now();
    if (!Number.isFinite(endMs)) return '—';

    const ms = Math.max(0, endMs - startMs);
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function toPrettySource(value: string | null) {
    if (!value) return 'Unknown';
    if (value === 'manual') return 'Manual';
    if (value === 'scheduled') return 'Scheduled';
    if (value === 'system') return 'System';
    return value;
}

function getDisplayStatus(run: DeepScrapeRun) {
    if (run.status === 'running') {
        const hasProgress = (run.stages || []).some((stage) => stage.stage !== 'run_queued');
        return hasProgress ? 'running' : 'starting';
    }
    return run.status;
}

function StatusBadge({ status }: { status: string }) {
    switch (status) {
        case 'queued':
            return (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-slate-500/15 text-slate-700 dark:text-slate-300">
                    <Clock3 className="w-3 h-3" /> Queued
                </span>
            );
        case 'starting':
            return (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-cyan-500/15 text-cyan-600 dark:text-cyan-400">
                    <Loader2 className="w-3 h-3 animate-spin" /> Starting
                </span>
            );
        case 'running':
            return (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-500/15 text-blue-600 dark:text-blue-400">
                    <Loader2 className="w-3 h-3 animate-spin" /> Running
                </span>
            );
        case 'completed':
            return (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/15 text-green-600 dark:text-green-400">
                    <CheckCircle2 className="w-3 h-3" /> Completed
                </span>
            );
        case 'partial':
            return (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/15 text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="w-3 h-3" /> Partial
                </span>
            );
        case 'failed':
            return (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/15 text-red-600 dark:text-red-400">
                    <XCircle className="w-3 h-3" /> Failed
                </span>
            );
        case 'cancelled':
            return (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-orange-500/15 text-orange-600 dark:text-orange-400">
                    <MinusCircle className="w-3 h-3" /> Cancelled
                </span>
            );
        default:
            return (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
                    {status}
                </span>
            );
    }
}

function mergeRunById(runs: DeepScrapeRun[], nextRun: DeepScrapeRun) {
    const rest = runs.filter((run) => run.id !== nextRun.id);
    return [nextRun, ...rest];
}

export function DeepRunsPanel({
    locationId,
    initialRuns,
    initialDiagnostics,
    overview,
}: {
    locationId: string;
    initialRuns: DeepScrapeRun[];
    initialDiagnostics: DeepScrapeQueueDiagnostics;
    overview: DeepScrapeRunOverview;
}) {
    const [runs, setRuns] = useState<DeepScrapeRun[]>(initialRuns || []);
    const [diagnostics, setDiagnostics] = useState<DeepScrapeQueueDiagnostics>(initialDiagnostics);
    const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
    const [expandedStageRunId, setExpandedStageRunId] = useState<string | null>(null);
    const [loadingDetailsRunId, setLoadingDetailsRunId] = useState<string | null>(null);
    const [sseConnected, setSseConnected] = useState(false);
    const [sseFallbackMessage, setSseFallbackMessage] = useState<string | null>(null);
    const [triggerWarningMessage, setTriggerWarningMessage] = useState<string | null>(null);

    const hasInFlight = useMemo(
        () => runs.some((run) => isInFlightStatus(run.status)),
        [runs],
    );
    const inFlightCount = useMemo(
        () => runs.filter((run) => isInFlightStatus(run.status)).length,
        [runs],
    );
    const staleQueuedCount = useMemo(
        () => runs.filter((run) => run.status === 'queued' && isQueuedRunStale(run.queuedAt || run.createdAt)).length,
        [runs],
    );
    const showWorkerUnavailableWarning = staleQueuedCount > 0 && !diagnostics.workerReady;

    const refresh = useCallback(async () => {
        try {
            const [freshRuns, freshDiagnostics] = await Promise.all([
                getDeepScrapeRuns(locationId, 20),
                getDeepScrapeQueueDiagnostics(locationId),
            ]);
            setRuns(freshRuns as unknown as DeepScrapeRun[]);
            setDiagnostics(freshDiagnostics);
        } catch {
            // silent fallback while polling
        }
    }, [locationId]);

    useEffect(() => {
        if (!expandedRunId) return;
        let cancelled = false;

        const load = async () => {
            setLoadingDetailsRunId(expandedRunId);
            try {
                const details = await getDeepScrapeRunDetails(locationId, expandedRunId, 250);
                if (cancelled || !details) return;
                setRuns((prev) => prev.map((run) => (
                    run.id === expandedRunId
                        ? { ...run, ...(details as unknown as DeepScrapeRun) }
                        : run
                )));
            } catch {
                // keep current payload
            } finally {
                if (!cancelled) setLoadingDetailsRunId(null);
            }
        };

        void load();
        return () => {
            cancelled = true;
        };
    }, [expandedRunId, locationId]);

    useEffect(() => {
        const shouldPoll = !sseConnected || hasInFlight;
        if (!shouldPoll) return;
        const interval = setInterval(() => {
            void refresh();
        }, 5000);
        return () => clearInterval(interval);
    }, [hasInFlight, refresh, sseConnected]);

    useEffect(() => {
        const handler = (event: Event) => {
            const detail = (event as CustomEvent<ManualDeepScrapeTriggerResult>).detail;
            if (detail?.run?.id) {
                setRuns((prev) => mergeRunById(prev, detail.run as unknown as DeepScrapeRun));
            }
            if (detail?.warning?.message) {
                setTriggerWarningMessage(detail.warning.message);
            }

            void refresh();
            setTimeout(() => void refresh(), 2000);
            setTimeout(() => void refresh(), 5000);
        };

        window.addEventListener('deep-run-queued', handler);
        return () => window.removeEventListener('deep-run-queued', handler);
    }, [refresh]);

    useEffect(() => {
        if (!triggerWarningMessage) return;
        const timeout = setTimeout(() => {
            setTriggerWarningMessage(null);
        }, 12_000);
        return () => clearTimeout(timeout);
    }, [triggerWarningMessage]);

    useEffect(() => {
        let source: EventSource | null = null;
        let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
        let closed = false;

        const connect = () => {
            if (closed) return;
            source = new EventSource(`/api/admin/prospecting/deep-runs/stream?locationId=${encodeURIComponent(locationId)}`);

            source.addEventListener('connected', () => {
                setSseConnected(true);
                setSseFallbackMessage(null);
            });

            source.addEventListener('snapshot', (event) => {
                try {
                    const payload = JSON.parse((event as MessageEvent).data) as {
                        runs?: DeepScrapeRun[];
                        diagnostics?: DeepScrapeQueueDiagnostics;
                    };
                    if (Array.isArray(payload.runs)) {
                        setRuns(payload.runs);
                    }
                    if (payload.diagnostics) {
                        setDiagnostics(payload.diagnostics);
                    }
                    setSseConnected(true);
                    setSseFallbackMessage(null);
                } catch {
                    // Ignore malformed event payloads.
                }
            });

            source.addEventListener('error', (event) => {
                const maybeData = (event as MessageEvent).data;
                if (typeof maybeData === 'string' && maybeData.trim()) {
                    setSseFallbackMessage(maybeData);
                }
            });

            source.onerror = () => {
                setSseConnected(false);
                setSseFallbackMessage('Realtime feed disconnected, using polling fallback.');
                source?.close();
                source = null;

                if (!closed) {
                    reconnectTimer = setTimeout(() => {
                        connect();
                    }, 5000);
                }
            };
        };

        connect();

        return () => {
            closed = true;
            if (reconnectTimer) {
                clearTimeout(reconnectTimer);
            }
            if (source) {
                source.close();
            }
        };
    }, [locationId]);

    return (
        <div className="mb-6 rounded-lg border bg-card p-4">
            <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                    <h2 className="text-base font-semibold">Deep Runs</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        End-to-end strategic orchestration history (manual-first flow).
                    </p>
                </div>
                <div className="flex items-center gap-2 text-[11px]">
                    <span className={sseConnected ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}>
                        {sseConnected ? 'Realtime connected' : 'Polling fallback'}
                    </span>
                    {hasInFlight && <Loader2 className="w-4 h-4 animate-spin text-blue-500" />}
                </div>
            </div>

            {sseFallbackMessage && (
                <div className="mb-3 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
                    {sseFallbackMessage}
                </div>
            )}

            {triggerWarningMessage && (
                <div className="mb-3 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
                    {triggerWarningMessage}
                </div>
            )}

            {showWorkerUnavailableWarning && (
                <div className="mb-3 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-700 dark:text-red-300 flex items-start gap-2">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>
                        Worker unavailable: {staleQueuedCount} queued run(s) older than 60s. Check diagnostics and worker process health.
                    </span>
                </div>
            )}

            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6 mb-4">
                <div className="rounded border bg-background p-2">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Runs (24h)</p>
                    <p className="text-sm font-semibold mt-1">{overview.totalRuns}</p>
                </div>
                <div className="rounded border bg-background p-2">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">In Flight</p>
                    <p className="text-sm font-semibold mt-1">{inFlightCount}</p>
                    <p className="text-[10px] text-muted-foreground mt-1">queued/running</p>
                </div>
                <div className="rounded border bg-background p-2">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Success</p>
                    <p className="text-sm font-semibold mt-1">{overview.successRate}%</p>
                </div>
                <div className="rounded border bg-background p-2">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Seeds Found</p>
                    <p className="text-sm font-semibold mt-1">{overview.totals.seedListingsFound}</p>
                </div>
                <div className="rounded border bg-background p-2">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Deep Portfolio</p>
                    <p className="text-sm font-semibold mt-1">{overview.totals.portfolioListingsDeepScraped}</p>
                </div>
                <div className="rounded border bg-background p-2">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Errors</p>
                    <p className="text-sm font-semibold mt-1">{overview.totals.errorsTotal}</p>
                </div>
            </div>

            <div className="mb-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-6 text-[11px]">
                <div className="rounded border bg-background px-2 py-1.5">
                    <span className="text-muted-foreground">Worker</span>
                    <div className={diagnostics.workerReady ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
                        {diagnostics.workerReady ? 'Ready' : 'Unavailable'}
                    </div>
                </div>
                <div className="rounded border bg-background px-2 py-1.5">
                    <span className="text-muted-foreground">Heartbeat Age</span>
                    <div>{diagnostics.workerHeartbeatAgeSeconds ?? '—'}s</div>
                </div>
                <div className="rounded border bg-background px-2 py-1.5">
                    <span className="text-muted-foreground">Queue Waiting</span>
                    <div>{diagnostics.queueDepth.waiting}</div>
                </div>
                <div className="rounded border bg-background px-2 py-1.5">
                    <span className="text-muted-foreground">Queue Active</span>
                    <div>{diagnostics.queueDepth.active}</div>
                </div>
                <div className="rounded border bg-background px-2 py-1.5">
                    <span className="text-muted-foreground">Queue Failed</span>
                    <div>{diagnostics.queueDepth.failed}</div>
                </div>
                <div className="rounded border bg-background px-2 py-1.5">
                    <span className="text-muted-foreground">Workers</span>
                    <div>{diagnostics.activeWorkers.length}</div>
                </div>
            </div>

            <div className="space-y-2">
                {runs.length === 0 ? (
                    <div className="text-xs text-muted-foreground rounded border bg-background p-3">
                        No deep runs yet.
                    </div>
                ) : (
                    runs.map((run) => {
                        const isExpanded = expandedRunId === run.id;
                        const showStages = expandedStageRunId === run.id;
                        const displayStatus = getDisplayStatus(run);
                        const staleQueued = run.status === 'queued' && isQueuedRunStale(run.queuedAt || run.createdAt);

                        return (
                            <div key={run.id} className={`rounded border bg-background p-3 text-xs ${staleQueued ? 'border-amber-500/40' : ''}`}>
                                <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <StatusBadge status={displayStatus} />
                                        <span className="text-muted-foreground">{formatTime(run.createdAt)}</span>
                                        <span className="text-muted-foreground">({formatDuration(run.createdAt, run.completedAt)})</span>
                                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                            {toPrettySource(run.triggeredBy)}
                                        </span>
                                        {run.queueJobId && (
                                            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                                job:{run.queueJobId}
                                            </span>
                                        )}
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setExpandedRunId(isExpanded ? null : run.id)}
                                        className="text-muted-foreground hover:text-foreground"
                                    >
                                        {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                                    </button>
                                </div>

                                <div className="mt-2 flex flex-wrap items-center gap-2 text-muted-foreground">
                                    <span className="rounded bg-muted px-1.5 py-0.5">Seeds: {run.seedListingsFound}</span>
                                    <span className="rounded bg-muted px-1.5 py-0.5">Contacts+Phone: {run.contactsWithPhone}</span>
                                    <span className="rounded bg-muted px-1.5 py-0.5">No Phone: {run.contactsWithoutPhone}</span>
                                    <span className="rounded bg-muted px-1.5 py-0.5">Portfolio Deep: {run.portfolioListingsDeepScraped}</span>
                                    <span className="rounded bg-muted px-1.5 py-0.5">Agency Omitted: {run.omittedAgency}</span>
                                    <span className="rounded bg-muted px-1.5 py-0.5">Uncertain Omitted: {run.omittedUncertain}</span>
                                    <span className="rounded bg-muted px-1.5 py-0.5">Missing Phone: {run.omittedMissingPhone}</span>
                                    <span className="rounded bg-muted px-1.5 py-0.5">Non-RE: {run.omittedNonRealEstate}</span>
                                    <span className="rounded bg-muted px-1.5 py-0.5">Duplicates: {run.omittedDuplicate}</span>
                                    <span className="rounded bg-muted px-1.5 py-0.5">Budget Omitted: {run.omittedBudgetExhausted}</span>
                                    {run.errorsTotal > 0 && (
                                        <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-red-600 dark:text-red-400">
                                            Errors: {run.errorsTotal}
                                        </span>
                                    )}
                                </div>

                                {isExpanded && (
                                    <div className="mt-2 space-y-2">
                                        {run.errorLog && (
                                            <pre className="rounded bg-red-500/10 text-red-600 dark:text-red-400 p-2 text-[10px] whitespace-pre-wrap overflow-x-auto">
                                                {run.errorLog}
                                            </pre>
                                        )}

                                        <div className="flex items-center gap-3">
                                            <button
                                                type="button"
                                                onClick={() => setExpandedStageRunId(showStages ? null : run.id)}
                                                className="text-[11px] text-muted-foreground hover:text-foreground underline"
                                            >
                                                {showStages ? 'Hide stage logs' : `Show stage logs (${run.stages?.length || 0})`}
                                            </button>
                                            {loadingDetailsRunId === run.id && (
                                                <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                                                    <Loader2 className="w-3 h-3 animate-spin" />
                                                    Loading latest stage logs
                                                </span>
                                            )}
                                        </div>

                                        {showStages && (
                                            <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                                                {(run.stages || []).map((stage) => (
                                                    <div key={stage.id} className="rounded border bg-muted/30 p-2">
                                                        <div className="flex items-center justify-between gap-2">
                                                            <div className="flex items-center gap-2 flex-wrap">
                                                                <span className="font-medium">{stage.stage}</span>
                                                                <span className="text-muted-foreground">{formatTime(stage.createdAt)}</span>
                                                                <span className="rounded bg-background px-1 py-0.5 text-[10px] text-muted-foreground">{stage.status}</span>
                                                                {stage.taskId && (
                                                                    <span className="rounded bg-background px-1 py-0.5 text-[10px] text-muted-foreground">
                                                                        task:{stage.taskId.slice(0, 8)}
                                                                    </span>
                                                                )}
                                                                {stage.reasonCode && (
                                                                    <span className="rounded bg-amber-500/10 px-1 py-0.5 text-[10px] text-amber-700 dark:text-amber-400">
                                                                        {stage.reasonCode}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                        {stage.message && <p className="mt-1 text-[11px] text-muted-foreground">{stage.message}</p>}
                                                        {stage.counters && (
                                                            <pre className="mt-1 rounded bg-background p-1.5 text-[10px] text-muted-foreground overflow-x-auto whitespace-pre-wrap">
                                                                {JSON.stringify(stage.counters, null, 2)}
                                                            </pre>
                                                        )}
                                                        {stage.metadata && (
                                                            <pre className="mt-1 rounded bg-background p-1.5 text-[10px] text-muted-foreground overflow-x-auto whitespace-pre-wrap">
                                                                {JSON.stringify(stage.metadata, null, 2)}
                                                            </pre>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}
