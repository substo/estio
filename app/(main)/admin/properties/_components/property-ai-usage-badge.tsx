"use client";

import { useEffect, useId, useState } from "react";
import { getPropertyAiUsageSummary, type AiUsageSummary } from "@/app/(main)/admin/_actions/ai-usage";
import { Sparkles } from "lucide-react";

const ACTION_LABELS: Record<string, string> = {
    analyze: "Analysis",
    generate: "Generation",
    precision_remove: "Precision Remove",
    room_type_predict: "Room Type",
    generate_print_copy: "Print Copy",
    generate_pdf: "Print PDF",
    regenerate_language: "Language Refresh",
};

export function formatAiUsageCost(cost: number, currency = "USD"): string {
    const normalizedCurrency = String(currency || "USD").trim().toUpperCase();
    const maximumFractionDigits = cost > 0 && cost < 0.01 ? 4 : 2;
    try {
        return new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: normalizedCurrency,
            minimumFractionDigits: 2,
            maximumFractionDigits,
        }).format(cost || 0);
    } catch {
        const symbol = normalizedCurrency === "EUR" ? "€" : normalizedCurrency === "GBP" ? "£" : "$";
        return `${symbol}${(cost || 0).toFixed(maximumFractionDigits)}`;
    }
}

function formatTokens(tokens: number): string {
    if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
    if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
    return String(tokens);
}

function timeAgo(dateStr: string): string {
    const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (seconds < 60) return "just now";
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
}

interface PropertyAiUsageBadgeProps {
    propertyId: string;
    refreshKey?: number;
    defaultExpanded?: boolean;
    hideWhenEmpty?: boolean;
    title?: string;
    emptyLabel?: string;
    className?: string;
    currency?: string;
    showSummaryHeader?: boolean;
}

export function PropertyAiUsageBadge({
    propertyId,
    refreshKey = 0,
    defaultExpanded = false,
    hideWhenEmpty = true,
    title = "AI Usage",
    emptyLabel = "No AI usage recorded yet",
    className = "",
    currency = "USD",
    showSummaryHeader = true,
}: PropertyAiUsageBadgeProps) {
    const [data, setData] = useState<AiUsageSummary | null>(null);
    const [expanded, setExpanded] = useState(defaultExpanded);
    const detailsId = useId();

    useEffect(() => {
        getPropertyAiUsageSummary(propertyId).then(setData).catch(() => { });
    }, [propertyId, refreshKey]);

    if (!data) return null;
    if (data.totalCalls === 0 && hideWhenEmpty) return null;

    const details = (
        <div
            id={showSummaryHeader ? detailsId : undefined}
            className={`${showSummaryHeader ? "border-t" : ""} px-4 py-3 space-y-4`}
            role={showSummaryHeader ? "region" : undefined}
            aria-label={showSummaryHeader ? `${title} details` : undefined}
            hidden={showSummaryHeader && !expanded}
        >
            {data.totalCalls === 0 ? (
                <p className="text-xs text-muted-foreground">
                    Classification, analysis, generation, and precision remove usage will appear here after AI runs.
                </p>
            ) : null}

            {data.byAction.length > 0 && (
                <div>
                    <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Breakdown</h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        {data.byAction.map((item) => (
                            <div key={item.action} className="bg-muted/30 rounded-md p-2 border border-border/50">
                                <div className="text-xs text-muted-foreground">{ACTION_LABELS[item.action] || item.action}</div>
                                <div className="text-sm font-medium">{item.count} calls</div>
                                <div className="text-xs text-muted-foreground">{formatAiUsageCost(item.costUsd, currency)}</div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {data.recentRecords.length > 0 && (
                <div>
                    <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Recent Activity</h4>
                    <div className="space-y-1">
                        {data.recentRecords.map((record) => (
                            <div key={record.id} className="flex items-center justify-between text-xs py-1.5 border-b border-border/30 last:border-0">
                                <div className="flex min-w-0 items-center gap-2">
                                    <span className="font-medium">{ACTION_LABELS[record.action] || record.action}</span>
                                    <span className="truncate text-muted-foreground">{record.model}</span>
                                </div>
                                <div className="flex shrink-0 items-center gap-3 text-muted-foreground">
                                    {record.totalTokens > 0 && <span>{formatTokens(record.totalTokens)} tok</span>}
                                    <span>{formatAiUsageCost(record.estimatedCostUsd, currency)}</span>
                                    <span>{timeAgo(record.recordedAt)}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );

    return (
        <div className={`border rounded-lg bg-card overflow-hidden ${className}`}>
            {showSummaryHeader ? (
            <button
                type="button"
                onClick={() => setExpanded((prev) => !prev)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/40 transition-colors text-left"
                aria-expanded={expanded}
                aria-controls={detailsId}
            >
                <div className="flex items-center gap-2 text-sm font-medium">
                    <Sparkles className="h-4 w-4 text-amber-500" aria-hidden="true" />
                    <span>{title}</span>
                </div>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    {data.totalCalls > 0 ? (
                        <>
                            <span>{data.totalCalls} calls</span>
                            <span>{formatTokens(data.totalTokens)} tokens</span>
                            <span className="font-medium text-foreground">{formatAiUsageCost(data.totalEstimatedCostUsd, currency)}</span>
                        </>
                    ) : (
                        <span>{emptyLabel}</span>
                    )}
                    <svg
                        className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`}
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={2}
                        stroke="currentColor"
                        aria-hidden="true"
                    >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                </div>
            </button>
            ) : null}
            {details}
        </div>
    );
}
