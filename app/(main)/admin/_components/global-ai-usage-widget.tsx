"use client";

import { useEffect, useState } from "react";
import {
    getCurrentUserAiUsageSummary,
    getLocationAiUsageSummary,
    type LocationAiUsageSummary,
} from "@/app/(main)/admin/_actions/ai-usage";
import { Sparkles, TrendingUp, Cpu, DollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AiUsageViewScope } from "@/lib/ai/usage-summary-scope";

const FEATURE_LABELS: Record<string, string> = {
    conversational_ai: "Conversations",
    property_match_campaigns: "Property Campaigns",
    contact_verification: "Contact Verification",
    requirements_intelligence: "Requirements Intelligence",
    property_image_enhancement: "Image Enhancement",
    property_printing: "Property Printing",
    property_translation: "Property Translation",
    audio_transcription: "Audio Transcription",
    viewing_translation: "Viewing Translation",
    viewing_insights: "Viewing Insights",
    viewing_session: "Viewing Sessions",
    smart_reply: "Smart Reply",
    smart_agent: "Smart Agent",
    prospect_classification: "Prospect Classification",
};

const ACTION_LABELS: Record<string, string> = {
    generate_draft: "Generate conversation draft",
    generate_draft_error: "Conversation draft error",
    score_candidate: "Score campaign contact",
    verify_contact_profile: "Verify campaign contact",
    profile_scan: "Verify contact profile",
    generate_requirement_proposal: "Extract requirements",
    assess_no_change: "Assess requirements",
    generate_print_copy: "Generate property print copy",
    translate_property: "Translate property",
    analyze: "Analyze",
    generate: "Generate",
    precision_remove: "Precision remove",
    predict_room_type: "Predict room type",
};

const PROVIDER_LABELS: Record<string, string> = {
    google_gemini: "Gemini",
    vertex_imagen: "Imagen",
    openai: "OpenAI",
    chatgpt_subscription: "ChatGPT Subscription",
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

export function GlobalAiUsageWidget({
    canViewLocationUsage,
}: {
    canViewLocationUsage: boolean;
}) {
    const [data, setData] = useState<LocationAiUsageSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [scope, setScope] = useState<AiUsageViewScope>("user");

    useEffect(() => {
        let cancelled = false;
        setLoading(true);

        const request = scope === "location"
            ? getLocationAiUsageSummary()
            : getCurrentUserAiUsageSummary();

        request
            .then((summary) => {
                if (!cancelled) setData(summary);
            })
            .catch(() => {
                if (!cancelled) setData(null);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [scope]);

    const heading = scope === "location"
        ? "Location AI Usage This Month"
        : "Your AI Usage This Month";

    const scopeSwitch = canViewLocationUsage ? (
        <div className="flex items-center gap-1 rounded-md border bg-muted/30 p-1" role="group" aria-label="AI usage view">
            <Button
                type="button"
                size="sm"
                variant={scope === "user" ? "secondary" : "ghost"}
                aria-pressed={scope === "user"}
                onClick={() => setScope("user")}
            >
                My usage
            </Button>
            <Button
                type="button"
                size="sm"
                variant={scope === "location" ? "secondary" : "ghost"}
                aria-pressed={scope === "location"}
                onClick={() => setScope("location")}
            >
                Location usage
            </Button>
        </div>
    ) : null;

    if (loading) {
        return (
            <div className="border rounded-lg bg-card p-6 space-y-4" aria-busy="true">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                        <Sparkles className="h-5 w-5 text-amber-500" aria-hidden="true" />
                        <h2 className="text-lg font-semibold">{heading}</h2>
                    </div>
                    {scopeSwitch}
                </div>
                <div className="animate-pulse" role="status" aria-live="polite">
                    <span className="sr-only">Loading {scope === "location" ? "location" : "your"} AI usage</span>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                        <div className="h-16 bg-muted rounded" />
                        <div className="h-16 bg-muted rounded" />
                        <div className="h-16 bg-muted rounded" />
                    </div>
                </div>
            </div>
        );
    }

    if (!data || data.totalCalls === 0) {
        return (
            <div className="border rounded-lg bg-card p-6 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                        <Sparkles className="h-5 w-5 text-amber-500" aria-hidden="true" />
                        <h2 className="text-lg font-semibold">{heading}</h2>
                    </div>
                    {scopeSwitch}
                </div>
                <p className="text-sm text-muted-foreground">No AI usage recorded yet this month.</p>
            </div>
        );
    }

    return (
        <div className="border rounded-lg bg-card p-6 space-y-5">
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-amber-500" aria-hidden="true" />
                    <h2 className="text-lg font-semibold">{heading}</h2>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-3">
                    {scopeSwitch}
                    <span className="text-xs text-muted-foreground">
                        {new Date().toLocaleString("default", { month: "long", year: "numeric" })}
                    </span>
                </div>
            </div>

            {scope === "location" && (
                <p className="text-sm text-muted-foreground">
                    Includes usage from all team members and automated location workflows.
                </p>
            )}

            {/* Hero stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-muted/30 rounded-lg p-4 border border-border/50 flex items-start gap-3">
                    <div className="p-2 rounded-md bg-blue-500/10">
                        <TrendingUp className="h-5 w-5 text-blue-500" aria-hidden="true" />
                    </div>
                    <div>
                        <div className="text-2xl font-bold">{data.totalCalls.toLocaleString()}</div>
                        <div className="text-xs text-muted-foreground">Total AI Calls</div>
                    </div>
                </div>
                <div className="bg-muted/30 rounded-lg p-4 border border-border/50 flex items-start gap-3">
                    <div className="p-2 rounded-md bg-purple-500/10">
                        <Cpu className="h-5 w-5 text-purple-500" aria-hidden="true" />
                    </div>
                    <div>
                        <div className="text-2xl font-bold">{formatTokens(data.totalTokens)}</div>
                        <div className="text-xs text-muted-foreground">Total Tokens</div>
                    </div>
                </div>
                <div className="bg-muted/30 rounded-lg p-4 border border-border/50 flex items-start gap-3">
                    <div className="p-2 rounded-md bg-emerald-500/10">
                        <DollarSign className="h-5 w-5 text-emerald-500" aria-hidden="true" />
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

                {data.byAction?.length > 0 && (
                    <div>
                        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">By API Call</h3>
                        <div className="border rounded-md divide-y">
                            {data.byAction.slice(0, 10).map((item) => (
                                <div key={`${item.featureArea}::${item.action}`} className="flex items-center justify-between px-3 py-2 text-sm">
                                    <div className="min-w-0">
                                        <div className="truncate font-medium">{ACTION_LABELS[item.action] || item.action}</div>
                                        <div className="truncate text-xs text-muted-foreground">{FEATURE_LABELS[item.featureArea] || item.featureArea}</div>
                                    </div>
                                    <div className="ml-3 flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                                        <span>{item.count} calls</span>
                                        <span className="font-medium text-foreground">{formatCost(item.costUsd)}</span>
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
