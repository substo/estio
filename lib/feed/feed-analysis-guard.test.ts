import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createFeedAnalysisGuard,
    FeedAnalysisGuardStore,
    FeedAnalysisGuardUnavailableError,
    FeedAnalysisInProgressError,
    FeedAnalysisRateLimitError,
} from './feed-analysis-guard';

function createStore(overrides: Partial<FeedAnalysisGuardStore> = {}): FeedAnalysisGuardStore {
    return {
        acquireLock: async () => ({ acquired: true }),
        releaseLock: async () => true,
        consume: async () => ({ allowed: true }),
        ...overrides,
    };
}

test('identical in-process analyses share one guarded execution', async () => {
    let releaseExecution!: () => void;
    const executionGate = new Promise<void>((resolve) => { releaseExecution = resolve; });
    let lockCalls = 0;
    let executions = 0;
    const store = createStore({
        acquireLock: async () => {
            lockCalls += 1;
            return { acquired: true };
        },
    });
    const guard = createFeedAnalysisGuard({ getStore: async () => store });
    const args = {
        locationId: 'location-a',
        companyId: 'company-a',
        url: 'https://example.com/feed.xml#ignored',
        execute: async () => {
            executions += 1;
            await executionGate;
            return { mapping: 'result' };
        },
    };

    const first = guard.run(args);
    const duplicate = guard.run({ ...args, url: 'https://example.com/feed.xml' });
    releaseExecution();

    assert.deepEqual(await first, { mapping: 'result' });
    assert.deepEqual(await duplicate, { mapping: 'result' });
    assert.equal(lockCalls, 1);
    assert.equal(executions, 1);
});

test('rate limits are scoped to the location and prevent execution', async () => {
    let receivedWindows: Array<{ key: string; limit: number; windowMs: number }> = [];
    let executions = 0;
    const store = createStore({
        consume: async ({ windows }) => {
            receivedWindows = windows;
            return { allowed: false, windowIndex: 0, retryAfterMs: 12_001 };
        },
    });
    const guard = createFeedAnalysisGuard({ getStore: async () => store });

    await assert.rejects(
        guard.run({
            locationId: 'location-a',
            companyId: 'company-a',
            url: 'https://example.com/feed.xml',
            execute: async () => { executions += 1; },
        }),
        (error: unknown) => error instanceof FeedAnalysisRateLimitError
            && error.retryAfterSeconds === 13,
    );
    assert.equal(executions, 0);
    assert.deepEqual(receivedWindows.map(({ limit, windowMs }) => ({ limit, windowMs })), [
        { limit: 5, windowMs: 60_000 },
        { limit: 30, windowMs: 3_600_000 },
    ]);
    assert.ok(receivedWindows.every((window) => !window.key.includes('company-a')));
});

test('a distributed duplicate returns a retryable in-progress error', async () => {
    const store = createStore({
        acquireLock: async () => ({ acquired: false, retryAfterMs: 4_001 }),
    });
    const guard = createFeedAnalysisGuard({ getStore: async () => store });

    await assert.rejects(
        guard.run({
            locationId: 'location-a',
            companyId: 'company-a',
            url: 'https://example.com/feed.xml',
            execute: async () => 'unreachable',
        }),
        (error: unknown) => error instanceof FeedAnalysisInProgressError
            && error.retryAfterSeconds === 5,
    );
});

test('guard storage failures fail closed without running analysis', async () => {
    let executed = false;
    const guard = createFeedAnalysisGuard({
        getStore: async () => { throw new Error('redis connection details'); },
    });

    await assert.rejects(
        guard.run({
            locationId: 'location-a',
            companyId: 'company-a',
            url: 'https://example.com/feed.xml',
            execute: async () => { executed = true; },
        }),
        FeedAnalysisGuardUnavailableError,
    );
    assert.equal(executed, false);
});
