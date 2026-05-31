import type { Conversation } from "@/lib/ghl/conversations";

export type ConversationLifecycleUi = {
    label: string;
    dotClassName: string;
    badgeClassName: string;
};

export function getConversationLifecycleUi(
    status: Conversation["status"] | string | null | undefined
): ConversationLifecycleUi {
    const normalized = String(status || "").trim().toLowerCase();
    if (normalized === "closed") {
        return {
            label: "Closed",
            dotClassName: "bg-slate-400",
            badgeClassName: "bg-slate-100 text-slate-600",
        };
    }
    if (normalized === "starred") {
        return {
            label: "Starred",
            dotClassName: "bg-amber-400",
            badgeClassName: "bg-amber-50 text-amber-700",
        };
    }
    if (normalized === "open") {
        return {
            label: "Conversation open",
            dotClassName: "bg-blue-400",
            badgeClassName: "bg-blue-50 text-blue-700",
        };
    }

    return {
        label: normalized || "Unknown status",
        dotClassName: "bg-slate-300",
        badgeClassName: "bg-slate-100 text-slate-600",
    };
}
