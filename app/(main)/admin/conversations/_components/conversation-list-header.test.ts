import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveConversationListWorkflowView } from './conversation-list-header-state';

test('conversation list header workflow keeps mailbox filters in Chats', () => {
    assert.equal(resolveConversationListWorkflowView('chats', 'active'), 'chats');
    assert.equal(resolveConversationListWorkflowView('chats', 'archived'), 'chats');
    assert.equal(resolveConversationListWorkflowView('chats', 'trash'), 'chats');
});

test('conversation list header workflow preserves Deals and Tasks grouping', () => {
    assert.equal(resolveConversationListWorkflowView('deals', 'active'), 'deals');
    assert.equal(resolveConversationListWorkflowView('chats', 'tasks'), 'tasks');
});
