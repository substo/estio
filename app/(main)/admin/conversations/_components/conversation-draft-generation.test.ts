import assert from 'node:assert/strict';
import test from 'node:test';

import { appendAiStreamText, selectAiStreamFinalText } from '@/lib/ai/stream-text';
import { generateDraftWithStreamingFallback, resolveDraftStreamTimeoutMs, selectComposerFinalDraftText, streamDraftViaApi } from './conversation-draft-generation';
import { resolveComposerDraftModelOverride } from './use-conversation-composer-ai-draft';

test('appendAiStreamText preserves exact streamed text chunks', () => {
    const chunks = ['Hi ', 'Tony', '.', '\n\n', 'New ', 'listing ', 'alert ', 'in ', 'Peyia', '.'];
    const text = chunks.reduce((buffer, chunk) => appendAiStreamText(buffer, chunk), '');

    assert.equal(text, 'Hi Tony.\n\nNew listing alert in Peyia.');
});

test('selectAiStreamFinalText keeps streamed paragraph spacing over flattened response text', () => {
    const streamed = 'Hi Tony,\n\nThis is the first paragraph.\n\nThis is the second paragraph.';
    const flattened = 'Hi Tony, This is the first paragraph. This is the second paragraph.';

    assert.equal(selectAiStreamFinalText(streamed, flattened), streamed);
    assert.equal(selectAiStreamFinalText('', flattened), flattened);
});

test('selectComposerFinalDraftText preserves streamed formatting when final text only collapses whitespace', () => {
    const streamed = 'Hi Tony,\n\nThis is the first paragraph.\n\nThis is the second paragraph.';
    const flattened = 'Hi Tony, This is the first paragraph. This is the second paragraph.';

    assert.equal(selectComposerFinalDraftText({ streamedText: streamed, finalText: flattened }), streamed);
    assert.equal(selectComposerFinalDraftText({ streamedText: streamed, finalText: 'Different final text.' }), 'Different final text.');
    assert.equal(selectComposerFinalDraftText({ streamedText: '', finalText: flattened }), flattened);
});

test('generate draft results preserve the backend truncation signal for composer safety', () => {
    const result = {
        draft: 'Partial response',
        truncated: true,
    } satisfies import('./conversation-draft-generation').GenerateDraftResult;

    assert.equal(result.truncated, true);
});

test('resolveDraftStreamTimeoutMs gives completion-chunk providers enough time', () => {
    assert.equal(resolveDraftStreamTimeoutMs('gemini-flash-latest'), 12_000);
    assert.equal(resolveDraftStreamTimeoutMs('chatgpt_subscription:gpt-5.5'), 45_000);
    assert.equal(resolveDraftStreamTimeoutMs('openai:gpt-4o-mini'), 45_000);
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

test('generateDraftWithStreamingFallback uses longer timeout for ChatGPT subscription streams', async () => {
    let observedTimeoutMs = 0;

    const result = await generateDraftWithStreamingFallback({
        conversationId: 'conv-1',
        contactId: 'contact-1',
        mode: 'chat',
        model: 'chatgpt_subscription:gpt-5.5',
        onChunk: () => {},
        streamDraft: async (args) => {
            observedTimeoutMs = args.timeoutMs || 0;
            return { draft: 'subscription draft' };
        },
        generateDraft: async () => ({ draft: 'fallback' }),
    });

    assert.equal(observedTimeoutMs, 45_000);
    assert.deepEqual(result, { draft: 'subscription draft' });
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

test('generateDraftWithStreamingFallback passes selected channel through stream and fallback paths', async () => {
    let sawStreamChannel = false;
    let sawFallbackChannel = false;

    const result = await generateDraftWithStreamingFallback({
        conversationId: 'conv-1',
        contactId: 'contact-1',
        instruction: 'Draft first outreach',
        mode: 'chat',
        channel: 'WhatsApp',
        onChunk: () => {},
        streamDraft: async (args) => {
            sawStreamChannel = args.channel === 'WhatsApp';
            return { reasoning: 'missing draft' };
        },
        generateDraft: async (_conversationId, _contactId, _instruction, _model, options) => {
            sawFallbackChannel = options?.channel === 'WhatsApp';
            return { draft: 'WhatsApp draft' };
        },
    });

    assert.equal(sawStreamChannel, true);
    assert.equal(sawFallbackChannel, true);
    assert.deepEqual(result, { draft: 'WhatsApp draft' });
});

test('streamDraftViaApi includes selected channel in request options', async () => {
    let requestBody: any = null;
    const response = new Response(
        `${JSON.stringify({ type: 'complete', result: { draft: 'stream draft' } })}\n`,
        { status: 200 }
    );
    const fetchImpl: typeof fetch = async (_url, init) => {
        requestBody = JSON.parse(String(init?.body || '{}'));
        return response;
    };

    const result = await streamDraftViaApi({
        conversationId: 'conv-1',
        contactId: 'contact-1',
        mode: 'chat',
        channel: 'WhatsApp',
    }, fetchImpl);

    assert.equal(requestBody.options.channel, 'WhatsApp');
    assert.deepEqual(result, { draft: 'stream draft' });
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

test('generateDraftWithStreamingFallback returns pending import result without invoking fallback', async () => {
    let fallbackCalls = 0;
    const blockedResult = {
        draft: null,
        blockedReason: 'property_import_pending' as const,
        pendingPropertyReferences: ['DT1234'],
    };

    const result = await generateDraftWithStreamingFallback({
        conversationId: 'conv-1',
        contactId: 'contact-1',
        mode: 'chat',
        onChunk: () => {},
        streamDraft: async () => blockedResult,
        generateDraft: async () => {
            fallbackCalls += 1;
            return { draft: 'fallback' };
        },
    });

    assert.equal(fallbackCalls, 0);
    assert.deepEqual(result, blockedResult);
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

test('streamDraftViaApi maps a pending property import response to a typed result', async () => {
    const result = await streamDraftViaApi(
        {
            conversationId: 'conv-1',
            contactId: 'contact-1',
            mode: 'chat',
        },
        async () => new Response(JSON.stringify({
            code: 'PROPERTY_IMPORT_PENDING',
            message: 'Property import is running.',
            pendingPropertyReferences: ['DT1234'],
        }), {
            status: 409,
            headers: { 'Content-Type': 'application/json' },
        })
    );

    assert.deepEqual(result, {
        draft: null,
        blockedReason: 'property_import_pending',
        pendingPropertyReferences: ['DT1234'],
        reasoning: 'Property import is running.',
    });
});

test('streamDraftViaApi sends the generate-anyway property import override', async () => {
    let requestBody: any = null;
    await streamDraftViaApi({
        conversationId: 'conv-1',
        contactId: 'contact-1',
        mode: 'chat',
        ignorePendingPropertyImport: true,
    }, async (_url, init) => {
        requestBody = JSON.parse(String(init?.body || '{}'));
        return new Response(`${JSON.stringify({ type: 'complete', result: { draft: 'draft' } })}\n`, { status: 200 });
    });

    assert.equal(requestBody.options.ignorePendingPropertyImport, true);
});

test('resolveComposerDraftModelOverride honors OpenAI defaults without freezing Gemini defaults', () => {
    assert.equal(resolveComposerDraftModelOverride('openai:gpt-4o-mini', false), 'openai:gpt-4o-mini');
    assert.equal(resolveComposerDraftModelOverride('chatgpt_subscription:gpt-5.4-mini', false), 'chatgpt_subscription:gpt-5.4-mini');
    assert.equal(resolveComposerDraftModelOverride('gemini-flash-latest', false), undefined);
    assert.equal(resolveComposerDraftModelOverride('gemini-flash-latest', true), 'gemini-flash-latest');
    assert.equal(resolveComposerDraftModelOverride('', true), undefined);
});
