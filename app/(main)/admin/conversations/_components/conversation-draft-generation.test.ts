import assert from 'node:assert/strict';
import test from 'node:test';

import { generateDraftWithStreamingFallback, streamDraftViaApi } from './conversation-draft-generation';

test('generateDraftWithStreamingFallback uses stream result when chunks are supported', async () => {
    const chunks: string[] = [];
    let fallbackCalled = false;

    const result = await generateDraftWithStreamingFallback({
        conversationId: 'conv-1',
        contactId: 'contact-1',
        mode: 'chat',
        onChunk: (chunk) => chunks.push(chunk),
        streamDraft: async (args) => {
            args.onChunk?.('Hello');
            return { draft: 'Hello there', reasoning: 'streamed' };
        },
        generateDraft: async () => {
            fallbackCalled = true;
            return { draft: 'fallback' };
        },
    });

    assert.deepEqual(chunks, ['Hello']);
    assert.equal(fallbackCalled, false);
    assert.deepEqual(result, { draft: 'Hello there', reasoning: 'streamed' });
});

test('generateDraftWithStreamingFallback falls back when stream fails', async () => {
    let sawStreamError = false;

    const result = await generateDraftWithStreamingFallback({
        conversationId: 'conv-1',
        contactId: 'contact-1',
        instruction: 'short',
        model: 'fast',
        mode: 'deal',
        dealId: 'deal-1',
        draftLanguage: 'en',
        onChunk: () => {},
        streamDraft: async () => {
            throw new Error('stream unavailable');
        },
        generateDraft: async (conversationId, contactId, instruction, model, options) => {
            assert.equal(conversationId, 'conv-1');
            assert.equal(contactId, 'contact-1');
            assert.equal(instruction, 'short');
            assert.equal(model, 'fast');
            assert.deepEqual(options, { mode: 'deal', dealId: 'deal-1', draftLanguage: 'en' });
            return { draft: 'fallback draft', reasoning: 'fallback reasoning' };
        },
        onStreamError: () => {
            sawStreamError = true;
        },
    });

    assert.equal(sawStreamError, true);
    assert.deepEqual(result, { draft: 'fallback draft', reasoning: 'fallback reasoning' });
});

test('generateDraftWithStreamingFallback skips stream path without onChunk', async () => {
    let streamCalled = false;

    const result = await generateDraftWithStreamingFallback({
        conversationId: 'conv-1',
        contactId: 'contact-1',
        mode: 'chat',
        streamDraft: async () => {
            streamCalled = true;
            return { draft: 'stream' };
        },
        generateDraft: async () => ({ draft: 'server action' }),
    });

    assert.equal(streamCalled, false);
    assert.deepEqual(result, { draft: 'server action' });
});

test('streamDraftViaApi parses chunk lines and complete result', async () => {
    const encoder = new TextEncoder();
    const chunks: string[] = [];
    const body = new ReadableStream({
        start(controller) {
            controller.enqueue(encoder.encode('{"type":"chunk","text":"Hel"}\n'));
            controller.enqueue(encoder.encode('{"type":"chunk","text":"lo"}\n{"type":"complete","result":{"draft":"Hello","reasoning":"ok"}}\n'));
            controller.close();
        },
    });

    const result = await streamDraftViaApi(
        {
            conversationId: 'conv-1',
            contactId: 'contact-1',
            mode: 'chat',
            onChunk: (chunk) => chunks.push(chunk),
        },
        async () => new Response(body, { status: 200 })
    );

    assert.deepEqual(chunks, ['Hel', 'lo']);
    assert.deepEqual(result, { draft: 'Hello', reasoning: 'ok' });
});
