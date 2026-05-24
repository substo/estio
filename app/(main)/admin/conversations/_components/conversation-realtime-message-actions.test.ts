import assert from 'node:assert/strict';
import test from 'node:test';
import type { Message } from '@/lib/ghl/conversations';
import {
    applyRealtimeMessagePatchToMessages,
    getRealtimeMessageSendState,
} from './conversation-realtime-message-actions';

function message(overrides: Partial<Message> & Record<string, unknown>): Message {
    return {
        id: 'msg-1',
        conversationId: 'conv-1',
        contactId: 'contact-1',
        body: 'hello',
        type: 'WhatsApp',
        direction: 'outbound',
        status: 'sending',
        sendState: 'queued',
        dateAdded: '2026-05-24T00:00:00.000Z',
        attachments: [],
        ...overrides,
    } as Message;
}

test('applyRealtimeMessagePatchToMessages patches by messageId', () => {
    const original = message({ id: 'server-1', clientMessageId: 'cmid-1' });

    const result = applyRealtimeMessagePatchToMessages([original], {
        messageId: 'server-1',
        status: 'sent',
    });

    assert.equal(result.matched, true);
    assert.equal(result.payload.messageId, 'server-1');
    assert.equal(result.messages[0].id, 'server-1');
    assert.equal(result.messages[0].status, 'sent');
    assert.equal((result.messages[0] as any).sendState, 'sent');
});

test('applyRealtimeMessagePatchToMessages patches by clientMessageId', () => {
    const original = message({ id: 'opt-cmid-2', clientMessageId: 'cmid-2' });

    const result = applyRealtimeMessagePatchToMessages([original], {
        messageId: 'server-2',
        clientMessageId: 'cmid-2',
        status: 'sending',
    });

    assert.equal(result.matched, true);
    assert.equal(result.messages[0].id, 'server-2');
    assert.equal((result.messages[0] as any).clientMessageId, 'cmid-2');
    assert.equal(result.messages[0].status, 'sending');
    assert.equal((result.messages[0] as any).sendState, 'sending');
});

test('applyRealtimeMessagePatchToMessages patches by wamId', () => {
    const original = message({ id: 'local-1', wamId: 'wam-1' });

    const result = applyRealtimeMessagePatchToMessages([original], {
        messageId: 'server-3',
        wamId: 'wam-1',
        status: 'delivered',
    });

    assert.equal(result.matched, true);
    assert.equal(result.messages[0].id, 'server-3');
    assert.equal((result.messages[0] as any).wamId, 'wam-1');
    assert.equal(result.messages[0].status, 'delivered');
    assert.equal((result.messages[0] as any).sendState, 'sent');
});

test('applyRealtimeMessagePatchToMessages returns no match when correlation does not match', () => {
    const original = message({ id: 'msg-4', clientMessageId: 'cmid-4', wamId: 'wam-4' });

    const result = applyRealtimeMessagePatchToMessages([original], {
        messageId: 'server-missing',
        clientMessageId: 'cmid-missing',
        wamId: 'wam-missing',
        status: 'failed',
    });

    assert.equal(result.matched, false);
    assert.equal(result.messages[0], original);
    assert.deepEqual(result.messages, [original]);
});

test('getRealtimeMessageSendState preserves realtime status mapping', () => {
    assert.equal(getRealtimeMessageSendState('sending'), 'sending');
    assert.equal(getRealtimeMessageSendState('failed'), 'failed');
    assert.equal(getRealtimeMessageSendState('sent'), 'sent');
    assert.equal(getRealtimeMessageSendState('delivered'), 'sent');
    assert.equal(getRealtimeMessageSendState('read'), 'sent');
});
