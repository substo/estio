import assert from 'node:assert/strict';
import test from 'node:test';

import type { Message } from '@/lib/ghl/conversations';
import type { RealtimeEventMergeState } from '@/lib/conversations/realtime-merge';
import { routeConversationRealtimeEnvelope } from './use-conversation-realtime-events';

function createHarness(overrides?: {
    viewMode?: 'chats' | 'deals';
    activeId?: string | null;
    activeDealId?: string | null;
    patchResult?: boolean;
    cachedSnapshot?: any | null;
}) {
    const calls: string[] = [];
    let messages: Message[] = [];
    let cachedSnapshot = overrides?.cachedSnapshot ?? null;
    const mergeState: RealtimeEventMergeState = {
        seenEventIds: new Set(),
        lastTsByConversationId: {},
    };

    const route = (event: any) => routeConversationRealtimeEnvelope({
        expectedLocationId: 'loc-1',
        rawData: JSON.stringify({ locationId: 'loc-1', ...event }),
        viewMode: overrides?.viewMode || 'chats',
        activeIdRef: { current: overrides?.activeId ?? 'conv-1' },
        activeDealIdRef: { current: overrides?.activeDealId ?? 'deal-1' },
        mergeState,
        setMessages: ((updater: any) => {
            messages = typeof updater === 'function' ? updater(messages) : updater;
        }) as any,
        runRealtimeRefresh: (conversationId?: string | null) => {
            calls.push(`refresh:${conversationId || ''}`);
        },
        refreshActiveDealWorkspace: async (dealId: string, options?: any) => {
            calls.push(`deal:${dealId}:${options?.reason}:${options?.take}:${options?.refreshSidebar}`);
            return null;
        },
        applyRealtimeMessagePatch: (conversationId, payload) => {
            calls.push(`patch:${conversationId}:${String(payload.messageId || '')}`);
            return overrides?.patchResult ?? false;
        },
        upsertActivityEntryInWorkspace: (conversationId, activityEntry) => {
            calls.push(`activity:${conversationId}:${activityEntry?.id || ''}`);
        },
        removeActivityEntryFromWorkspace: (conversationId, activityId) => {
            calls.push(`activity-delete:${conversationId}:${activityId || ''}`);
        },
        onScheduledMessagesChanged: (conversationId) => {
            calls.push(`scheduled:${conversationId || ''}`);
        },
        prefetchWorkspaceCore: async (conversationId: string) => {
            calls.push(`prefetch:${conversationId}`);
        },
        getCachedWorkspaceCoreSnapshot: () => cachedSnapshot,
        cacheWorkspaceCoreSnapshot: (_conversationId: string, snapshot: any) => {
            cachedSnapshot = snapshot;
            calls.push(`cache:${snapshot.messages?.length || 0}`);
        },
        workspaceCoreInFlightRef: { current: new Set<string>(['conv-2']) },
    });

    return {
        calls,
        get messages() {
            return messages;
        },
        get cachedSnapshot() {
            return cachedSnapshot;
        },
        route,
    };
}

test('foreign-location realtime envelopes are ignored before conversation routing', () => {
    const harness = createHarness();
    harness.route({
        id: 'evt-foreign',
        locationId: 'loc-2',
        type: 'message.inbound',
        conversationId: 'conv-1',
        ts: '2026-05-24T10:00:00.000Z',
        payload: { messageId: 'msg-foreign', body: 'foreign' },
    });

    assert.deepEqual(harness.calls, []);
    assert.equal(harness.messages.length, 0);
});

test('pure envelope router ignores duplicate events and applies unique out-of-order events', () => {
    const harness = createHarness();

    harness.route({
        id: 'evt-1',
        type: 'message.status',
        conversationId: 'conv-1',
        ts: '2026-05-24T10:00:00.000Z',
        payload: { messageId: 'msg-1' },
    });
    harness.route({
        id: 'evt-1',
        type: 'message.status',
        conversationId: 'conv-1',
        ts: '2026-05-24T10:00:01.000Z',
        payload: { messageId: 'msg-1' },
    });
    harness.route({
        id: 'evt-2',
        type: 'message.status',
        conversationId: 'conv-1',
        ts: '2026-05-24T09:59:59.000Z',
        payload: { messageId: 'msg-2' },
    });

    assert.deepEqual(harness.calls, [
        'patch:conv-1:msg-1',
        'refresh:conv-1',
        'patch:conv-1:msg-2',
        'refresh:conv-1',
    ]);
});

test('message.inbound appends after newer unique event for same conversation', () => {
    const harness = createHarness({
        activeId: 'conv-1',
        cachedSnapshot: { messages: [] },
    });

    harness.route({
        id: 'evt-status-newer',
        type: 'message.status',
        conversationId: 'conv-1',
        ts: '2026-05-24T10:00:01.000Z',
        payload: { messageId: 'msg-status' },
    });
    harness.route({
        id: 'evt-inbound-older',
        type: 'message.inbound',
        conversationId: 'conv-1',
        ts: '2026-05-24T10:00:00.000Z',
        payload: {
            messageId: 'msg-in-older',
            wamId: 'wam-in-older',
            body: 'arrived after status event',
            createdAt: '2026-05-24T10:00:00.000Z',
        },
    });

    assert.equal(harness.messages.length, 1);
    assert.equal(harness.messages[0].id, 'msg-in-older');
    assert.deepEqual(harness.calls, [
        'patch:conv-1:msg-status',
        'refresh:conv-1',
        'cache:1',
        'refresh:conv-1',
    ]);
});

test('message.status patch success avoids refresh', () => {
    const harness = createHarness({ patchResult: true });

    harness.route({
        id: 'evt-status',
        type: 'message.status',
        conversationId: 'conv-1',
        ts: '2026-05-24T10:00:00.000Z',
        payload: { messageId: 'msg-1' },
    });

    assert.deepEqual(harness.calls, ['patch:conv-1:msg-1']);
});

test('message.status patch miss triggers refresh', () => {
    const harness = createHarness({ patchResult: false });

    harness.route({
        id: 'evt-status-miss',
        type: 'message.status',
        conversationId: 'conv-1',
        ts: '2026-05-24T10:00:00.000Z',
        payload: { messageId: 'msg-1' },
    });

    assert.deepEqual(harness.calls, ['patch:conv-1:msg-1', 'refresh:conv-1']);
});

test('scheduled message event refreshes active scheduled state and timeline', () => {
    const harness = createHarness();

    harness.route({
        id: 'evt-scheduled-sent',
        type: 'scheduled_message.sent',
        conversationId: 'conv-1',
        ts: '2026-05-24T10:00:00.000Z',
        payload: { scheduledMessageId: 'sched-1' },
    });

    assert.deepEqual(harness.calls, ['scheduled:conv-1', 'refresh:conv-1']);
});

test('activity.created with entry upserts without refresh', () => {
    const harness = createHarness();

    harness.route({
        id: 'evt-activity',
        type: 'activity.created',
        conversationId: 'conv-1',
        ts: '2026-05-24T10:00:00.000Z',
        payload: { activityEntry: { id: 'act-1', type: 'note' } },
    });

    assert.deepEqual(harness.calls, ['activity:conv-1:act-1']);
});

test('activity.updated with entry upserts without refresh', () => {
    const harness = createHarness();

    harness.route({
        id: 'evt-activity-updated',
        type: 'activity.updated',
        conversationId: 'conv-1',
        ts: '2026-05-24T10:00:00.000Z',
        payload: { activityEntry: { id: 'act-1', type: 'note', changes: { entry: 'Updated' } } },
    });

    assert.deepEqual(harness.calls, ['activity:conv-1:act-1']);
});

test('activity.deleted removes without refresh', () => {
    const harness = createHarness();

    harness.route({
        id: 'evt-activity-deleted',
        type: 'activity.deleted',
        conversationId: 'conv-1',
        ts: '2026-05-24T10:00:00.000Z',
        payload: { activityId: 'act-1' },
    });

    assert.deepEqual(harness.calls, ['activity-delete:conv-1:act-1']);
});

test('message.inbound active conversation appends and refreshes', () => {
    const harness = createHarness({
        activeId: 'conv-1',
        cachedSnapshot: { messages: [] },
    });

    harness.route({
        id: 'evt-inbound',
        type: 'message.inbound',
        conversationId: 'conv-1',
        ts: '2026-05-24T10:00:00.000Z',
        payload: {
            messageId: 'msg-in-1',
            wamId: 'wam-1',
            body: 'hello',
            createdAt: '2026-05-24T10:00:00.000Z',
        },
    });

    assert.equal(harness.messages.length, 1);
    assert.equal(harness.messages[0].id, 'msg-in-1');
    assert.equal(harness.messages[0].conversationId, 'conv-1');
    assert.equal((harness.cachedSnapshot as any).messages.length, 1);
    assert.deepEqual(harness.calls, ['cache:1', 'refresh:conv-1']);
});

test('message.inbound active conversation appends with provider id when local message id is absent', () => {
    const harness = createHarness({
        activeId: 'conv-1',
        cachedSnapshot: { messages: [] },
    });

    harness.route({
        id: 'evt-inbound-provider-only',
        type: 'message.inbound',
        conversationId: 'conv-1',
        ts: '2026-05-24T10:00:00.000Z',
        payload: {
            providerMessageId: 'wam-provider-only-1',
            body: 'hello from whatsapp',
            createdAt: '2026-05-24T10:00:00.000Z',
        },
    });

    assert.equal(harness.messages.length, 1);
    assert.equal(harness.messages[0].id, 'wam-provider-only-1');
    assert.equal((harness.messages[0] as any).wamId, 'wam-provider-only-1');
    assert.equal(harness.messages[0].conversationId, 'conv-1');
    assert.equal((harness.cachedSnapshot as any).messages.length, 1);
    assert.deepEqual(harness.calls, ['cache:1', 'refresh:conv-1']);
});

test('deal.update active deal refreshes', () => {
    const harness = createHarness({
        viewMode: 'deals',
        activeDealId: 'deal-1',
    });

    harness.route({
        id: 'evt-deal',
        type: 'deal.update',
        conversationId: 'conv-1',
        ts: '2026-05-24T10:00:00.000Z',
        payload: { dealId: 'deal-1' },
    });

    assert.deepEqual(harness.calls, ['deal:deal-1:realtime:50:true']);
});
