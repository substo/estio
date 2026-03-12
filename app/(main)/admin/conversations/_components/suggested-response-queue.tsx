'use client';

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Send, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

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
    metadata: any;
};

interface SuggestedResponseQueueProps {
    items: SuggestedResponseQueueItem[];
    loading?: boolean;
    onAccept: (id: string, mode: "insertOnly" | "sendNow") => Promise<void> | void;
    onReject: (id: string, reason?: string | null) => Promise<void> | void;
    className?: string;
    allowSendNow?: boolean;
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

    return normalized.replace(/_/g, " ");
}

function formatCreatedLabel(createdAt: string): string {
    const date = new Date(createdAt);
    if (Number.isNaN(date.getTime())) return "just now";
    return date.toLocaleString();
}

export function SuggestedResponseQueue({
    items,
    loading = false,
    onAccept,
    onReject,
    className,
    allowSendNow = true,
}: SuggestedResponseQueueProps) {
    const [busyId, setBusyId] = useState<string | null>(null);

    const visibleItems = useMemo(
        () => (Array.isArray(items) ? items.filter((item) => item.status === "pending") : []),
        [items]
    );

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
        <div className={cn("border-t border-b bg-slate-50/70 px-3 py-2 space-y-2", className)}>
            <div className="flex items-center justify-between">
                <div className="text-xs font-semibold text-slate-700">Suggested Responses</div>
                <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                    {loading ? "loading" : `${visibleItems.length}`}
                </Badge>
            </div>

            {loading ? (
                <div className="flex items-center gap-2 text-xs text-slate-500 py-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Loading suggestions...
                </div>
            ) : visibleItems.length === 0 ? (
                <div className="text-xs text-slate-500 py-2">
                    No pending suggestions yet.
                </div>
            ) : (
                visibleItems.map((item) => (
                    <div key={item.id} className="rounded-md border bg-white p-2.5 space-y-2 shadow-sm">
                        <div className="flex items-center justify-between gap-2">
                            <div className="text-[10px] text-slate-500 truncate">{formatSourceLabel(item.source)}</div>
                            <div className="text-[10px] text-slate-400 shrink-0">{formatCreatedLabel(item.createdAt)}</div>
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
                                    className="h-7 px-2 text-xs"
                                    disabled={busyId === item.id}
                                    onClick={() => run(item.id, () => onAccept(item.id, "sendNow"))}
                                >
                                    {busyId === item.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                                    Accept + Send
                                </Button>
                            )}
                        </div>
                    </div>
                ))
            )}
        </div>
    );
}
