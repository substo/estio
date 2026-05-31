import assert from 'node:assert/strict';
import test from 'node:test';

import type { Conversation } from '@/lib/ghl/conversations';
import {
    removeMergedSourceConversation,
    resolvePostMergeActiveConversationId,
    shouldRemoveMergedSourceConversation,
    upsertPostMergeTargetConversation,
} from './conversation-merge-ui-actions';

const conversations = [
    { id: 'conv-1', contactName: 'One' },
    { id: 'conv-2', contactName: 'Two' },
    { id: 'conv-3', contactName: 'Three' },
] as Conversation[];

test('removeMergedSourceConversation removes only the merged source conversation', () => {
    assert.deepEqual(
        removeMergedSourceConversation(conversations, 'conv-2').map((conversation) => conversation.id),
        ['conv-1', 'conv-3']
    );
    assert.deepEqual(
        removeMergedSourceConversation(conversations, ' missing ').map((conversation) => conversation.id),
        ['conv-1', 'conv-2', 'conv-3']
    );
});

test('removeMergedSourceConversation leaves the list unchanged for an empty source id', () => {
    assert.equal(removeMergedSourceConversation(conversations, ''), conversations);
    assert.equal(removeMergedSourceConversation(conversations, '   '), conversations);
});

test('resolvePostMergeActiveConversationId preserves target conversation navigation behavior', () => {
    assert.equal(resolvePostMergeActiveConversationId('target-conv'), 'target-conv');
    assert.equal(resolvePostMergeActiveConversationId(' target-conv '), 'target-conv');
    assert.equal(resolvePostMergeActiveConversationId(''), null);
    assert.equal(resolvePostMergeActiveConversationId('   '), null);
    assert.equal(resolvePostMergeActiveConversationId(null), null);
    assert.equal(resolvePostMergeActiveConversationId(undefined), null);
});

test('shouldRemoveMergedSourceConversation keeps the conversation when it was moved to the target contact', () => {
    assert.equal(shouldRemoveMergedSourceConversation('source-conv', 'target-conv'), true);
    assert.equal(shouldRemoveMergedSourceConversation('source-conv', ' source-conv '), false);
    assert.equal(shouldRemoveMergedSourceConversation('', 'target-conv'), false);
    assert.equal(shouldRemoveMergedSourceConversation('source-conv', null), false);
});

test('upsertPostMergeTargetConversation refreshes existing target conversations', () => {
    const refreshed = upsertPostMergeTargetConversation(conversations, 'conv-2', {
        id: 'conv-2',
        contactName: 'Two updated',
        unreadCount: 4,
    } as Conversation);

    assert.deepEqual(refreshed.map((conversation) => conversation.contactName), ['One', 'Two updated', 'Three']);
    assert.equal((refreshed[1] as any).unreadCount, 4);
});

test('upsertPostMergeTargetConversation inserts only when requested', () => {
    const freshConversation = { id: 'conv-4', contactName: 'Four' } as Conversation;

    assert.equal(upsertPostMergeTargetConversation(conversations, 'conv-4', freshConversation), conversations);
    assert.deepEqual(
        upsertPostMergeTargetConversation(conversations, 'conv-4', freshConversation, { insertIfMissing: true }).map((conversation) => conversation.id),
        ['conv-4', 'conv-1', 'conv-2', 'conv-3']
    );
});
