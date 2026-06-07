import {
    getScrapingConnections,
    getScrapingTasks,
    getScrapingRuns,
    getScrapingRunOverview,
    getDeepScrapeRuns,
    getDeepScrapeQueueDiagnostics,
    getDeepScrapeRunOverview,
} from './actions';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { RunScraperButton } from './_components/run-scraper-button';
import { RunHistoryPanel } from './_components/run-history-panel';
import { RunDeepScraperButton } from './_components/run-deep-scraper-button';
import { DeepRunsPanel } from './_components/deep-runs-panel';
import { ProspectingUnauthorized } from './_components/prospecting-unauthorized';
import { getProspectingLocationId } from './location';

function OverviewMetricCard({
    label,
    value,
    detail,
}: {
    label: string;
    value: string | number;
    detail?: string;
}) {
    return (
        <div className="rounded-lg border bg-card p-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className="text-xl font-semibold mt-1">{value}</p>
            {detail && <p className="text-[11px] text-muted-foreground mt-1">{detail}</p>}
        </div>
    );
}

function SettingsSectionHeader({
    title,
    actionHref,
    actionLabel,
    actionVariant = "default",
}: {
    title: string;
    actionHref: string;
    actionLabel: string;
    actionVariant?: "default" | "outline";
}) {
    return (
        <div className="mt-8 mb-4 flex justify-between items-center border-b pb-2">
            <h2 className="text-xl font-semibold">{title}</h2>
            <Link href={actionHref}>
                <Button variant={actionVariant} size="sm">{actionLabel}</Button>
            </Link>
        </div>
    );
}

function EmptySettingsState({ children }: { children: ReactNode }) {
    return (
        <div className="text-center p-8 border rounded-lg bg-card text-muted-foreground text-sm">
            {children}
        </div>
    );
}

export default async function ProspectingSettingsPage() {
    const locationId = await getProspectingLocationId();
    if (!locationId) return <ProspectingUnauthorized />;

    const [connections, tasks, runOverview, deepRunOverview, deepRuns, deepQueueDiagnostics] = await Promise.all([
        getScrapingConnections(locationId),
        getScrapingTasks(locationId),
        getScrapingRunOverview(locationId, 24),
        getDeepScrapeRunOverview(locationId, 24),
        getDeepScrapeRuns(locationId, 20),
        getDeepScrapeQueueDiagnostics(locationId),
    ]);

    // Fetch run history for all tasks in parallel
    const runsByTask: Record<string, any[]> = {};
    await Promise.all(
        tasks.map(async (task: any) => {
            runsByTask[task.id] = await getScrapingRuns(task.id, locationId, 15);
        })
    );
    const overviewMetrics = [
        {
            label: "Runs (24h)",
            value: runOverview.totalRuns,
        },
        {
            label: "Success Rate",
            value: `${runOverview.successRate}%`,
            detail: `${runOverview.completedRuns} completed`,
        },
        {
            label: "Failed / Partial",
            value: runOverview.failedRuns + runOverview.partialRuns,
            detail: `${runOverview.failedRuns} failed · ${runOverview.partialRuns} partial`,
        },
        {
            label: "Running",
            value: runOverview.runningRuns,
        },
        {
            label: "Avg / P95 Duration",
            value: runOverview.avgDurationSeconds !== null ? `${runOverview.avgDurationSeconds}s` : '—',
            detail: `P95: ${runOverview.p95DurationSeconds !== null ? `${runOverview.p95DurationSeconds}s` : '—'}`,
        },
    ];

    return (
        <div className="p-6">
            <div className="mb-6 flex justify-between items-start">
                <div>
                    <h1 className="text-2xl font-bold">Prospecting Infrastructure</h1>
                    <p className="text-muted-foreground mt-1 text-sm">
                        Manage platform connections and scheduled scraping tasks to populate your Lead Inbox.
                    </p>
                </div>
                <div className="flex gap-2">
                    <RunDeepScraperButton
                        locationId={locationId}
                        workerReady={deepQueueDiagnostics.workerReady}
                        workerHeartbeatAgeSeconds={deepQueueDiagnostics.workerHeartbeatAgeSeconds}
                    />
                </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 mb-6">
                {overviewMetrics.map((metric) => (
                    <OverviewMetricCard
                        key={metric.label}
                        label={metric.label}
                        value={metric.value}
                        detail={metric.detail}
                    />
                ))}
            </div>

            <DeepRunsPanel
                locationId={locationId}
                overview={deepRunOverview}
                initialRuns={deepRuns as any}
                initialDiagnostics={deepQueueDiagnostics}
            />

            {runOverview.topFailingTasks.length > 0 && (
                <div className="mb-6 rounded-lg border bg-card p-3">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">Top Failing Tasks (24h)</p>
                    <div className="flex flex-wrap gap-2">
                        {runOverview.topFailingTasks.map((task) => (
                            <span key={task.taskId} className="text-xs rounded bg-red-500/10 text-red-600 dark:text-red-400 px-2 py-1">
                                {task.taskName}: {task.failures}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            <SettingsSectionHeader
                title="1. Platform Connections"
                actionHref="/admin/settings/prospecting/connections/new"
                actionLabel="Add Connection"
                actionVariant="outline"
            />
            
            <div className="grid gap-4 mb-8">
                {connections.length === 0 ? (
                    <EmptySettingsState>
                        No platform connections configured. Create one to begin scraping.
                    </EmptySettingsState>
                ) : (
                    connections.map((conn: any) => (
                        <div key={conn.id} className="p-4 border rounded-lg bg-card flex justify-between items-center">
                            <div>
                                <h3 className="font-medium text-base flex items-center gap-2">
                                    {conn.name}
                                    {!conn.enabled && (
                                        <span className="text-xs font-normal bg-muted px-2 py-0.5 rounded text-muted-foreground">Disabled</span>
                                    )}
                                </h3>
                                <p className="text-sm text-muted-foreground mt-1">
                                    Platform: {conn.platform.toUpperCase()}
                                </p>
                                <div className="text-xs flex gap-4 mt-2 text-muted-foreground">
                                    <span>Auth Configured: {conn.authUsername ? 'Yes' : 'No'}</span>
                                    <span>Session Cached: {conn.sessionState ? 'Yes' : 'No'}</span>
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <Link href={`/admin/settings/prospecting/connections/${conn.id}`}>
                                    <Button variant="ghost" size="sm">Edit</Button>
                                </Link>
                            </div>
                        </div>
                    ))
                )}
            </div>

            <SettingsSectionHeader
                title="2. Scheduled Tasks"
                actionHref="/admin/settings/prospecting/tasks/new"
                actionLabel="Add Task"
            />

            <div className="grid gap-4">
                {tasks.length === 0 ? (
                    <EmptySettingsState>
                        No target tasks scheduled.
                    </EmptySettingsState>
                ) : (
                    tasks.map((task: any) => (
                        <div key={task.id} className="p-4 border rounded-lg bg-card">
                            <div className="flex justify-between items-center">
                                <div>
                                    <h3 className="font-medium text-base flex items-center gap-2">
                                        {task.name}
                                        {!task.enabled && (
                                            <span className="text-xs font-normal bg-muted px-2 py-0.5 rounded text-muted-foreground">Disabled</span>
                                        )}
                                    </h3>
                                    <p className="text-sm text-muted-foreground mt-1">
                                        Uses Connection: <strong>{task.connection?.name || 'Unknown'}</strong>
                                    </p>
                                    <div className="text-xs flex gap-4 mt-2 text-muted-foreground">
                                        <span>Sync: {task.scrapeFrequency}</span>
                                        <span>Mode: {task.extractionMode}</span>
                                        {task.lastSyncAt ? (
                                            <span className={task.lastSyncStatus === 'success' ? 'text-green-600' : 'text-red-600'}>
                                                Last Sync: {task.lastSyncAt.toLocaleString()} ({task.lastSyncStatus})
                                            </span>
                                        ) : (
                                            <span>Never synced</span>
                                        )}
                                    </div>
                                </div>
                                <div className="flex gap-2">
                                    <RunScraperButton taskId={task.id} locationId={locationId} />
                                    <Link href={`/admin/settings/prospecting/tasks/${task.id}`}>
                                        <Button variant="outline" size="sm">Edit</Button>
                                    </Link>
                                </div>
                            </div>

                            {/* Run History */}
                            <RunHistoryPanel taskId={task.id} locationId={locationId} initialRuns={runsByTask[task.id] || []} />
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
