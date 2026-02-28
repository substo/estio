"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { getTaskSuggestionFunnelMetrics } from "@/app/(main)/admin/conversations/actions";

type MetricsResult = Awaited<ReturnType<typeof getTaskSuggestionFunnelMetrics>>;
type MetricsSuccess = Extract<MetricsResult, { success: true }>;
type ScopeMode = "location" | "conversation";
type WindowDays = 7 | 30 | 90;

type TaskSuggestionFunnelMetricsProps = {
    conversationId?: string | null;
    className?: string;
};

function formatPercent(value: number) {
    return `${(value * 100).toFixed(1)}%`;
}

function formatCount(value: number) {
    if (!Number.isFinite(value)) return "0";
    return Math.round(value).toLocaleString();
}

function formatAvg(value: number) {
    if (!Number.isFinite(value)) return "0";
    return value.toFixed(1);
}

function formatDateLabel(value: string) {
    const parsed = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function TaskSuggestionFunnelMetrics({
    conversationId,
    className,
}: TaskSuggestionFunnelMetricsProps) {
    const [days, setDays] = useState<WindowDays>(30);
    const [scope, setScope] = useState<ScopeMode>(conversationId ? "conversation" : "location");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [data, setData] = useState<MetricsSuccess | null>(null);

    const canUseConversationScope = Boolean(conversationId);
    const effectiveScope: ScopeMode = scope === "conversation" && canUseConversationScope ? "conversation" : "location";

    useEffect(() => {
        if (scope === "conversation" && !canUseConversationScope) {
            setScope("location");
        }
    }, [scope, canUseConversationScope]);

    const loadMetrics = useCallback(async () => {
        setLoading(true);
        setError(null);

        try {
            const res = await getTaskSuggestionFunnelMetrics({
                days,
                scope: effectiveScope,
                conversationId: effectiveScope === "conversation" ? String(conversationId || "") : undefined,
            });

            if (!res?.success) {
                setData(null);
                setError(res?.error || "Failed to load funnel metrics");
                return;
            }

            setData(res);
        } catch (requestError: any) {
            setData(null);
            setError(requestError?.message || "Failed to load funnel metrics");
        } finally {
            setLoading(false);
        }
    }, [conversationId, days, effectiveScope]);

    useEffect(() => {
        void loadMetrics();
    }, [loadMetrics]);

    const recentDailyRows = useMemo(() => {
        if (!data?.daily?.length) return [];
        return [...data.daily].slice(-8).reverse();
    }, [data]);

    return (
        <Card className={cn("border-slate-200 bg-slate-50/60 p-3", className)}>
            <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                        <BarChart3 className="h-4 w-4 text-slate-700" />
                        <div className="text-xs font-semibold text-slate-800">
                            Suggestion Funnel Metrics
                        </div>
                        <Badge variant="outline" className="h-5 text-[10px] uppercase">
                            {effectiveScope === "conversation" ? "Conversation" : "Location"}
                        </Badge>
                    </div>

                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1.5 px-2 text-[11px]"
                        onClick={loadMetrics}
                        disabled={loading}
                    >
                        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                        Refresh
                    </Button>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                    <Button
                        type="button"
                        variant={effectiveScope === "location" ? "secondary" : "ghost"}
                        size="sm"
                        className="h-6 px-2 text-[10px]"
                        onClick={() => setScope("location")}
                    >
                        Location
                    </Button>
                    <Button
                        type="button"
                        variant={effectiveScope === "conversation" ? "secondary" : "ghost"}
                        size="sm"
                        className="h-6 px-2 text-[10px]"
                        disabled={!canUseConversationScope}
                        onClick={() => setScope("conversation")}
                    >
                        Conversation
                    </Button>
                    <span className="mx-1 text-[10px] text-slate-400">|</span>
                    {[7, 30, 90].map((windowDays) => (
                        <Button
                            key={windowDays}
                            type="button"
                            variant={days === windowDays ? "secondary" : "ghost"}
                            size="sm"
                            className="h-6 px-2 text-[10px]"
                            onClick={() => setDays(windowDays as WindowDays)}
                        >
                            {windowDays}d
                        </Button>
                    ))}
                </div>

                {error ? (
                    <div className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-red-700">
                        {error}
                    </div>
                ) : null}

                {loading && !data ? (
                    <div className="flex items-center gap-2 py-2 text-xs text-slate-500">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Loading funnel metrics...
                    </div>
                ) : null}

                {data ? (
                    <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                            <div className="rounded border bg-white p-2">
                                <div className="text-[10px] uppercase text-slate-500">Generates</div>
                                <div className="text-sm font-semibold text-slate-900">
                                    {formatCount(data.totals.generateRequested)}
                                </div>
                            </div>
                            <div className="rounded border bg-white p-2">
                                <div className="text-[10px] uppercase text-slate-500">Suggestions</div>
                                <div className="text-sm font-semibold text-slate-900">
                                    {formatCount(data.totals.suggestionsGenerated)}
                                </div>
                            </div>
                            <div className="rounded border bg-white p-2">
                                <div className="text-[10px] uppercase text-slate-500">Apply Clicks</div>
                                <div className="text-sm font-semibold text-slate-900">
                                    {formatCount(data.totals.applyRequested)}
                                </div>
                            </div>
                            <div className="rounded border bg-white p-2">
                                <div className="text-[10px] uppercase text-slate-500">Tasks Created</div>
                                <div className="text-sm font-semibold text-slate-900">
                                    {formatCount(data.totals.tasksCreated)}
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 gap-2 text-[11px] sm:grid-cols-3">
                            <div className="rounded border bg-white px-2 py-1.5 text-slate-700">
                                Generate success: <span className="font-semibold">{formatPercent(data.rates.generateSuccessRate)}</span>
                            </div>
                            <div className="rounded border bg-white px-2 py-1.5 text-slate-700">
                                Apply start: <span className="font-semibold">{formatPercent(data.rates.applyStartRate)}</span>
                            </div>
                            <div className="rounded border bg-white px-2 py-1.5 text-slate-700">
                                Selected to created: <span className="font-semibold">{formatPercent(data.rates.selectedToTaskConversion)}</span>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 gap-2 text-[11px] sm:grid-cols-3">
                            <div className="rounded border bg-white px-2 py-1.5 text-slate-700">
                                Avg suggestions / generate: <span className="font-semibold">{formatAvg(data.averages.suggestionsPerGeneration)}</span>
                            </div>
                            <div className="rounded border bg-white px-2 py-1.5 text-slate-700">
                                Avg tasks / apply: <span className="font-semibold">{formatAvg(data.averages.tasksPerApply)}</span>
                            </div>
                            <div className="rounded border bg-white px-2 py-1.5 text-slate-700">
                                Avg generation latency: <span className="font-semibold">{formatAvg(data.averages.generationLatencyMs)}ms</span>
                            </div>
                        </div>

                        {recentDailyRows.length > 0 ? (
                            <div className="rounded border bg-white">
                                <div className="border-b px-2 py-1.5 text-[10px] font-semibold uppercase text-slate-500">
                                    Daily Trend (latest 8 days with events)
                                </div>
                                <div className="max-h-44 overflow-y-auto">
                                    {recentDailyRows.map((row) => (
                                        <div key={row.date} className="grid grid-cols-5 gap-2 px-2 py-1.5 text-[11px] border-b last:border-b-0">
                                            <span className="font-medium text-slate-700">{formatDateLabel(row.date)}</span>
                                            <span className="text-slate-600">Gen {row.generateRequested}</span>
                                            <span className="text-slate-600">Sug {row.suggestionsGenerated}</span>
                                            <span className="text-slate-600">Apply {row.applyRequested}</span>
                                            <span className="text-slate-600">Create {row.tasksCreated}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <div className="rounded border bg-white px-2 py-1.5 text-[11px] text-slate-500">
                                No telemetry events in the selected time window.
                            </div>
                        )}

                        {data.failures.length > 0 ? (
                            <div className="rounded border bg-white px-2 py-1.5">
                                <div className="mb-1 text-[10px] font-semibold uppercase text-slate-500">Top Failures</div>
                                <div className="space-y-1">
                                    {data.failures.map((failure) => (
                                        <div key={failure.reason} className="flex items-start justify-between gap-2 text-[11px]">
                                            <span className="text-slate-600">{failure.reason}</span>
                                            <Badge variant="outline" className="h-5 text-[10px]">
                                                {failure.count}
                                            </Badge>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : null}
                    </div>
                ) : null}
            </div>
        </Card>
    );
}
