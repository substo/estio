export const ACTIVE_OUTBOX_STATUSES = ["pending", "processing", "failed", "dead", "disabled"] as const;
export const PROBLEM_OUTBOX_STATUSES = ["failed", "dead", "disabled"] as const;
export const PROBLEM_SYNC_STATUSES = ["stale", "error", "disabled"] as const;

export type ProviderSyncAlertLevel = "critical" | "warning";

export type ProviderSyncAlert = {
    level: ProviderSyncAlertLevel;
    title: string;
    detail: string;
};

export type ProviderSyncAlertInput = {
    deadJobs: number;
    failedJobs: number;
    disabledJobs: number;
    staleRecords: number;
    staleLocks: number;
};

export function buildProviderSyncAlerts(input: ProviderSyncAlertInput): ProviderSyncAlert[] {
    const alerts: ProviderSyncAlert[] = [];

    if (input.deadJobs > 0) {
        alerts.push({
            level: "critical",
            title: "Dead-letter jobs need review",
            detail: `${input.deadJobs} provider sync job${input.deadJobs === 1 ? "" : "s"} reached a terminal failure state.`,
        });
    }

    if (input.failedJobs >= 10) {
        alerts.push({
            level: "warning",
            title: "Provider failures are accumulating",
            detail: `${input.failedJobs} retryable provider sync job${input.failedJobs === 1 ? "" : "s"} failed recently.`,
        });
    }

    if (input.staleLocks > 0) {
        alerts.push({
            level: "warning",
            title: "Processing locks look stale",
            detail: `${input.staleLocks} job${input.staleLocks === 1 ? "" : "s"} have been locked long enough to need recovery.`,
        });
    }

    if (input.staleRecords > 0) {
        alerts.push({
            level: "warning",
            title: "Sync aliases need attention",
            detail: `${input.staleRecords} sync record${input.staleRecords === 1 ? "" : "s"} are stale, errored, or disabled.`,
        });
    }

    if (input.disabledJobs >= 25) {
        alerts.push({
            level: "warning",
            title: "Many jobs are disabled",
            detail: `${input.disabledJobs} provider job${input.disabledJobs === 1 ? "" : "s"} are disabled, usually from missing auth or unsupported capability.`,
        });
    }

    return alerts;
}

export function truncateError(value: string | null | undefined, maxLength = 160): string {
    if (!value) return "";
    const compact = value.replace(/\s+/g, " ").trim();
    if (compact.length <= maxLength) return compact;
    return `${compact.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function sumStatusCounts(
    rows: Array<{ status: string; count: number }>,
    statuses: readonly string[]
): number {
    return rows
        .filter((row) => statuses.includes(row.status))
        .reduce((total, row) => total + row.count, 0);
}
