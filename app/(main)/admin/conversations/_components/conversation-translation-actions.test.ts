import assert from 'node:assert/strict';
import test from 'node:test';

import type { Conversation, Message, MessageTranslationVariant } from '@/lib/ghl/conversations';
import {
    applyMessageTranslation,
    applyMessageTranslations,
    applyReplyLanguageOverrideToConversations,
    getConversationMessageType,
} from './conversation-translation-actions';

test('getConversationMessageType preserves existing SMS, email, and WhatsApp derivation', () => {
    assert.equal(getConversationMessageType({ lastMessageType: 'TYPE_EMAIL', type: 'TYPE_PHONE' } as Conversation), 'Email');
    assert.equal(getConversationMessageType({ lastMessageType: 'TYPE_WHATSAPP', type: 'TYPE_PHONE' } as Conversation), 'WhatsApp');
    assert.equal(getConversationMessageType({ lastMessageType: null, type: 'TYPE_SMS' } as unknown as Conversation), 'SMS');
});

test('applyMessageTranslation preserves translated message metadata shape', () => {
    const translation = {
        targetLanguage: 'en',
        sourceLanguage: 'el',
        sourceText: 'γειά',
        translatedText: 'hello',
        status: 'completed',
        provider: 'openai',
        model: 'gpt-test',
        updatedAt: '2026-05-21T10:00:00.000Z',
    } satisfies MessageTranslationVariant;

    const messages = applyMessageTranslation([
        { id: 'msg-1', detectedLanguage: null, translation: null, translations: [] },
        { id: 'msg-2', detectedLanguage: null, translation: null, translations: [] },
    ] as unknown as Message[], 'msg-1', translation);

    assert.equal((messages[0] as any).detectedLanguage, 'el');
    assert.deepEqual((messages[0] as any).translation, {
        active: translation,
        available: [translation],
        viewDefault: 'translated',
    });
    assert.deepEqual((messages[0] as any).translations, [translation]);
    assert.equal((messages[1] as any).translation, null);
});

test('applyMessageTranslation keeps original view default when source language is absent', () => {
    const translation = {
        targetLanguage: 'en',
        sourceLanguage: null,
        sourceText: 'hello',
        translatedText: 'hello',
        status: 'completed',
    } satisfies MessageTranslationVariant;

    const [message] = applyMessageTranslation([
        { id: 'msg-1', detectedLanguage: 'fr', translation: null, translations: [] },
    ] as unknown as Message[], 'msg-1', translation) as any[];

    assert.equal(message.detectedLanguage, null);
    assert.equal(message.translation.viewDefault, 'original');
    assert.deepEqual(message.translation.available, [translation]);
    assert.deepEqual(message.translations, [translation]);
});

test('applyMessageTranslations applies returned thread translations in one pass', () => {
    const firstTranslation = {
        targetLanguage: 'en',
        sourceLanguage: 'el',
        sourceText: 'γειά',
        translatedText: 'hello',
        status: 'completed',
    } satisfies MessageTranslationVariant;
    const secondTranslation = {
        targetLanguage: 'en',
        sourceLanguage: 'fr',
        sourceText: 'bonjour',
        translatedText: 'hello',
        status: 'completed',
    } satisfies MessageTranslationVariant;

    const messages = applyMessageTranslations([
        { id: 'msg-1', detectedLanguage: null, translation: null, translations: [] },
        { id: 'msg-2', detectedLanguage: null, translation: null, translations: [] },
        { id: 'msg-3', detectedLanguage: null, translation: null, translations: [] },
    ] as unknown as Message[], [
        { messageId: 'msg-1', translation: firstTranslation },
        { messageId: 'msg-2', translation: secondTranslation },
    ]) as any[];

    assert.equal(messages[0].translation.active, firstTranslation);
    assert.equal(messages[0].translation.viewDefault, 'translated');
    assert.deepEqual(messages[0].translations, [firstTranslation]);
    assert.equal(messages[1].translation.active, secondTranslation);
    assert.equal(messages[1].translation.viewDefault, 'translated');
    assert.deepEqual(messages[1].translations, [secondTranslation]);
    assert.equal(messages[2].translation, null);
});

test('applyReplyLanguageOverrideToConversations updates only the matching conversation', () => {
    const conversations = [
        { id: 'conv-1', replyLanguageOverride: 'el', contactName: 'One' },
        { id: 'conv-2', replyLanguageOverride: null, contactName: 'Two' },
    ];

    const updated = applyReplyLanguageOverrideToConversations(conversations, 'conv-2', 'fr');

    assert.deepEqual(updated, [
        { id: 'conv-1', replyLanguageOverride: 'el', contactName: 'One' },
        { id: 'conv-2', replyLanguageOverride: 'fr', contactName: 'Two' },
    ]);
    assert.equal(updated[0], conversations[0]);
    assert.notEqual(updated[1], conversations[1]);
});
