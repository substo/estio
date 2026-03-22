import {
    getScrapingConnections,
    getScrapingTasks,
    getScrapingRuns,
    getScrapingRunOverview,
} from './actions';
import db from '@/lib/db';
import { auth } from '@clerk/nextjs/server';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { RunScraperButton } from './_components/run-scraper-button';
import { RunHistoryPanel } from './_components/run-history-panel';
import { RunDeepScraperButton } from './_components/run-deep-scraper-button';

export default async function ProspectingSettingsPage() {
    const { userId } = await auth();
    
    const user = await db.user.findUnique({
        where: { clerkId: userId || '' },
        include: { locations: { take: 1 } }
    });

    const locationId = user?.locations?.[0]?.id;
    if (!locationId) return <div>Unauthorized</div>;

    const [connections, tasks, runOverview] = await Promise.all([
        getScrapingConnections(locationId),
        getScrapingTasks(locationId),
        getScrapingRunOverview(locationId, 24),
    ]);

    // Fetch run history for all tasks in parallel
    const runsByTask: Record<string, any[]> = {};
    await Promise.all(
        tasks.map(async (task: any) => {
            runsByTask[task.id] = await getScrapingRuns(task.id, locationId, 15);
        })
    );

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
                    <RunDeepScraperButton locationId={locationId} />
                </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 mb-6">
                <div className="rounded-lg border bg-card p-3">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Runs (24h)</p>
                    <p className="text-xl font-semibold mt-1">{runOverview.totalRuns}</p>
                </div>
                <div className="rounded-lg border bg-card p-3">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Success Rate</p>
                    <p className="text-xl font-semibold mt-1">{runOverview.successRate}%</p>
                    <p className="text-[11px] text-muted-foreground mt-1">{runOverview.completedRuns} completed</p>
                </div>
                <div className="rounded-lg border bg-card p-3">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Failed / Partial</p>
                    <p className="text-xl font-semibold mt-1">{runOverview.failedRuns + runOverview.partialRuns}</p>
                    <p className="text-[11px] text-muted-foreground mt-1">{runOverview.failedRuns} failed · {runOverview.partialRuns} partial</p>
                </div>
                <div className="rounded-lg border bg-card p-3">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Running</p>
                    <p className="text-xl font-semibold mt-1">{runOverview.runningRuns}</p>
                </div>
                <div className="rounded-lg border bg-card p-3">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Avg / P95 Duration</p>
                    <p className="text-xl font-semibold mt-1">
                        {runOverview.avgDurationSeconds !== null ? `${runOverview.avgDurationSeconds}s` : '—'}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-1">
                        P95: {runOverview.p95DurationSeconds !== null ? `${runOverview.p95DurationSeconds}s` : '—'}
                    </p>
                </div>
            </div>

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

            {/* Platform Connections Section */}
            <div className="mt-8 mb-4 flex justify-between items-center border-b pb-2">
                <h2 className="text-xl font-semibold">1. Platform Connections</h2>
                <Link href="/admin/settings/prospecting/connections/new">
                    <Button variant="outline" size="sm">Add Connection</Button>
                </Link>
            </div>
            
            <div className="grid gap-4 mb-8">
                {connections.length === 0 ? (
                    <div className="text-center p-8 border rounded-lg bg-card text-muted-foreground text-sm">
                        No platform connections configured. Create one to begin scraping.
                    </div>
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

            {/* Scheduled Tasks Section */}
            <div className="mt-8 mb-4 flex justify-between items-center border-b pb-2">
                <h2 className="text-xl font-semibold">2. Scheduled Tasks</h2>
                <Link href="/admin/settings/prospecting/tasks/new">
                    <Button size="sm">Add Task</Button>
                </Link>
            </div>

            <div className="grid gap-4">
                {tasks.length === 0 ? (
                    <div className="text-center p-8 border rounded-lg bg-card text-muted-foreground text-sm">
                        No target tasks scheduled.
                    </div>
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
