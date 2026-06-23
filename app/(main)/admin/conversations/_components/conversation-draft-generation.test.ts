import assert from 'node:assert/strict';
import test from 'node:test';

import { appendAiStreamText } from '@/lib/ai/stream-text';
import { generateDraftWithStreamingFallback, streamDraftViaApi } from './conversation-draft-generation';

test('appendAiStreamText preserves exact streamed text chunks', () => {
    const chunks = ['Hi ', 'Tony', '.', '\n\n', 'New ', 'listing ', 'alert ', 'in ', 'Peyia', '.'];
    const text = chunks.reduce((buffer, chunk) => appendAiStreamText(buffer, chunk), '');

    assert.equal(text, 'Hi Tony.\n\nNew listing alert in Peyia.');
});

test('appendAiStreamText does not insert spaces inside streamed subword chunks', () => {
    assert.equal(appendAiStreamText('An', 'tonia'), 'Antonia');
    assert.equal(appendAiStreamText('DT49', '98'), 'DT4998');
    assert.equal(appendAiStreamText('sprzed', 'ających'), 'sprzedających');
    assert.equal(appendAiStreamText('realiz', 'ację'), 'realizację');
});

test('appendAiStreamText preserves intentional joins for punctuation, currency, hyphens, and URLs', () => {
    assert.equal(appendAiStreamText('Asking €', '149,000'), 'Asking €149,000');
    assert.equal(appendAiStreamText('1', '-bed'), '1-bed');
    assert.equal(appendAiStreamText('fully-', 'renovated'), 'fully-renovated');
    assert.equal(
        appendAiStreamText('https://www.downtowncyprus.com/properties/ref-', 'dt4930'),
        'https://www.downtowncyprus.com/properties/ref-dt4930'
    );
});

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
    let fallbackCalls = 0;

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
            fallbackCalls += 1;
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
    assert.equal(fallbackCalls, 1);
    assert.deepEqual(result, { draft: 'fallback draft', reasoning: 'fallback reasoning' });
});

test('generateDraftWithStreamingFallback passes base draft through stream and fallback paths', async () => {
    let sawStreamBaseDraft = false;
    let sawFallbackBaseDraft = false;

    const result = await generateDraftWithStreamingFallback({
        conversationId: 'conv-1',
        contactId: 'contact-1',
        instruction: 'Make it shorter',
        baseDraft: 'This is the current draft that needs refinement.',
        mode: 'chat',
        onChunk: () => {},
        streamDraft: async (args) => {
            sawStreamBaseDraft = args.baseDraft === 'This is the current draft that needs refinement.';
            return { reasoning: 'missing draft' };
        },
        generateDraft: async (_conversationId, _contactId, _instruction, _model, options) => {
            sawFallbackBaseDraft = options?.baseDraft === 'This is the current draft that needs refinement.';
            return { draft: 'Shorter draft' };
        },
    });

    assert.equal(sawStreamBaseDraft, true);
    assert.equal(sawFallbackBaseDraft, true);
    assert.deepEqual(result, { draft: 'Shorter draft' });
});

test('generateDraftWithStreamingFallback times out stream before direct fallback', async () => {
    let sawStreamError = false;
    let fallbackCalls = 0;

    const result = await generateDraftWithStreamingFallback({
        conversationId: 'conv-1',
        contactId: 'contact-1',
        mode: 'chat',
        streamTimeoutMs: 5,
        onChunk: () => {},
        streamDraft: async () => new Promise(() => {}),
        generateDraft: async () => {
            fallbackCalls += 1;
            return { draft: 'fallback after timeout' };
        },
        onStreamError: (error) => {
            sawStreamError = error instanceof Error && error.message.includes('timed out');
        },
    });

    assert.equal(sawStreamError, true);
    assert.equal(fallbackCalls, 1);
    assert.deepEqual(result, { draft: 'fallback after timeout' });
});

test('generateDraftWithStreamingFallback falls back when stream completes without final draft', async () => {
    let fallbackCalls = 0;

    const result = await generateDraftWithStreamingFallback({
        conversationId: 'conv-1',
        contactId: 'contact-1',
        mode: 'chat',
        onChunk: () => {},
        streamDraft: async () => ({ reasoning: 'no draft' }),
        generateDraft: async () => {
            fallbackCalls += 1;
            return { draft: 'fallback for missing final' };
        },
    });

    assert.equal(fallbackCalls, 1);
    assert.deepEqual(result, { draft: 'fallback for missing final' });
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
            baseDraft: 'Current draft',
            onChunk: (chunk) => chunks.push(chunk),
        },
        async (_url, init) => {
            assert.equal(JSON.parse(String(init?.body)).baseDraft, 'Current draft');
            return new Response(body, { status: 200 });
        }
    );

    assert.deepEqual(chunks, ['Hel', 'lo']);
    assert.deepEqual(result, { draft: 'Hello', reasoning: 'ok' });
});
