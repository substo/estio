import { Checkbox } from "@/components/ui/checkbox";
import { Conversation } from "@/lib/ghl/conversations";
import { cn } from "@/lib/utils";
import { Link as LinkIcon } from "lucide-react";
import { getConversationChannelInfo } from "./conversation-channel-info";

interface ConversationListRowProps {
    conversation: Conversation;
    selectedId: string | null;
    isSelectionMode: boolean;
    isChecked: boolean;
    onSelect: (id: string) => void;
    onToggleSelect?: (id: string, checked: boolean) => void;
    onHoverConversation?: (id: string) => void;
}

const CONTACT_TYPE_TONES: Record<string, string> = {
    lead: "border-blue-200 bg-blue-50 text-blue-700",
    contact: "border-zinc-200 bg-zinc-50 text-zinc-700",
    agent: "border-amber-200 bg-amber-50 text-amber-800",
    owner: "border-emerald-200 bg-emerald-50 text-emerald-700",
    tenant: "border-violet-200 bg-violet-50 text-violet-700",
    partner: "border-cyan-200 bg-cyan-50 text-cyan-700",
    associate: "border-slate-200 bg-slate-50 text-slate-700",
    maintenance: "border-rose-200 bg-rose-50 text-rose-700",
    whatsappgroup: "border-indigo-200 bg-indigo-50 text-indigo-700",
    "ref-groupmember": "border-indigo-200 bg-indigo-50 text-indigo-700",
};

function formatContactTypeLabel(contactType?: string | null) {
    const trimmed = String(contactType || "").trim();
    if (!trimmed) return "Contact";
    if (trimmed === "WhatsAppGroup") return "Group";
    if (trimmed === "Ref-GroupMember") return "Group ref";

    return trimmed
        .replace(/[_-]+/g, " ")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getContactTypeTone(contactType?: string | null) {
    const key = String(contactType || "Contact").trim().toLowerCase().replace(/\s+/g, "");
    return CONTACT_TYPE_TONES[key] || "border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300";
}

export function ConversationListRow({
    conversation,
    selectedId,
    isSelectionMode,
    isChecked,
    onSelect,
    onToggleSelect,
    onHoverConversation,
}: ConversationListRowProps) {
    const channel = getConversationChannelInfo(conversation);
    const contactTypeLabel = formatContactTypeLabel(conversation.contactType);
    const contactTypeTone = getContactTypeTone(conversation.contactType);

    return (
        <div
            data-conversation-id={conversation.id}
            className={cn(
                "border-b transition-colors flex items-start py-2 pl-2 pr-3 cursor-pointer w-full min-w-0 dark:border-slate-800",
                selectedId === conversation.id && !isSelectionMode ? "bg-slate-100 border-l-blue-500 dark:bg-slate-900" : "border-l-transparent",
                isSelectionMode && isChecked ? "bg-indigo-50 dark:bg-indigo-950/30" : "hover:bg-slate-50 dark:hover:bg-slate-900",
                selectedId === conversation.id ? "border-l-4" : "border-l-4"
            )}
            // In Selection Mode, clicking the row toggles selection (UX choice)
            // OR clicking the row still selects it for view, but clicking Checkbox selects for action.
            // Usually Select Mode implies clicking row selects for action.
            onClick={() => {
                if (isSelectionMode && onToggleSelect) {
                    onToggleSelect(conversation.id, !isChecked);
                } else {
                    onSelect(conversation.id);
                }
            }}
            onMouseEnter={() => onHoverConversation?.(conversation.id)}
        >
            {/* Checkbox for Selection Mode */}
            {isSelectionMode && onToggleSelect && (
                <div
                    className="mr-3 pt-1"
                    onClick={(e) => e.stopPropagation()}
                >
                    <Checkbox
                        checked={isChecked}
                        onCheckedChange={(checked: boolean | string) => onToggleSelect(conversation.id, checked === true)}
                    />
                </div>
            )}

            <div className="flex-1 min-w-0 w-0 overflow-hidden">
                {/* Contact name */}
                <div className="flex items-center justify-between gap-2 min-w-0">
                    <h4 className="block w-full min-w-0 flex-1 truncate font-semibold text-sm">
                        {conversation.contactName || conversation.contactId || "Unknown Contact"}
                    </h4>
                    <div className="ml-2 mr-0.5 flex-none shrink-0 flex items-center gap-1">
                        {conversation.unreadCount > 0 && (
                            <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] leading-[18px] text-center font-semibold">
                                {conversation.unreadCount > 99 ? "99+" : conversation.unreadCount}
                            </span>
                        )}
                        {(conversation as any).activeDealId && (
                            <div title={`Linked to Deal: ${(conversation as any).activeDealTitle}`}>
                                <LinkIcon className="h-3 w-3 text-indigo-500" />
                            </div>
                        )}
                    </div>
                </div>
                {/* Channel icon */}
                <div className="mt-1 flex min-w-0 items-center gap-1.5">
                    <div className="flex min-w-0 items-center gap-1 text-gray-500 dark:text-slate-400">
                        {channel.icon}
                        <span className="truncate text-[10px]">{channel.name}</span>
                    </div>
                    <span
                        aria-label={`Contact type: ${contactTypeLabel}`}
                        title={`Contact type: ${contactTypeLabel}`}
                        className={cn(
                            "inline-flex h-4 max-w-[92px] shrink-0 items-center rounded border px-1.5 text-[9px] font-semibold leading-none",
                            contactTypeTone
                        )}
                    >
                        <span className="truncate">{contactTypeLabel}</span>
                    </span>
                </div>
            </div>
        </div>
    );
}
