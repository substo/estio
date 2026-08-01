import {
    fetchPublicHttpResponse,
    PropertyUrlFetchError,
} from '@/lib/conversations/property-url-context';

export const FEED_FETCH_MAX_BYTES = 20 * 1024 * 1024;
export const FEED_FETCH_TIMEOUT_MS = 30_000;
export const FEED_FETCH_MAX_REDIRECTS = 5;

type PublicHttpFetcher = typeof fetchPublicHttpResponse;

export class SafeFeedFetchError extends Error {
    constructor(public readonly code: string) {
        super('Feed source could not be fetched');
        this.name = 'SafeFeedFetchError';
    }
}

async function readTextWithLimit(response: Response, maxBytes: number): Promise<string> {
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        throw new SafeFeedFetchError('response_too_large');
    }
    if (!response.body) return '';

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let totalBytes = 0;
    let output = '';

    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
            await reader.cancel().catch(() => undefined);
            throw new SafeFeedFetchError('response_too_large');
        }
        output += decoder.decode(value, { stream: true });
    }

    return output + decoder.decode();
}

export function createSafeFeedTextFetcher(dependencies: {
    fetchPublicResponse?: PublicHttpFetcher;
    timeoutMs?: number;
    maxBytes?: number;
    maxRedirects?: number;
} = {}) {
    const fetchPublicResponse = dependencies.fetchPublicResponse || fetchPublicHttpResponse;
    const timeoutMs = dependencies.timeoutMs ?? FEED_FETCH_TIMEOUT_MS;
    const maxBytes = dependencies.maxBytes ?? FEED_FETCH_MAX_BYTES;
    const maxRedirects = dependencies.maxRedirects ?? FEED_FETCH_MAX_REDIRECTS;

    return async function fetchSafeFeedText(rawUrl: string): Promise<string> {
        try {
            const { response } = await fetchPublicResponse(rawUrl, {
                timeoutMs,
                maxRedirects,
                maxResponseBytes: maxBytes,
                accept: 'application/xml,text/xml,application/rss+xml,text/plain;q=0.9,*/*;q=0.5',
            });
            if (!response.ok) throw new SafeFeedFetchError('http_error');
            return await readTextWithLimit(response, maxBytes);
        } catch (error) {
            if (error instanceof SafeFeedFetchError) throw error;
            if (error instanceof PropertyUrlFetchError) throw new SafeFeedFetchError(error.code);
            throw new SafeFeedFetchError('request_failed');
        }
    };
}

export const fetchSafeFeedText = createSafeFeedTextFetcher();
