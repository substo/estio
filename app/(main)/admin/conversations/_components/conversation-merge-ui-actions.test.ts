import assert from 'node:assert/strict';
import test from 'node:test';

import type { Conversation } from '@/lib/ghl/conversations';
import {
    removeMergedSourceConversation,
    resolvePostMergeActiveConversationId,
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
