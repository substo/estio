"use client";

import { useEffect, useState } from "react";
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

function formatCost(cost: number): string {
    if (cost < 0.01) return `$${cost.toFixed(4)}`;
    return `$${cost.toFixed(2)}`;
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
}

export function PropertyAiUsageBadge({ propertyId }: PropertyAiUsageBadgeProps) {
    const [data, setData] = useState<AiUsageSummary | null>(null);
    const [expanded, setExpanded] = useState(false);

    useEffect(() => {
        getPropertyAiUsageSummary(propertyId).then(setData).catch(() => { });
    }, [propertyId]);

    if (!data || data.totalCalls === 0) return null;

    return (
        <div className="border rounded-lg bg-card overflow-hidden">
            {/* Compact summary bar */}
            <button
                onClick={() => setExpanded((prev) => !prev)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/40 transition-colors text-left"
            >
                <div className="flex items-center gap-2 text-sm font-medium">
                    <Sparkles className="h-4 w-4 text-amber-500" />
                    <span>AI Usage</span>
                </div>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span>{data.totalCalls} calls</span>
                    <span>{formatTokens(data.totalTokens)} tokens</span>
                    <span className="font-medium text-foreground">{formatCost(data.totalEstimatedCostUsd)}</span>
                    <svg
                        className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`}
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={2}
                        stroke="currentColor"
                    >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                </div>
            </button>

            {/* Expanded details */}
            {expanded && (
                <div className="border-t px-4 py-3 space-y-4">
                    {/* Breakdown by action */}
                    {data.byAction.length > 0 && (
                        <div>
                            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Breakdown</h4>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                {data.byAction.map((item) => (
                                    <div key={item.action} className="bg-muted/30 rounded-md p-2 border border-border/50">
                                        <div className="text-xs text-muted-foreground">{ACTION_LABELS[item.action] || item.action}</div>
                                        <div className="text-sm font-medium">{item.count} calls</div>
                                        <div className="text-xs text-muted-foreground">{formatCost(item.costUsd)}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Recent activity */}
                    {data.recentRecords.length > 0 && (
                        <div>
                            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Recent Activity</h4>
                            <div className="space-y-1">
                                {data.recentRecords.map((record) => (
                                    <div key={record.id} className="flex items-center justify-between text-xs py-1.5 border-b border-border/30 last:border-0">
                                        <div className="flex items-center gap-2">
                                            <span className="font-medium">{ACTION_LABELS[record.action] || record.action}</span>
                                            <span className="text-muted-foreground">{record.model}</span>
                                        </div>
                                        <div className="flex items-center gap-3 text-muted-foreground">
                                            {record.totalTokens > 0 && <span>{formatTokens(record.totalTokens)} tok</span>}
                                            <span>{formatCost(record.estimatedCostUsd)}</span>
                                            <span>{timeAgo(record.recordedAt)}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
