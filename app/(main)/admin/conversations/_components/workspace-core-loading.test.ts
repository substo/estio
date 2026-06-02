import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConversationWorkspaceCore } from '@/lib/conversations/workspace-core-loading';

const metadata = {
    conversationHeader: { id: 'conv-1' },
    resolvedConversation: { id: 'conv-1' },
    freshness: {
        generatedAt: '2026-05-26T00:00:00.000Z',
        conversationUpdatedAt: null,
        latestMessageAt: null,
        latestMessageUpdatedAt: null,
        latestActivityAt: null,
        threadStale: false,
    },
} as any;

const location = {
    id: 'loc-1',
    ghlLocationId: 'ghl-loc-1',
} as any;

test('initial first-paint workspace core does not await transcript eligibility when activity is skipped', async () => {
    let eligibilityCalled = false;
    const neverResolves = new Promise<any>(() => {});

    const result = await Promise.race([
        loadConversationWorkspaceCore({
            traceId: 'trace-1',
            location,
            conversationId: 'conv-1',
            metadata,
            includeMessages: false,
            includeActivity: false,
            messageLimit: 8,
            activityLimit: 20,
            refreshMode: 'initial_hydration',
            messageMetadataMode: 'firstPaint',
            dependencies: {
                resolveTranscriptVisibilityAccess: async () => ({ restrictContent: false }),
                parseLegacyCrmLeadNotificationEmail: () => null,
                getTranscriptEligibility: async () => {
                    eligibilityCalled = true;
                    return neverResolves;
                },
            },
        }),
        new Promise<'timed-out'>((resolve) => setTimeout(() => resolve('timed-out'), 50)),
    ]);

    assert.notEqual(result, 'timed-out');
    assert.equal(eligibilityCalled, false);
    assert.equal((result as any).transcriptEligibilityDeferred, true);
    assert.deepEqual((result as any).transcriptEligibility, {
        success: true,
        enabled: false,
        reason: 'Deferred until workspace enrichment.',
    });
});

test('active first-paint workspace refresh does not await transcript eligibility', async () => {
    let eligibilityCalled = false;
    const neverResolves = new Promise<any>(() => {});

    const result = await Promise.race([
        loadConversationWorkspaceCore({
            traceId: 'trace-active',
            location,
            conversationId: 'conv-1',
            metadata,
            includeMessages: false,
            includeActivity: false,
            messageLimit: 50,
            activityLimit: 20,
            refreshMode: 'active_refresh',
            messageMetadataMode: 'firstPaint',
            dependencies: {
                resolveTranscriptVisibilityAccess: async () => ({ restrictContent: false }),
                parseLegacyCrmLeadNotificationEmail: () => null,
                getTranscriptEligibility: async () => {
                    eligibilityCalled = true;
                    return neverResolves;
                },
            },
        }),
        new Promise<'timed-out'>((resolve) => setTimeout(() => resolve('timed-out'), 50)),
    ]);

    assert.notEqual(result, 'timed-out');
    assert.equal(eligibilityCalled, false);
    assert.equal((result as any).transcriptEligibilityDeferred, true);
});

test('deferred activity workspace refresh does not await transcript eligibility', async () => {
    let eligibilityCalled = false;
    const neverResolves = new Promise<any>(() => {});

    const result = await loadConversationWorkspaceCore({
        traceId: 'trace-activity',
        location,
        conversationId: 'conv-1',
        metadata,
        includeMessages: false,
        includeActivity: true,
        messageLimit: 50,
        activityLimit: 20,
        refreshMode: 'deferred_activity',
        messageMetadataMode: 'full',
        dependencies: {
            resolveTranscriptVisibilityAccess: async () => ({ restrictContent: false }),
            parseLegacyCrmLeadNotificationEmail: () => null,
            getTranscriptEligibility: async () => {
                eligibilityCalled = true;
                return neverResolves;
            },
        },
    });

    assert.equal(eligibilityCalled, false);
    assert.equal((result as any).transcriptEligibilityDeferred, true);
});
