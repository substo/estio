import Link from "next/link";
import type { ReactNode } from "react";
import { Activity, Ban, RefreshCw, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { truncateError } from "@/lib/integrations/provider-sync-dashboard";
import {
    disableGmailSyncOutboxJob,
    disableProviderOutboxJob,
    getProviderSyncDashboard,
    retryGmailSyncOutboxJob,
    retryProviderOutboxJob,
} from "./actions";
import { formatIntegrationDate } from "../date-format";

function statusBadge(status: string) {
    const variant = status === "dead" || status === "failed"
        ? "destructive"
        : status === "disabled"
            ? "secondary"
            : "outline";

    return <Badge variant={variant}>{status}</Badge>;
}

function CountCard({
    title,
    value,
    description,
}: {
    title: string;
    value: number | string;
    description: string;
}) {
    return (
        <Card>
            <CardHeader className="p-4 pb-2">
                <CardTitle className="text-sm font-medium">{title}</CardTitle>
                <CardDescription>{description}</CardDescription>
            </CardHeader>
            <CardContent className="p-4 pt-0">
                <div className="text-2xl font-semibold tabular-nums">{value}</div>
            </CardContent>
        </Card>
    );
}

function GroupedCountTable({
    title,
    description,
    rows,
    kind,
}: {
    title: string;
    description: string;
    rows: Array<{ provider?: string; status: string; _count: { _all: number } }>;
    kind: "provider" | "status";
}) {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">{title}</CardTitle>
                <CardDescription>{description}</CardDescription>
            </CardHeader>
            <CardContent>
                {rows.length ? (
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>{kind === "provider" ? "Provider" : "Queue"}</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="text-right">Count</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {rows.map((row, index) => (
                                <TableRow key={`${row.provider || "gmail"}-${row.status}-${index}`}>
                                    <TableCell className="font-medium">{row.provider || "gmail"}</TableCell>
                                    <TableCell>{statusBadge(row.status)}</TableCell>
                                    <TableCell className="text-right tabular-nums">{row._count._all}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                ) : (
                    <p className="text-sm text-muted-foreground">No active rows.</p>
                )}
            </CardContent>
        </Card>
    );
}

type JobAction = (formData: FormData) => void | Promise<void>;

function JobActions({
    id,
    retryAction,
    disableAction,
}: {
    id: string;
    retryAction: JobAction;
    disableAction: JobAction;
}) {
    return (
        <div className="flex justify-end gap-2">
            <form action={retryAction}>
                <input type="hidden" name="id" value={id} />
                <Button type="submit" size="sm" variant="outline" title="Retry job">
                    <RefreshCw className="h-4 w-4" />
                </Button>
            </form>
            <form action={disableAction}>
                <input type="hidden" name="id" value={id} />
                <Button type="submit" size="sm" variant="outline" title="Disable job">
                    <Ban className="h-4 w-4" />
                </Button>
            </form>
        </div>
    );
}

function ActiveJobsTable<TJob extends {
    id: string;
    operation: string;
    status: string;
    attemptCount: number;
    updatedAt: Date | string;
    lastError: string | null;
}>({
    title,
    description,
    jobs,
    emptyMessage,
    firstColumnTitle,
    renderFirstCell,
    renderOperationCell,
    retryAction,
    disableAction,
}: {
    title: string;
    description: string;
    jobs: TJob[];
    emptyMessage: string;
    firstColumnTitle: string;
    renderFirstCell: (job: TJob) => ReactNode;
    renderOperationCell: (job: TJob) => ReactNode;
    retryAction: JobAction;
    disableAction: JobAction;
}) {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">{title}</CardTitle>
                <CardDescription>{description}</CardDescription>
            </CardHeader>
            <CardContent>
                {jobs.length ? (
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>{firstColumnTitle}</TableHead>
                                <TableHead>Operation</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Attempts</TableHead>
                                <TableHead>Updated</TableHead>
                                <TableHead>Error</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {jobs.map((job) => (
                                <TableRow key={job.id}>
                                    <TableCell className="font-medium">{renderFirstCell(job)}</TableCell>
                                    <TableCell>{renderOperationCell(job)}</TableCell>
                                    <TableCell>{statusBadge(job.status)}</TableCell>
                                    <TableCell className="tabular-nums">{job.attemptCount}</TableCell>
                                    <TableCell>{formatIntegrationDate(job.updatedAt)}</TableCell>
                                    <TableCell className="max-w-[280px] text-xs text-muted-foreground">
                                        {truncateError(job.lastError) || "-"}
                                    </TableCell>
                                    <TableCell>
                                        <JobActions
                                            id={job.id}
                                            retryAction={retryAction}
                                            disableAction={disableAction}
                                        />
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                ) : (
                    <p className="text-sm text-muted-foreground">{emptyMessage}</p>
                )}
            </CardContent>
        </Card>
    );
}

function ProviderJobsTable({
    jobs,
}: {
    jobs: Awaited<ReturnType<typeof getProviderSyncDashboard>>["recentProviderJobs"];
}) {
    return (
        <ActiveJobsTable
            title="Provider Outbox Jobs"
            description="Recent pending, failed, dead, disabled, or processing mirror jobs."
            jobs={jobs}
            emptyMessage="No active provider outbox jobs."
            firstColumnTitle="Provider"
            retryAction={retryProviderOutboxJob}
            disableAction={disableProviderOutboxJob}
            renderFirstCell={(job) => (
                <>
                    <div>{job.provider}</div>
                    <div className="text-xs text-muted-foreground">{job.providerAccountId}</div>
                </>
            )}
            renderOperationCell={(job) => (
                <>
                    <div>{job.operation}</div>
                    <div className="text-xs text-muted-foreground">
                        {[job.conversationId, job.messageId, job.contactId].filter(Boolean).join(" / ") || "-"}
                    </div>
                </>
            )}
        />
    );
}

function GmailJobsTable({
    jobs,
}: {
    jobs: Awaited<ReturnType<typeof getProviderSyncDashboard>>["recentGmailJobs"];
}) {
    return (
        <ActiveJobsTable
            title="Gmail Sync Jobs"
            description="Native Gmail ingestion jobs scoped to users in this location."
            jobs={jobs}
            emptyMessage="No active Gmail sync jobs."
            firstColumnTitle="User"
            retryAction={retryGmailSyncOutboxJob}
            disableAction={disableGmailSyncOutboxJob}
            renderFirstCell={(job) => job.user.email}
            renderOperationCell={(job) => job.operation}
        />
    );
}

export default async function ProviderSyncPage() {
    const dashboard = await getProviderSyncDashboard();

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Provider Sync Operations</h1>
                    <p className="text-muted-foreground">
                        Monitor async provider sync without blocking Estio conversations.
                    </p>
                </div>
                <Button asChild variant="outline">
                    <Link href="/admin/settings/integrations">
                        <Activity className="mr-2 h-4 w-4" />
                        Integrations
                    </Link>
                </Button>
            </div>

            {dashboard.alerts.length > 0 && (
                <div className="space-y-3">
                    {dashboard.alerts.map((alert) => (
                        <div
                            key={`${alert.level}-${alert.title}`}
                            className={alert.level === "critical"
                                ? "rounded-md border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300"
                                : "rounded-md border border-amber-200 bg-amber-50 p-4 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300"}
                        >
                            <div className="flex gap-3">
                                <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" />
                                <div>
                                    <p className="font-medium">{alert.title}</p>
                                    <p className="text-sm opacity-90">{alert.detail}</p>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <div className="grid gap-4 md:grid-cols-4">
                <CountCard
                    title="Provider Problems"
                    value={dashboard.totals.providerProblemJobs}
                    description="Failed, dead, or disabled mirror jobs."
                />
                <CountCard
                    title="Gmail Problems"
                    value={dashboard.totals.gmailProblemJobs}
                    description="Failed, dead, or disabled Gmail ingestion jobs."
                />
                <CountCard
                    title="Sync Alias Issues"
                    value={dashboard.totals.syncRecordProblems}
                    description="Stale, error, or disabled provider sync rows."
                />
                <CountCard
                    title="Stale Locks"
                    value={dashboard.staleLocks.provider + dashboard.staleLocks.gmail}
                    description="Processing jobs locked for over 15 minutes."
                />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
                <GroupedCountTable
                    title="Provider Mirror Queue"
                    description="GHL/Google contact mirror jobs in ProviderOutbox."
                    rows={dashboard.providerOutboxByProvider}
                    kind="provider"
                />
                <GroupedCountTable
                    title="Gmail Native Queue"
                    description="Gmail webhook and cron work queued outside HTTP requests."
                    rows={dashboard.gmailOutboxByStatus}
                    kind="status"
                />
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
                <GroupedCountTable
                    title="Contact Outbox"
                    description="Existing contact domain outbox health."
                    rows={dashboard.contactOutboxByProvider}
                    kind="provider"
                />
                <GroupedCountTable
                    title="Task Outbox"
                    description="Existing task domain outbox health."
                    rows={dashboard.taskOutboxByProvider}
                    kind="provider"
                />
                <GroupedCountTable
                    title="Viewing Outbox"
                    description="Existing calendar/viewing domain outbox health."
                    rows={dashboard.viewingOutboxByProvider}
                    kind="provider"
                />
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
                <GroupedCountTable
                    title="Conversation Sync Records"
                    description="Conversation aliases requiring attention."
                    rows={dashboard.conversationSyncByProvider}
                    kind="provider"
                />
                <GroupedCountTable
                    title="Message Sync Records"
                    description="Message aliases requiring attention."
                    rows={dashboard.messageSyncByProvider}
                    kind="provider"
                />
                <GroupedCountTable
                    title="Contact Sync Records"
                    description="Contact aliases requiring attention."
                    rows={dashboard.contactSyncByProvider}
                    kind="provider"
                />
            </div>

            <ProviderJobsTable jobs={dashboard.recentProviderJobs} />
            <GmailJobsTable jobs={dashboard.recentGmailJobs} />

            <p className="text-xs text-muted-foreground">
                Generated {formatIntegrationDate(dashboard.generatedAt)} for location {dashboard.locationId}.
            </p>
        </div>
    );
}
