'use client';

import type { Conversation, Message, MessageTranslationVariant } from '@/lib/ghl/conversations';

export type ReplyLanguageOverrideConversation = Pick<Conversation, 'id' | 'replyLanguageOverride'>;

export function getConversationMessageType(conversation: Pick<Conversation, 'lastMessageType' | 'type'>): 'SMS' | 'Email' | 'WhatsApp' {
    const type = (conversation.lastMessageType || conversation.type || '').toUpperCase();
    if (type.includes('EMAIL')) return 'Email';
    if (type.includes('WHATSAPP')) return 'WhatsApp';
    return 'SMS';
}

export function applyMessageTranslation(
    messages: Message[],
    messageId: string,
    translation: MessageTranslationVariant
): Message[] {
    return messages.map((message) => {
        if (String(message.id || "") !== messageId) return message;
        return {
            ...message,
            detectedLanguage: translation.sourceLanguage || null,
            translation: {
                active: translation,
                available: [translation],
                viewDefault: translation.sourceLanguage ? "translated" : "original",
            },
            translations: [translation],
        } as Message;
    });
}

export function applyMessageTranslations(
    messages: Message[],
    translations: Array<{ messageId: string; translation: MessageTranslationVariant }>
): Message[] {
    if (!translations.length) return messages;
    const translationByMessageId = new Map(
        translations
            .map((entry) => [String(entry.messageId || "").trim(), entry.translation] as const)
            .filter(([messageId, translation]) => !!messageId && !!translation)
    );
    if (translationByMessageId.size === 0) return messages;

    return messages.map((message) => {
        const translation = translationByMessageId.get(String(message.id || "").trim());
        if (!translation) return message;
        return {
            ...message,
            detectedLanguage: translation.sourceLanguage || null,
            translation: {
                active: translation,
                available: [translation],
                viewDefault: translation.sourceLanguage ? "translated" : "original",
            },
            translations: [translation],
        } as Message;
    });
}

export function applyReplyLanguageOverrideToConversations<T extends ReplyLanguageOverrideConversation>(
    conversations: T[],
    conversationId: string,
    replyLanguageOverride: string | null
): T[] {
    return conversations.map((conversationItem) =>
        conversationItem.id === conversationId
            ? { ...conversationItem, replyLanguageOverride }
            : conversationItem
    );
}
