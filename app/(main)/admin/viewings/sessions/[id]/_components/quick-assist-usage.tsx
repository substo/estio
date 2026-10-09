"use client";

import { formatQuickAssistCost } from "@/lib/viewings/sessions/quick-assist-cost";

export type QuickAssistUsageSnapshot = {
    totalCost: number;
    count: number;
    unavailableCount: number;
    subscriptionCount: number;
    records: Array<{
        id: string; mode: string; provider: string; model: string; cost: number; status: string;
        inputTokens: number; outputTokens: number; inputAudioSeconds: number;
        calculation: string | null; recordedAt: string;
    }>;
};

export function QuickAssistUsagePanel({ usage, error }: { usage: QuickAssistUsageSnapshot | null; error: boolean }) {
    return (
        <div className="rounded-xl border p-3 space-y-2" aria-live="polite">
            <div className="flex justify-between gap-2">
                <span className="font-medium text-sm">Session cost · estimated USD</span>
                <span className="font-mono text-sm">{usage ? formatQuickAssistCost(usage.totalCost) : error ? "Unavailable" : "Loading…"}</span>
            </div>
            <p className="text-xs text-muted-foreground">
                {usage?.count || 0} recorded uses · included in Today / Month at the top right.
                Updates as provider usage arrives. Paid-tier rates; excludes tax and free allowances.
            </p>
            {!!usage?.unavailableCount && <p className="text-xs text-amber-700">{usage.unavailableCount} uses have no available cost and are excluded from this estimate.</p>}
            {!!usage?.subscriptionCount && <p className="text-xs text-muted-foreground">{usage.subscriptionCount} Codex uses are charged to the connected subscription; no API dollar amount is assigned.</p>}
            {error && <p className="text-xs text-amber-700">Usage could not refresh. The displayed amount may be out of date.</p>}
            <details>
                <summary className="cursor-pointer text-sm">Usage and calculations</summary>
                <div className="mt-2 max-h-64 overflow-auto space-y-2">
                    {usage?.records.map(record => (
                        <div key={record.id} className="rounded border p-2 text-xs">
                            <div className="flex justify-between gap-2">
                                <span>{record.mode} · {record.model}</span>
                                <span className="font-mono shrink-0">{record.status === "subscription" ? "Subscription" : record.status === "unavailable" ? "Cost unavailable" : formatQuickAssistCost(record.cost)}</span>
                            </div>
                            <div className="text-muted-foreground">
                                {new Date(record.recordedAt).toLocaleTimeString()} · {record.provider} · {record.inputAudioSeconds > 0
                                    ? `${record.inputAudioSeconds.toFixed(2)} seconds`
                                    : `${record.inputTokens} input / ${record.outputTokens} output tokens`}
                            </div>
                            {record.calculation && <p className="mt-1 text-muted-foreground">{record.calculation}</p>}
                        </div>
                    ))}
                    {usage?.count === 0 && <p className="text-xs text-muted-foreground">No model usage recorded yet.</p>}
                    {(usage?.count || 0) > 100 && <p className="text-xs">Showing latest 100 uses; total includes all uses.</p>}
                </div>
            </details>
        </div>
    );
}
