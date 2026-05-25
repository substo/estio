import { Checkbox } from "@/components/ui/checkbox";
import { Conversation } from "@/lib/ghl/conversations";
import { cn } from "@/lib/utils";
import { Link as LinkIcon } from "lucide-react";
import { getChannelInfo } from "./conversation-channel-info";

interface ConversationListRowProps {
    conversation: Conversation;
    selectedId: string | null;
    isSelectionMode: boolean;
    isChecked: boolean;
    onSelect: (id: string) => void;
    onToggleSelect?: (id: string, checked: boolean) => void;
    onHoverConversation?: (id: string) => void;
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
    const channel = getChannelInfo(conversation.lastMessageType || conversation.type);

    return (
        <div
            data-conversation-id={conversation.id}
            className={cn(
                "border-b transition-colors flex items-start py-2 pl-2 pr-3 cursor-pointer w-full min-w-0",
                selectedId === conversation.id && !isSelectionMode ? "bg-slate-100 border-l-blue-500" : "border-l-transparent",
                isSelectionMode && isChecked ? "bg-indigo-50" : "hover:bg-slate-50",
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
                <div className="flex items-center gap-1 mt-1">
                    {channel.icon}
                    <span className="text-[10px] text-gray-500">{channel.name}</span>
                </div>
            </div>
        </div>
    );
}
