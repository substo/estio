"use client";

import { useEffect, useState } from "react";
import { getLocationAiUsageSummary, type LocationAiUsageSummary } from "@/app/(main)/admin/_actions/ai-usage";
import { Sparkles, TrendingUp, Cpu, DollarSign } from "lucide-react";

const FEATURE_LABELS: Record<string, string> = {
    property_image_enhancement: "Image Enhancement",
    viewing_translation: "Viewing Translation",
    viewing_insights: "Viewing Insights",
    smart_reply: "Smart Reply",
    prospect_classification: "Prospect Classification",
};

const PROVIDER_LABELS: Record<string, string> = {
    google_gemini: "Gemini",
    vertex_imagen: "Imagen",
    openai: "OpenAI",
};

function formatCost(cost: number): string {
    if (cost === 0) return "$0.00";
    if (cost < 0.01) return `$${cost.toFixed(4)}`;
    return `$${cost.toFixed(2)}`;
}

function formatTokens(tokens: number): string {
    if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
    if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
    return String(tokens);
}

export function GlobalAiUsageWidget() {
    const [data, setData] = useState<LocationAiUsageSummary | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        getLocationAiUsageSummary()
            .then(setData)
            .catch(() => { })
            .finally(() => setLoading(false));
    }, []);

    if (loading) {
        return (
            <div className="border rounded-lg bg-card p-6 animate-pulse">
                <div className="h-5 w-40 bg-muted rounded mb-4" />
                <div className="grid grid-cols-3 gap-4">
                    <div className="h-16 bg-muted rounded" />
                    <div className="h-16 bg-muted rounded" />
                    <div className="h-16 bg-muted rounded" />
                </div>
            </div>
        );
    }

    if (!data || data.totalCalls === 0) {
        return (
            <div className="border rounded-lg bg-card p-6">
                <div className="flex items-center gap-2 mb-2">
                    <Sparkles className="h-5 w-5 text-amber-500" />
                    <h2 className="text-lg font-semibold">AI Usage This Month</h2>
                </div>
                <p className="text-sm text-muted-foreground">No AI usage recorded yet this month.</p>
            </div>
        );
    }

    return (
        <div className="border rounded-lg bg-card p-6 space-y-5">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-amber-500" />
                    <h2 className="text-lg font-semibold">AI Usage This Month</h2>
                </div>
                <span className="text-xs text-muted-foreground">
                    {new Date().toLocaleString("default", { month: "long", year: "numeric" })}
                </span>
            </div>

            {/* Hero stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-muted/30 rounded-lg p-4 border border-border/50 flex items-start gap-3">
                    <div className="p-2 rounded-md bg-blue-500/10">
                        <TrendingUp className="h-5 w-5 text-blue-500" />
                    </div>
                    <div>
                        <div className="text-2xl font-bold">{data.totalCalls.toLocaleString()}</div>
                        <div className="text-xs text-muted-foreground">Total AI Calls</div>
                    </div>
                </div>
                <div className="bg-muted/30 rounded-lg p-4 border border-border/50 flex items-start gap-3">
                    <div className="p-2 rounded-md bg-purple-500/10">
                        <Cpu className="h-5 w-5 text-purple-500" />
                    </div>
                    <div>
                        <div className="text-2xl font-bold">{formatTokens(data.totalTokens)}</div>
                        <div className="text-xs text-muted-foreground">Total Tokens</div>
                    </div>
                </div>
                <div className="bg-muted/30 rounded-lg p-4 border border-border/50 flex items-start gap-3">
                    <div className="p-2 rounded-md bg-emerald-500/10">
                        <DollarSign className="h-5 w-5 text-emerald-500" />
                    </div>
                    <div>
                        <div className="text-2xl font-bold">{formatCost(data.totalEstimatedCostUsd)}</div>
                        <div className="text-xs text-muted-foreground">Estimated Cost</div>
                    </div>
                </div>
            </div>

            {/* Breakdown tables */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* By Feature */}
                {data.byFeatureArea.length > 0 && (
                    <div>
                        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">By Feature</h3>
                        <div className="border rounded-md divide-y">
                            {data.byFeatureArea.map((f) => (
                                <div key={f.featureArea} className="flex items-center justify-between px-3 py-2 text-sm">
                                    <span className="font-medium">{FEATURE_LABELS[f.featureArea] || f.featureArea}</span>
                                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                        <span>{f.count} calls</span>
                                        <span className="font-medium text-foreground">{formatCost(f.costUsd)}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* By Model */}
                {data.byModel.length > 0 && (
                    <div>
                        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">By Model</h3>
                        <div className="border rounded-md divide-y">
                            {data.byModel.map((m) => (
                                <div key={`${m.provider}::${m.model}`} className="flex items-center justify-between px-3 py-2 text-sm">
                                    <div>
                                        <span className="font-medium">{m.model}</span>
                                        <span className="ml-1.5 text-xs text-muted-foreground">({PROVIDER_LABELS[m.provider] || m.provider})</span>
                                    </div>
                                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                        <span>{m.count} calls</span>
                                        <span className="font-medium text-foreground">{formatCost(m.costUsd)}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
