import { Conversation } from "@/lib/ghl/conversations";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { Mail, MessageSquare, MessageCircle } from "lucide-react";

interface ConversationPreviewCardProps {
    conversation: Conversation;
}

/**
 * Map GHL conversation type codes to friendly display names
 */
function getChannelInfo(type: string): { name: string; icon: React.ReactNode; color: string } {
    const typeUpper = type?.toUpperCase() || '';

    if (typeUpper.includes('EMAIL')) {
        return { name: 'Email', icon: <Mail className="w-3 h-3" />, color: 'bg-purple-50 text-purple-600' };
    }
    if (typeUpper.includes('WHATSAPP')) {
        return { name: 'WhatsApp', icon: <MessageCircle className="w-3 h-3" />, color: 'bg-green-50 text-green-600' };
    }
    if (typeUpper.includes('PHONE') || typeUpper.includes('SMS') || typeUpper.includes('CALL')) {
        return { name: 'SMS', icon: <MessageSquare className="w-3 h-3" />, color: 'bg-blue-50 text-blue-600' };
    }
    if (typeUpper.includes('WEBCHAT') || typeUpper.includes('LIVE')) {
        return { name: 'Live Chat', icon: <MessageSquare className="w-3 h-3" />, color: 'bg-orange-50 text-orange-600' };
    }
    // Fallback
    return { name: type || 'Unknown', icon: <MessageSquare className="w-3 h-3" />, color: 'bg-gray-50 text-gray-600' };
}

/**
 * A preview card shown when hovering over a conversation in the list.
 * Displays contact name, timestamp, channel, status, and message preview.
 */
export function ConversationPreviewCard({ conversation }: ConversationPreviewCardProps) {
    const channel = getChannelInfo(conversation.lastMessageType || conversation.type);

    return (
        <div className="p-4">
            {/* Header: Contact name + timestamp */}
            <div className="flex justify-between items-start mb-3">
                <h4 className="font-semibold text-sm truncate mr-2">
                    {conversation.contactName || conversation.contactId || "Unknown Contact"}
                </h4>
                <span className="text-xs text-gray-400 shrink-0">
                    {conversation.lastMessageDate
                        ? formatDistanceToNow(new Date(conversation.lastMessageDate), { addSuffix: true })
                        : ""}
                </span>
            </div>

            {/* Channel + Status badges */}
            <div className="flex items-center gap-2 mb-3">
                <span className={cn(
                    "text-[10px] px-1.5 py-0.5 rounded-full font-medium uppercase",
                    conversation.status === 'open' ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"
                )}>
                    {conversation.status}
                </span>
                <span className={cn("text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1", channel.color)}>
                    {channel.icon}
                    {channel.name}
                </span>
            </div>

            {/* Message preview - up to 4 lines */}
            <p className="text-sm text-gray-700 line-clamp-4">
                {conversation.lastMessageBody || "No messages"}
            </p>
        </div>
    );
}
