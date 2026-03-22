'use client';

import { useEffect, useState, useCallback } from 'react';
import { getScrapingRuns } from '../actions';
import { ChevronDown, ChevronRight, CheckCircle2, XCircle, Loader2, AlertTriangle } from 'lucide-react';

interface ScrapingRun {
    id: string;
    createdAt: Date | string;
    status: string;
    pagesScraped: number;
    listingsFound: number;
    leadsCreated: number;
    duplicatesFound: number;
    errors: number;
    completedAt: Date | string | null;
    errorLog: string | null;
    metadata?: Record<string, unknown> | null;
}

function StatusBadge({ status }: { status: string }) {
    switch (status) {
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
        case 'failed':
            return (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/15 text-red-600 dark:text-red-400">
                    <XCircle className="w-3 h-3" /> Failed
                </span>
            );
        case 'partial':
            return (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/15 text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="w-3 h-3" /> Partial
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

function safeMeta(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as Record<string, unknown>;
}

function readNestedText(meta: Record<string, unknown>, parentKey: string, childKey: string): string | null {
    const parent = safeMeta(meta[parentKey]);
    const value = parent[childKey];
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(meta: Record<string, unknown>, key: string): number | null {
    const value = meta[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function formatTime(date: Date | string | null) {
    if (!date) return '—';
    const d = new Date(date);
    return d.toLocaleString('en-GB', {
        month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
}

function formatDuration(start: Date | string, end: Date | string | null) {
    if (!end) return '—';
    const ms = new Date(end).getTime() - new Date(start).getTime();
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function toPrettySource(value: string | null): string {
    if (!value) return 'Unknown';
    if (value === 'manual') return 'Manual';
    if (value === 'scheduled') return 'Scheduled';
    if (value === 'system') return 'System';
    return value;
}

export function RunHistoryPanel({
    taskId,
    locationId,
    initialRuns,
}: {
    taskId: string;
    locationId: string;
    initialRuns: ScrapingRun[];
}) {
    const [runs, setRuns] = useState<ScrapingRun[]>(initialRuns);
    const [expanded, setExpanded] = useState(initialRuns.length > 0);
    const [expandedErrorId, setExpandedErrorId] = useState<string | null>(null);
    const [expandedMetaId, setExpandedMetaId] = useState<string | null>(null);

    const hasRunning = runs.some((run) => run.status === 'running');

    const refresh = useCallback(async () => {
        try {
            const fresh = await getScrapingRuns(taskId, locationId, 20);
            setRuns(fresh as unknown as ScrapingRun[]);
        } catch {
            // silent on polling
        }
    }, [taskId, locationId]);

    useEffect(() => {
        if (!hasRunning) return;
        const interval = setInterval(refresh, 5000);
        return () => clearInterval(interval);
    }, [hasRunning, refresh]);

    if (runs.length === 0) return null;

    const finishedRuns = runs.filter((run) => run.status !== 'running');
    const completedRuns = finishedRuns.filter((run) => run.status === 'completed').length;
    const successRate = finishedRuns.length > 0
        ? Math.round((completedRuns / finishedRuns.length) * 100)
        : null;

    return (
        <div className="mt-3 border-t pt-3">
            <button
                onClick={() => setExpanded(!expanded)}
                className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
                {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                Run History ({runs.length})
                {successRate !== null && (
                    <span className="ml-2 text-[10px] text-muted-foreground">Success {successRate}%</span>
                )}
                {hasRunning && <Loader2 className="w-3 h-3 animate-spin ml-1 text-blue-500" />}
            </button>

            {expanded && (
                <div className="mt-2 space-y-1.5">
                    {runs.map((run) => {
                        const metadata = safeMeta(run.metadata);
                        const triggerSource = readNestedText(metadata, 'trigger', 'source');
                        const flow = typeof metadata.flow === 'string' ? metadata.flow : null;
                        const errorCategory = typeof metadata.errorCategory === 'string' ? metadata.errorCategory : null;
                        const interactionsUsed = readNumber(metadata, 'interactionsUsed');
                        const interactionsRemaining = readNumber(metadata, 'interactionsRemaining');

                        return (
                            <div key={run.id} className="rounded border bg-muted/30 px-3 py-2 text-xs">
                                <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-3">
                                        <StatusBadge status={run.status} />
                                        <span className="text-muted-foreground">{formatTime(run.createdAt)}</span>
                                        {run.completedAt && (
                                            <span className="text-muted-foreground">
                                                ({formatDuration(run.createdAt, run.completedAt)})
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-3 text-muted-foreground tabular-nums">
                                        <span title="Pages scraped">📄 {run.pagesScraped}</span>
                                        <span title="Listings found">🔍 {run.listingsFound}</span>
                                        <span title="Leads created" className={run.leadsCreated > 0 ? 'text-green-600 dark:text-green-400' : ''}>
                                            ✨ {run.leadsCreated}
                                        </span>
                                        <span title="Duplicates">🔁 {run.duplicatesFound}</span>
                                        {run.errors > 0 && (
                                            <span title="Errors" className="text-red-500">⚠ {run.errors}</span>
                                        )}
                                    </div>
                                </div>

                                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                    <span className="rounded bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                        Trigger: {toPrettySource(triggerSource)}
                                    </span>
                                    {flow && (
                                        <span className="rounded bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                            Flow: {flow}
                                        </span>
                                    )}
                                    {interactionsUsed !== null && (
                                        <span className="rounded bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                            Interactions: {interactionsUsed}
                                            {interactionsRemaining !== null ? ` (left ${interactionsRemaining})` : ''}
                                        </span>
                                    )}
                                    {errorCategory && (
                                        <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-[10px] text-red-600 dark:text-red-400">
                                            Error Type: {errorCategory}
                                        </span>
                                    )}
                                </div>

                                {(run.errorLog || Object.keys(metadata).length > 0) && (
                                    <div className="mt-1.5 flex items-center gap-3">
                                        {run.errorLog && (
                                            <button
                                                onClick={() => setExpandedErrorId(expandedErrorId === run.id ? null : run.id)}
                                                className="text-red-500 hover:text-red-600 text-[10px] underline"
                                            >
                                                {expandedErrorId === run.id ? 'Hide error' : 'Show error'}
                                            </button>
                                        )}
                                        {Object.keys(metadata).length > 0 && (
                                            <button
                                                onClick={() => setExpandedMetaId(expandedMetaId === run.id ? null : run.id)}
                                                className="text-muted-foreground hover:text-foreground text-[10px] underline"
                                            >
                                                {expandedMetaId === run.id ? 'Hide details' : 'Show details'}
                                            </button>
                                        )}
                                    </div>
                                )}

                                {expandedErrorId === run.id && run.errorLog && (
                                    <pre className="mt-1 p-2 rounded bg-red-500/10 text-red-600 dark:text-red-400 text-[10px] leading-tight overflow-x-auto max-h-32 whitespace-pre-wrap">
                                        {run.errorLog}
                                    </pre>
                                )}

                                {expandedMetaId === run.id && Object.keys(metadata).length > 0 && (
                                    <pre className="mt-1 p-2 rounded bg-background text-[10px] leading-tight overflow-x-auto max-h-40 whitespace-pre-wrap text-muted-foreground">
                                        {JSON.stringify(metadata, null, 2)}
                                    </pre>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
