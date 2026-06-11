import { DEFAULT_REPLY_LANGUAGE } from "@/lib/ai/reply-language-options";
import type { Conversation } from "@/lib/ghl/conversations";
import { isLikelyGhlConversationId } from "@/lib/conversations/identity";
import { deriveConversationDisplayChannel } from "@/lib/conversations/channel-summary";
import {
    resolveCurrentLatestMessageMetadata,
    type ConversationLatestMessageMetadata,
} from "@/lib/conversations/latest-message-metadata";

export type ConversationRowMapperLocation = {
    id?: string | null;
    ghlLocationId?: string | null;
};

export type ConversationRowActiveDealMap = Map<string, { id: string; title: string }>;

export function mapConversationRowToUi(
    c: any,
    location: ConversationRowMapperLocation,
    dealMap?: ConversationRowActiveDealMap,
    locationDefaultReplyLanguage?: string | null,
    latestMessageMap?: Map<string, ConversationLatestMessageMetadata>,
) {
    const candidateLatestMessage = latestMessageMap?.get(c.id) || c.latestMessage || null;
    const latestMessage = resolveCurrentLatestMessageMetadata(c.lastMessageAt, candidateLatestMessage);
    const lastMessageType = latestMessage?.type || c.lastMessageType || undefined;
    const lastMessageSource = latestMessage ? latestMessage.source ?? null : null;
    const lastMessageDirection = latestMessage?.direction === "inbound" || latestMessage?.direction === "outbound"
        ? latestMessage.direction
        : undefined;
    const channelInput = {
        lastMessageType,
        type: lastMessageType || c.lastMessageType || "TYPE_SMS",
        lastMessageSource,
    };

    return {
        id: c.id,
        legacyConversationId: c.ghlConversationId || null,
        providerConversationId: isLikelyGhlConversationId(c.ghlConversationId) ? c.ghlConversationId : null,
        ghlConversationId: isLikelyGhlConversationId(c.ghlConversationId) ? c.ghlConversationId : null,
        contactId: c.contactId,
        legacyContactId: c.contact?.ghlContactId || null,
        providerContactId: c.contact?.ghlContactId || null,
        contactName: c.contact?.name || "Unknown",
        contactPhone: c.contact?.phone || undefined,
        contactEmail: c.contact?.email || undefined,
        contactType: c.contact?.contactType || null,
        contactPreferredLanguage: c.contact?.preferredLang || null,
        replyLanguageOverride: c.replyLanguageOverride || null,
        currentLanguage: c.currentLanguage || null,
        currentLanguageSource: c.currentLanguageSource || null,
        currentLanguageConfidence: Number.isFinite(Number(c.currentLanguageConfidence))
            ? Number(c.currentLanguageConfidence)
            : null,
        locationDefaultReplyLanguage: locationDefaultReplyLanguage || DEFAULT_REPLY_LANGUAGE,
        detectedThreadLanguage: c.detectedThreadLanguage || null,
        detectedThreadLanguageConfidence: Number.isFinite(Number(c.detectedThreadLanguageConfidence))
            ? Number(c.detectedThreadLanguageConfidence)
            : null,
        lastMessageBody: c.lastMessageBody || "",
        lastMessageDate: Math.floor(new Date(c.lastMessageAt).getTime() / 1000),
        unreadCount: c.unreadCount,
        status: c.status as any,
        type: lastMessageType || "TYPE_SMS",
        lastMessageType,
        lastMessageSource,
        lastMessageDirection,
        lastMessageId: latestMessage?.id || null,
        lastMessageChannel: deriveConversationDisplayChannel(channelInput),
        locationId: location.id || location.ghlLocationId || "",
        activeDealId: dealMap?.get(c.id)?.id || dealMap?.get(c.ghlConversationId)?.id,
        activeDealTitle: dealMap?.get(c.id)?.title || dealMap?.get(c.ghlConversationId)?.title,
        suggestedActions: c.suggestedActions || [],
    } satisfies Conversation;
}
