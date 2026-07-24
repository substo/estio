import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Conversation } from "@/lib/ghl/conversations";
import { ConversationListRow } from "./conversation-list-row";
import { ConversationPreviewCard } from "./conversation-preview-card";

interface ConversationListItemProps {
    conversation: Conversation;
    selectedId: string | null;
    isSelectionMode: boolean;
    isChecked: boolean;
    disablePreviewCard: boolean;
    onSelect: (id: string) => void;
    onToggleSelect?: (id: string, checked: boolean) => void;
    onHoverConversation?: (id: string) => void;
    onOpenPropertyCampaign?: (campaignId: string, candidateId: string) => void;
}

export function ConversationListItem({
    conversation,
    selectedId,
    isSelectionMode,
    isChecked,
    disablePreviewCard,
    onSelect,
    onToggleSelect,
    onHoverConversation,
    onOpenPropertyCampaign,
}: ConversationListItemProps) {
    const row = (
        <ConversationListRow
            conversation={conversation}
            selectedId={selectedId}
            isSelectionMode={isSelectionMode}
            isChecked={isChecked}
            onSelect={onSelect}
            onToggleSelect={onToggleSelect}
            onHoverConversation={onHoverConversation}
            onOpenPropertyCampaign={onOpenPropertyCampaign}
        />
    );

    if (disablePreviewCard) {
        return row;
    }

    return (
        <HoverCard openDelay={300} closeDelay={100}>
            <HoverCardTrigger asChild>
                {row}
            </HoverCardTrigger>
            <HoverCardContent
                side="right"
                align="start"
                sideOffset={8}
                className="w-80 p-0"
            >
                <ConversationPreviewCard conversation={conversation} />
            </HoverCardContent>
        </HoverCard>
    );
}
