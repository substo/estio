import assert from 'node:assert/strict';
import test from 'node:test';

import { appendAiStreamText, selectAiStreamFinalText } from '@/lib/ai/stream-text';
import {
    getDraftOutputLengthInstruction,
    normalizeDraftOutputLength,
    resolveDraftOutputTokenBudget,
} from '@/lib/ai/draft-output-length';
import { LOCATION_AI_ORDER, requestComposerDraft, resolveComposerDraftModelOverride, resolveDraftStreamTimeoutMs, selectComposerFinalDraftText, streamDraftViaApi } from './conversation-draft-generation';

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

test('draft output length preferences are normalized and bounded server-side', () => {
    assert.equal(normalizeDraftOutputLength('LONG'), 'long');
    assert.equal(normalizeDraftOutputLength('untrusted-value'), 'auto');
    assert.equal(resolveDraftOutputTokenBudget({
        preference: 'auto',
        isEmail: false,
        modelMaxOutputTokens: 65_536,
    }), 4_096);
    assert.equal(resolveDraftOutputTokenBudget({
        preference: 'long',
        isEmail: true,
        modelMaxOutputTokens: 8_000,
    }), 8_000);
    assert.equal(resolveDraftOutputTokenBudget({
        preference: 'auto',
        isEmail: false,
        modelMaxOutputTokens: Number.NaN,
    }), 4_096);
});

test('draft output budgets preserve send-ready text without allowing unbounded requests', () => {
    assert.equal(resolveDraftOutputTokenBudget({
        preference: 'short',
        isEmail: false,
        modelMaxOutputTokens: 65_536,
        preservedText: 'x'.repeat(30_000),
    }), 10_512);
    assert.equal(resolveDraftOutputTokenBudget({
        preference: 'long',
        isEmail: true,
        modelMaxOutputTokens: 65_536,
        preservedText: 'x'.repeat(60_000),
    }), 16_384);
    assert.match(getDraftOutputLengthInstruction('short', false), /brief and direct/i);
});

test('resolveDraftStreamTimeoutMs gives completion-chunk providers enough time', () => {
    assert.equal(resolveDraftStreamTimeoutMs('gemini-flash-latest'), 35_000);
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

test('requestComposerDraft uses stream result when chunks are supported', async () => {
    const chunks: string[] = [];
    let fallbackCalled = false;

    const result = await requestComposerDraft({
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

test('requestComposerDraft uses longer timeout for ChatGPT subscription streams', async () => {
    let observedTimeoutMs = 0;

    const result = await requestComposerDraft({
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

test('requestComposerDraft preserves refinement and channel in both request paths', async () => {
    const baseDraft = 'This is the current draft.';
    const channel = 'WhatsApp' as const;
    const request = {
        conversationId: 'conv-1',
        contactId: 'contact-1',
        instruction: 'Make it shorter',
        baseDraft,
        mode: 'chat' as const,
        channel,
    };

    const streamed = await requestComposerDraft({
        ...request,
        onChunk: () => {},
        streamDraft: async (args) => {
            assert.equal(args.baseDraft, baseDraft);
            assert.equal(args.channel, channel);
            return { draft: 'Streamed draft' };
        },
        generateDraft: async () => assert.fail('Should only submit one request'),
    });
    const direct = await requestComposerDraft({
        ...request,
        generateDraft: async (_conversationId, _contactId, _instruction, _model, options) => {
            assert.equal(options?.baseDraft, baseDraft);
            assert.equal(options?.channel, channel);
            return { draft: 'Direct draft' };
        },
    });

    assert.equal(streamed.draft, 'Streamed draft');
    assert.equal(direct.draft, 'Direct draft');
});

test('streamDraftViaApi includes selected channel and output length in request options', async () => {
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
        outputLength: 'long',
    }, fetchImpl);

    assert.equal(requestBody.options.channel, 'WhatsApp');
    assert.equal(requestBody.options.outputLength, 'long');
    assert.deepEqual(result, { draft: 'stream draft' });
});

for (const failure of [
    { name: 'transport error', attempt: async () => { throw new Error('stream unavailable'); }, expected: /stream unavailable/ },
    { name: 'timeout', attempt: async () => new Promise<never>(() => {}), expected: /timed out/ },
    { name: 'missing final draft', attempt: async () => null, expected: /before a complete draft/ },
]) {
    test(`requestComposerDraft does not submit another request after ${failure.name}`, async () => {
        let directCalls = 0;
        await assert.rejects(requestComposerDraft({
            conversationId: 'conv-1',
            contactId: 'contact-1',
            mode: 'chat',
            streamTimeoutMs: 10,
            onChunk: () => {},
            streamDraft: failure.attempt,
            generateDraft: async () => {
                directCalls += 1;
                return { draft: 'Duplicate draft' };
            },
        }), failure.expected);
        assert.equal(directCalls, 0);
    });
}

test('requestComposerDraft returns pending import result without invoking fallback', async () => {
    let fallbackCalls = 0;
    const blockedResult = {
        draft: null,
        blockedReason: 'property_import_pending' as const,
        pendingPropertyReferences: ['DT1234'],
    };

    const result = await requestComposerDraft({
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

test('requestComposerDraft skips stream path without onChunk', async () => {
    let streamCalled = false;

    const result = await requestComposerDraft({
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

test('streamDraftViaApi resets partial text before a transparent truncation retry', async () => {
    const encoder = new TextEncoder();
    const events: Array<{ chunk: string; reset: boolean }> = [];
    const body = new ReadableStream({
        start(controller) {
            controller.enqueue(encoder.encode('{"type":"chunk","text":"Partial"}\n'));
            controller.enqueue(encoder.encode('{"type":"reset","reason":"truncation_retry"}\n'));
            controller.enqueue(encoder.encode('{"type":"chunk","text":"Complete"}\n'));
            controller.enqueue(encoder.encode('{"type":"complete","result":{"draft":"Complete"}}\n'));
            controller.close();
        },
    });

    const result = await streamDraftViaApi({
        conversationId: 'conv-1',
        contactId: 'contact-1',
        mode: 'chat',
        onChunk: (chunk, event) => events.push({ chunk, reset: event?.reset === true }),
    }, async () => new Response(body, { status: 200 }));

    assert.deepEqual(events, [
        { chunk: 'Partial', reset: false },
        { chunk: '', reset: true },
        { chunk: 'Complete', reset: false },
    ]);
    assert.deepEqual(result, { draft: 'Complete' });
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

test('resolveComposerDraftModelOverride leaves model selection to the Location order by default', () => {
    assert.equal(resolveComposerDraftModelOverride(LOCATION_AI_ORDER), undefined);
    assert.equal(resolveComposerDraftModelOverride(''), undefined);
    assert.equal(resolveComposerDraftModelOverride('openai:gpt-4o-mini'), 'openai:gpt-4o-mini');
    assert.equal(resolveComposerDraftModelOverride('chatgpt_subscription:gpt-5.4-mini'), 'chatgpt_subscription:gpt-5.4-mini');
    assert.equal(resolveComposerDraftModelOverride('gemini-flash-latest'), 'gemini-flash-latest');
});
