'use client';

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronDown, Loader2, Send, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { getConversationSurfaceTheme, type ConversationSurfaceTheme } from "./message-bubble-theme";

export type SuggestedResponseQueueItem = {
    id: string;
    body: string;
    source: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    conversationId: string | null;
    contactId: string | null;
    contactName: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
    dealId: string | null;
    traceId: string | null;
    decisionId?: string | null;
    decision?: {
        id: string;
        selectedSkillId: string | null;
        selectedObjective: string | null;
        selectedScore: number | null;
        holdReason?: string | null;
        source?: string | null;
    } | null;
    metadata: any;
};

interface SuggestedResponseQueueProps {
    items: SuggestedResponseQueueItem[];
    loading?: boolean;
    onAccept: (id: string, mode: "insertOnly" | "sendNow") => Promise<void> | void;
    onReject: (id: string, reason?: string | null) => Promise<void> | void;
    className?: string;
    allowSendNow?: boolean;
    surfaceTheme?: ConversationSurfaceTheme;
    collapsed?: boolean;
    onCollapsedChange?: (collapsed: boolean) => void;
}

function formatSourceLabel(source: string): string {
    const normalized = String(source || "").trim();
    if (!normalized) return "AI";

    if (normalized.startsWith("automation:")) {
        const key = normalized.slice("automation:".length).replace(/_/g, " ");
        return `Automation · ${key}`;
    }

    if (normalized.startsWith("semi_auto:")) {
        const key = normalized.slice("semi_auto:".length).replace(/_/g, " ");
        return `Semi Auto · ${key}`;
    }

    if (normalized.startsWith("manual:")) {
        const key = normalized.slice("manual:".length).replace(/_/g, " ");
        return `Manual · ${key}`;
    }

    if (normalized.startsWith("mission:")) {
        const key = normalized.slice("mission:".length).replace(/_/g, " ");
        return `Coordinator · ${key}`;
    }

    return normalized.replace(/_/g, " ");
}

function formatCreatedLabel(createdAt: string): string {
    const date = new Date(createdAt);
    if (Number.isNaN(date.getTime())) return "just now";
    return date.toLocaleString();
}

export function getPendingSuggestedResponseCount(items: SuggestedResponseQueueItem[]): number {
    return Array.isArray(items) ? items.filter((item) => item.status === "pending").length : 0;
}

export function SuggestedResponseQueue({
    items,
    onAccept,
    onReject,
    className,
    allowSendNow = true,
    surfaceTheme,
    collapsed = false,
    onCollapsedChange,
}: SuggestedResponseQueueProps) {
    const [busyId, setBusyId] = useState<string | null>(null);
    const resolvedSurfaceTheme = surfaceTheme || getConversationSurfaceTheme(null);

    const visibleItems = useMemo(
        () => (Array.isArray(items) ? items.filter((item) => item.status === "pending") : []),
        [items]
    );

    if (visibleItems.length === 0) {
        return null;
    }

    if (collapsed) {
        return null;
    }

    const run = async (id: string, action: () => Promise<void> | void) => {
        if (!id || busyId) return;
        setBusyId(id);
        try {
            await Promise.resolve(action());
        } finally {
            setBusyId(null);
        }
    };

    return (
        <div className={cn("px-3 py-2 space-y-2", resolvedSurfaceTheme.suggestedQueueClassName, className)}>
            <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-semibold text-slate-700">
                    AI Suggestions
                    <span className="ml-1 font-normal text-slate-500">({visibleItems.length})</span>
                </div>
                {onCollapsedChange && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1 px-2 text-[11px] text-slate-600 hover:bg-white/70"
                        onClick={() => onCollapsedChange(true)}
                        title="Minimize AI suggestions"
                    >
                        <ChevronDown className="h-3.5 w-3.5" />
                        Minimize
                    </Button>
                )}
            </div>

            {visibleItems.map((item) => (
                <div key={item.id} className="rounded-md border bg-white p-2.5 space-y-2 shadow-sm">
                    <div className="flex items-center justify-between gap-2">
                        <div className="text-[10px] text-slate-500 truncate">{formatSourceLabel(item.source)}</div>
                        <div className="text-[10px] text-slate-400 shrink-0">{formatCreatedLabel(item.createdAt)}</div>
                    </div>
                    <div className="text-[10px] text-slate-500 flex flex-wrap gap-2">
                        {(item.decision?.selectedSkillId || item.metadata?.skillId) && (
                            <span>Skill: {item.decision?.selectedSkillId || item.metadata?.skillId}</span>
                        )}
                        {(item.decision?.selectedObjective || item.metadata?.objective) && (
                            <span>Objective: {item.decision?.selectedObjective || item.metadata?.objective}</span>
                        )}
                        {(item.decision?.selectedScore != null || item.metadata?.scoreBreakdown) && (
                            <span>
                                Score: {item.decision?.selectedScore != null
                                    ? Number(item.decision?.selectedScore).toFixed(2)
                                    : "-"}
                            </span>
                        )}
                        {item.traceId && (
                            <span className="font-mono">Trace: {item.traceId.slice(0, 10)}...</span>
                        )}
                    </div>
                    <p className="text-xs text-slate-800 whitespace-pre-wrap break-words">{item.body}</p>
                    <div className="flex items-center justify-end gap-1.5">
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs text-slate-600 hover:text-red-700 hover:bg-red-50"
                            disabled={busyId === item.id}
                            onClick={() =>
                                run(item.id, async () => {
                                    const reason = typeof window === "undefined"
                                        ? "Not a fit"
                                        : window.prompt("Reason for rejecting this suggestion", "Not a fit");
                                    if (reason === null) return;
                                    await onReject(item.id, reason);
                                })
                            }
                        >
                            {busyId === item.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                            Reject
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            disabled={busyId === item.id}
                            onClick={() => run(item.id, () => onAccept(item.id, "insertOnly"))}
                        >
                            {busyId === item.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                            Accept
                        </Button>
                        {allowSendNow && (
                            <Button
                                type="button"
                                size="sm"
                                className={cn("h-7 px-2 text-xs", resolvedSurfaceTheme.suggestedQueuePrimaryButtonClassName)}
                                disabled={busyId === item.id}
                                onClick={() => run(item.id, () => onAccept(item.id, "sendNow"))}
                            >
                                {busyId === item.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                                Accept + Send
                            </Button>
                        )}
                    </div>
                </div>
            ))}
        </div>
    );
}
