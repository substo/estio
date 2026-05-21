import assert from 'node:assert/strict';
import test from 'node:test';

import type { Message } from '@/lib/ghl/conversations';
import {
    getMessageSignature,
    getTranscriptActionModeLabel,
    hasPendingTranscripts,
} from './conversation-transcript-actions';

const baseMessage = {
    id: 'msg-1',
    status: 'delivered',
    dateAdded: '2026-05-21T10:00:00.000Z',
    body: 'hello',
    type: 'WhatsApp',
    direction: 'inbound',
} as Message;

test('hasPendingTranscripts detects transcript and extraction work in progress', () => {
    assert.equal(hasPendingTranscripts([]), false);
    assert.equal(hasPendingTranscripts([
        {
            ...baseMessage,
            attachments: [
                {
                    id: 'att-1',
                    url: 'https://example.test/audio.ogg',
                    transcript: { status: 'processing' },
                },
            ],
        },
    ]), true);
    assert.equal(hasPendingTranscripts([
        {
            ...baseMessage,
            attachments: [
                {
                    id: 'att-1',
                    url: 'https://example.test/audio.ogg',
                    transcript: {
                        status: 'completed',
                        extraction: { status: 'pending' },
                    },
                },
            ],
        },
    ]), true);
});

test('getMessageSignature changes when transcript state changes', () => {
    const pending = getMessageSignature([
        {
            ...baseMessage,
            attachments: [
                {
                    id: 'att-1',
                    url: 'https://example.test/audio.ogg',
                    transcript: { status: 'pending', text: null, updatedAt: '2026-05-21T10:01:00.000Z' },
                },
            ],
        },
    ]);
    const completed = getMessageSignature([
        {
            ...baseMessage,
            attachments: [
                {
                    id: 'att-1',
                    url: 'https://example.test/audio.ogg',
                    transcript: { status: 'completed', text: 'Viewing at noon', updatedAt: '2026-05-21T10:02:00.000Z' },
                },
            ],
        },
    ]);

    assert.notEqual(pending, completed);
});

test('getTranscriptActionModeLabel preserves existing inline fallback wording', () => {
    assert.equal(getTranscriptActionModeLabel('inline-fallback'), 'inline fallback');
    assert.equal(getTranscriptActionModeLabel('queue'), 'queue');
});
