'use client';

import { useEffect, useState, useCallback } from 'react';
import { getScrapingRuns } from '../actions';
import { ChevronDown, ChevronRight, CheckCircle2, XCircle, Loader2, AlertTriangle } from 'lucide-react';

interface ScrapingRun {
    id: string;
    createdAt: Date;
    status: string;
    pagesScraped: number;
    listingsFound: number;
    leadsCreated: number;
    duplicatesFound: number;
    errors: number;
    completedAt: Date | null;
    errorLog: string | null;
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

export function RunHistoryPanel({ taskId, initialRuns }: { taskId: string; initialRuns: ScrapingRun[] }) {
    const [runs, setRuns] = useState<ScrapingRun[]>(initialRuns);
    const [expanded, setExpanded] = useState(initialRuns.length > 0);
    const [expandedErrorId, setExpandedErrorId] = useState<string | null>(null);

    const hasRunning = runs.some(r => r.status === 'running');

    const refresh = useCallback(async () => {
        try {
            const fresh = await getScrapingRuns(taskId);
            setRuns(fresh as any);
        } catch { /* silent */ }
    }, [taskId]);

    // Auto-refresh every 5s when a run is in progress
    useEffect(() => {
        if (!hasRunning) return;
        const interval = setInterval(refresh, 5000);
        return () => clearInterval(interval);
    }, [hasRunning, refresh]);

    if (runs.length === 0) return null;

    return (
        <div className="mt-3 border-t pt-3">
            <button
                onClick={() => setExpanded(!expanded)}
                className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
                {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                Run History ({runs.length})
                {hasRunning && <Loader2 className="w-3 h-3 animate-spin ml-1 text-blue-500" />}
            </button>

            {expanded && (
                <div className="mt-2 space-y-1.5">
                    {runs.map((run) => (
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

                            {run.errorLog && (
                                <div className="mt-1.5">
                                    <button
                                        onClick={() => setExpandedErrorId(expandedErrorId === run.id ? null : run.id)}
                                        className="text-red-500 hover:text-red-600 text-[10px] underline"
                                    >
                                        {expandedErrorId === run.id ? 'Hide error' : 'Show error'}
                                    </button>
                                    {expandedErrorId === run.id && (
                                        <pre className="mt-1 p-2 rounded bg-red-500/10 text-red-600 dark:text-red-400 text-[10px] leading-tight overflow-x-auto max-h-32 whitespace-pre-wrap">
                                            {run.errorLog}
                                        </pre>
                                    )}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
