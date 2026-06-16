import assert from 'node:assert/strict';
import test from 'node:test';

import type { Conversation } from '@/lib/ghl/conversations';
import type { WorkspaceCoreSnapshot } from '@/lib/conversations/workspace-state';
import {
    buildContactContextShell,
    hasFullContactContext,
    isShellContactContext,
    mergeActivityTimelineEntries,
    patchWorkspaceCoreSnapshotActivityEntry,
    removeActivityTimelineEntry,
    removeWorkspaceCoreSnapshotActivityEntry,
    type ActivityTimelineItem,
} from './conversation-workspace-ui-actions';

test('buildContactContextShell returns null when the conversation has no contact id', () => {
    assert.equal(buildContactContextShell({ id: 'conv-1' } as Conversation, 'loc-1'), null);
    assert.equal(buildContactContextShell(null, 'loc-1'), null);
});

test('buildContactContextShell preserves the sidebar shell shape and defaults', () => {
    const shell = buildContactContextShell({
        id: 'conv-1',
        contactId: 'contact-1',
        contactEmail: 'lead@example.com',
        contactPhone: '+35799999999',
        contactPreferredLanguage: 'el',
    } as Conversation, 'loc-1');

    assert.deepEqual(shell, {
        contact: {
            id: 'contact-1',
            name: 'Unknown Contact',
            email: 'lead@example.com',
            phone: '+35799999999',
            preferredLang: 'el',
            locationId: 'loc-1',
            contactType: null,
            propertyRoles: [],
            companyRoles: [],
            viewings: [],
            interestedProperties: [],
            inspectedProperties: [],
            propertiesInterested: [],
            propertiesInspected: [],
            propertiesEmailed: [],
            propertiesMatched: [],
        },
        leadSources: [],
        shell: true,
    });
});

test('contact context helpers distinguish shells from full editable contexts', () => {
    const shell = buildContactContextShell({
        id: 'conv-1',
        contactId: 'contact-1',
        contactName: 'Shell Lead',
    } as Conversation, 'loc-1');

    assert.equal(isShellContactContext(shell), true);
    assert.equal(hasFullContactContext(shell), false);

    const fullContext = {
        contact: { id: 'contact-1', name: 'Full Lead' },
        leadSources: ['Website'],
    };

    assert.equal(isShellContactContext(fullContext), false);
    assert.equal(hasFullContactContext(fullContext), true);
    assert.equal(hasFullContactContext(null), false);
});

test('mergeActivityTimelineEntries appends new entries and sorts by createdAt', () => {
    const current = [
        activityEntry('later', '2026-01-02T00:00:00.000Z'),
    ];

    const merged = mergeActivityTimelineEntries(
        current,
        activityEntry('earlier', '2026-01-01T00:00:00.000Z')
    );

    assert.deepEqual(merged.map((entry) => entry.id), ['earlier', 'later']);
    assert.equal(current.length, 1);
});

test('mergeActivityTimelineEntries replaces existing entries by id with a shallow merge', () => {
    const merged = mergeActivityTimelineEntries(
        [
            {
                ...activityEntry('entry-1', '2026-01-01T00:00:00.000Z'),
                action: 'created',
                changes: { previous: true },
                user: { name: 'Original', email: 'original@example.com' },
            },
        ],
        {
            ...activityEntry('entry-1', '2026-01-02T00:00:00.000Z'),
            changes: { next: true },
        }
    );

    assert.equal(merged.length, 1);
    assert.deepEqual(merged[0], {
        id: 'entry-1',
        type: 'activity',
        createdAt: '2026-01-02T00:00:00.000Z',
        action: 'updated',
        changes: { next: true },
        user: { name: 'Original', email: 'original@example.com' },
    });
});

test('mergeActivityTimelineEntries reconciles optimistic entries by clientMutationId', () => {
    const merged = mergeActivityTimelineEntries(
        [
            {
                ...activityEntry('activity:pending:mutation-1', '2026-01-01T00:00:00.000Z'),
                changes: { entry: 'Pending note' },
                user: { name: 'You', email: null },
                clientMutationId: 'mutation-1',
                pending: true,
            },
        ],
        {
            ...activityEntry('history:entry-1', '2026-01-01T00:00:01.000Z'),
            changes: { entry: 'Saved note' },
            user: { name: 'Agent', email: 'agent@example.com' },
            clientMutationId: 'mutation-1',
            pending: false,
        }
    );

    assert.equal(merged.length, 1);
    assert.deepEqual(merged[0], {
        id: 'history:entry-1',
        type: 'activity',
        createdAt: '2026-01-01T00:00:01.000Z',
        action: 'updated',
        changes: { entry: 'Saved note' },
        user: { name: 'Agent', email: 'agent@example.com' },
        clientMutationId: 'mutation-1',
        pending: false,
    });
});

test('mergeActivityTimelineEntries sorts matching timestamps by id', () => {
    const merged = mergeActivityTimelineEntries(
        [
            activityEntry('entry-b', '2026-01-01T00:00:00.000Z'),
            activityEntry('entry-c', '2026-01-01T00:00:00.000Z'),
        ],
        activityEntry('entry-a', '2026-01-01T00:00:00.000Z')
    );

    assert.deepEqual(merged.map((entry) => entry.id), ['entry-a', 'entry-b', 'entry-c']);
});

test('mergeActivityTimelineEntries tolerates non-array current entries', () => {
    const merged = mergeActivityTimelineEntries(
        null as unknown as ActivityTimelineItem[],
        activityEntry('entry-1', '2026-01-01T00:00:00.000Z')
    );

    assert.deepEqual(merged.map((entry) => entry.id), ['entry-1']);
});

test('patchWorkspaceCoreSnapshotActivityEntry copies the snapshot and patches only activityTimeline', () => {
    const header = { id: 'conv-1', contactName: 'Lead' } as Conversation;
    const messages = [{ id: 'msg-1', body: 'Hello' }] as any[];
    const hydration = {
        status: 'full' as const,
        oldestCursor: 'old',
        newestCursor: 'new',
        initialCount: 1,
        targetCount: 50,
        requestedLimit: 20,
    };
    const snapshot: WorkspaceCoreSnapshot = {
        conversationHeader: header,
        messages,
        activityTimeline: [activityEntry('entry-b', '2026-01-02T00:00:00.000Z')],
        transcriptOnDemandEnabled: true,
        hydration,
    };

    const patched = patchWorkspaceCoreSnapshotActivityEntry(
        snapshot,
        activityEntry('entry-a', '2026-01-01T00:00:00.000Z')
    );

    assert.notEqual(patched, snapshot);
    assert.equal(patched.conversationHeader, header);
    assert.equal(patched.messages, messages);
    assert.equal(patched.hydration, hydration);
    assert.equal(patched.transcriptOnDemandEnabled, true);
    assert.deepEqual(patched.activityTimeline.map((entry) => entry.id), ['entry-a', 'entry-b']);
    assert.deepEqual((snapshot.activityTimeline as ActivityTimelineItem[]).map((entry) => entry.id), ['entry-b']);
});

test('removeActivityTimelineEntry removes matching entries without mutating current entries', () => {
    const current = [
        activityEntry('entry-a', '2026-01-01T00:00:00.000Z'),
        activityEntry('entry-b', '2026-01-02T00:00:00.000Z'),
    ];

    const next = removeActivityTimelineEntry(current, 'entry-a');

    assert.deepEqual(next.map((entry) => entry.id), ['entry-b']);
    assert.deepEqual(current.map((entry) => entry.id), ['entry-a', 'entry-b']);
});

test('removeWorkspaceCoreSnapshotActivityEntry patches only activityTimeline', () => {
    const snapshot = {
        conversationHeader: { id: 'conv-1' } as Conversation,
        messages: [],
        activityTimeline: [
            activityEntry('entry-a', '2026-01-01T00:00:00.000Z'),
            activityEntry('entry-b', '2026-01-02T00:00:00.000Z'),
        ],
    } as WorkspaceCoreSnapshot;

    const patched = removeWorkspaceCoreSnapshotActivityEntry(snapshot, 'entry-b');

    assert.notEqual(patched, snapshot);
    assert.deepEqual(patched.activityTimeline.map((entry) => entry.id), ['entry-a']);
    assert.deepEqual((snapshot.activityTimeline as ActivityTimelineItem[]).map((entry) => entry.id), ['entry-a', 'entry-b']);
});

function activityEntry(id: string, createdAt: string): ActivityTimelineItem {
    return {
        id,
        type: 'activity',
        createdAt,
        action: 'updated',
    };
}
