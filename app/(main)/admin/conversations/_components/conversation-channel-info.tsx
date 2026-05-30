import { Mail, MessageCircle, MessageSquare } from "lucide-react";
import type { Conversation } from "@/lib/ghl/conversations";
import {
    deriveConversationDisplayChannel,
    getConversationDisplayChannelLabel,
    type ConversationDisplayChannel,
} from "@/lib/conversations/channel-summary";

/**
 * Map GHL conversation type codes to friendly display names
 */
export function getChannelInfo(type: string): { name: string; icon: React.ReactNode; color: string } {
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

export function getConversationChannelInfo(
    conversation: Pick<Conversation, "lastMessageType" | "type" | "lastMessageSource" | "lastMessageChannel">
): { name: string; icon: React.ReactNode; color: string; channel: ConversationDisplayChannel } {
    const channel = deriveConversationDisplayChannel(conversation);
    if (channel === "SMS_RELAY") {
        return {
            name: getConversationDisplayChannelLabel(channel),
            icon: <MessageSquare className="w-3 h-3" />,
            color: "bg-cyan-50 text-cyan-700",
            channel,
        };
    }

    const fallbackInfo = getChannelInfo(channel === "Unknown" ? conversation.lastMessageType || conversation.type : channel);
    return {
        ...fallbackInfo,
        name: channel === "Unknown" ? fallbackInfo.name : getConversationDisplayChannelLabel(channel),
        channel,
    };
}
