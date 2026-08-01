import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createSafeFeedTextFetcher,
    fetchSafeFeedText,
    SafeFeedFetchError,
} from './safe-feed-fetch';
import {
    analyzeFeedRequestSchema,
    feedMappingConfigSchema,
    feedUrlSchema,
    previewFeedRequestSchema,
} from './feed-route-schemas';

async function expectCode(promise: Promise<unknown>, code: string) {
    await assert.rejects(promise, (error: unknown) => (
        error instanceof SafeFeedFetchError && error.code === code
    ));
}

test('rejects literal private feed destinations before making a request', async () => {
    await expectCode(fetchSafeFeedText('http://127.0.0.1/feed.xml'), 'unsafe_url');
    await expectCode(fetchSafeFeedText('http://169.254.169.254/latest/meta-data'), 'unsafe_url');
});

test('passes feed-specific safety limits to the pinned public fetcher', async () => {
    let receivedOptions: Record<string, unknown> | undefined;
    const fetchFeed = createSafeFeedTextFetcher({
        timeoutMs: 123,
        maxBytes: 456,
        maxRedirects: 2,
        fetchPublicResponse: async (_url, options) => {
            receivedOptions = options;
            return { response: new Response('<feed />'), finalUrl: 'https://example.com/feed.xml' };
        },
    });

    assert.equal(await fetchFeed('https://example.com/feed.xml'), '<feed />');
    assert.deepEqual(receivedOptions, {
        timeoutMs: 123,
        maxRedirects: 2,
        maxResponseBytes: 456,
        accept: 'application/xml,text/xml,application/rss+xml,text/plain;q=0.9,*/*;q=0.5',
    });
});

test('rejects declared and streamed feed bodies over the byte limit', async () => {
    const declared = createSafeFeedTextFetcher({
        maxBytes: 4,
        fetchPublicResponse: async () => ({
            response: new Response('tiny', { headers: { 'content-length': '5' } }),
            finalUrl: 'https://example.com/feed.xml',
        }),
    });
    await expectCode(declared('https://example.com/feed.xml'), 'response_too_large');

    const streamed = createSafeFeedTextFetcher({
        maxBytes: 4,
        fetchPublicResponse: async () => ({
            response: new Response(new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.enqueue(new TextEncoder().encode('123'));
                    controller.enqueue(new TextEncoder().encode('45'));
                    controller.close();
                },
            })),
            finalUrl: 'https://example.com/feed.xml',
        }),
    });
    await expectCode(streamed('https://example.com/feed.xml'), 'response_too_large');
});

test('normalizes HTTP and transport failures without exposing remote details', async () => {
    const httpFailure = createSafeFeedTextFetcher({
        fetchPublicResponse: async () => ({
            response: new Response('secret upstream error', { status: 502 }),
            finalUrl: 'https://example.com/feed.xml',
        }),
    });
    await expectCode(httpFailure('https://example.com/feed.xml'), 'http_error');

    const transportFailure = createSafeFeedTextFetcher({
        fetchPublicResponse: async () => { throw new Error('socket details'); },
    });
    await expectCode(transportFailure('https://example.com/feed.xml'), 'request_failed');
});

test('feed analyze and preview request schemas require bounded company-scoped input', () => {
    assert.equal(analyzeFeedRequestSchema.safeParse({
        url: 'https://example.com/feed.xml',
        companyId: 'company-a',
    }).success, true);
    assert.equal(analyzeFeedRequestSchema.safeParse({
        url: 'https://example.com/feed.xml',
    }).success, false);
    assert.equal(previewFeedRequestSchema.safeParse({
        url: 'https://example.com/feed.xml',
        companyId: 'company-a',
        mappingConfig: {
            rootPath: 'listings.listing',
            fields: {
                externalId: 'id', title: 'title', description: 'description',
                price: 'price', currency: 'currency', images: 'images.image',
            },
        },
    }).success, true);
    assert.equal(previewFeedRequestSchema.safeParse({
        url: 'https://example.com/feed.xml',
        companyId: 'company-a',
        mappingConfig: { fields: {} },
    }).success, false);
});

test('feed URLs are canonical standard HTTP URLs and mapping configs are structurally validated', () => {
    assert.equal(
        feedUrlSchema.parse(' HTTPS://Example.COM:443/feed.xml#section '),
        'https://example.com/feed.xml',
    );
    assert.equal(feedUrlSchema.safeParse('not-a-url').success, false);
    assert.equal(feedUrlSchema.safeParse('ftp://example.com/feed.xml').success, false);
    assert.equal(feedUrlSchema.safeParse('https://user:secret@example.com/feed.xml').success, false);

    assert.equal(feedMappingConfigSchema.safeParse({
        rootPath: 'listings.listing',
        fields: {
            externalId: 'id',
            title: 'title',
            description: 'description',
            price: 'price',
            currency: 'currency',
            images: 'images.image',
        },
    }).success, true);
    assert.equal(feedMappingConfigSchema.safeParse({
        rootPath: 'listings.listing',
        fields: { externalId: 'id', title: 'title' },
    }).success, false);
});
