import assert from 'node:assert/strict';
import test from 'node:test';

import type { Conversation } from '@/lib/ghl/conversations';
import {
    applyVisibleConversationSelection,
    collectConversationsByIds,
    removeConversationsByIds,
    resolveSelectedConversations,
    shouldClearActiveConversation,
    shouldExitSelectionModeAfterBulkAction,
    toggleConversationSelection,
} from './conversation-bulk-actions';

const conversations = [
    { id: 'conv-1', contactName: 'One' },
    { id: 'conv-2', contactName: 'Two' },
    { id: 'conv-3', contactName: 'Three' },
] as Conversation[];

test('collect and remove conversations by selected ids preserve list order', () => {
    assert.deepEqual(
        collectConversationsByIds(conversations, ['conv-3', 'conv-1']).map((conversation) => conversation.id),
        ['conv-1', 'conv-3']
    );
    assert.deepEqual(
        removeConversationsByIds(conversations, ['conv-2']).map((conversation) => conversation.id),
        ['conv-1', 'conv-3']
    );
});

test('selection helpers preserve add/remove mechanics', () => {
    const selected = new Set(['conv-1']);
    assert.deepEqual(Array.from(toggleConversationSelection(selected, 'conv-2', true)), ['conv-1', 'conv-2']);
    assert.deepEqual(Array.from(toggleConversationSelection(selected, 'conv-1', false)), []);
    assert.deepEqual(Array.from(selected), ['conv-1']);

    const selectedVisible = applyVisibleConversationSelection(selected, ['conv-2', 'conv-3'], true);
    assert.deepEqual(Array.from(selectedVisible), ['conv-1', 'conv-2', 'conv-3']);
    assert.deepEqual(
        Array.from(applyVisibleConversationSelection(selectedVisible, ['conv-1', 'conv-3'], false)),
        ['conv-2']
    );
});

test('bulk action decisions match existing selection and active-id behavior', () => {
    assert.equal(shouldExitSelectionModeAfterBulkAction(['conv-1', 'conv-2', 'conv-3'], conversations), true);
    assert.equal(shouldExitSelectionModeAfterBulkAction(['conv-1'], conversations), false);
    assert.equal(shouldClearActiveConversation('conv-2', ['conv-1', 'conv-2']), true);
    assert.equal(shouldClearActiveConversation('conv-3', ['conv-1', 'conv-2']), false);
    assert.equal(shouldClearActiveConversation(null, ['conv-1']), false);
});

test('selected conversations resolve from cache before visible list', () => {
    const cachedConversation = { id: 'conv-2', contactName: 'Cached Two' } as Conversation;
    const selected = resolveSelectedConversations(
        new Set(['conv-2', 'conv-3', 'missing']),
        new Map([['conv-2', cachedConversation]]),
        conversations
    );

    assert.deepEqual(selected.map((conversation) => conversation.contactName), ['Cached Two', 'Three']);
});
