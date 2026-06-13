import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildMobileConversationListHref,
    shouldPushMobileConversationHistory,
} from './use-mobile-conversation-panes';

test('buildMobileConversationListHref removes the selected conversation id and preserves the workflow mode', () => {
    assert.equal(
        buildMobileConversationListHref('/admin/conversations', '?id=conv-1&mode=chats'),
        '/admin/conversations?mode=chats'
    );
});

test('buildMobileConversationListHref preserves unrelated filters when returning to the list', () => {
    assert.equal(
        buildMobileConversationListHref('/admin/conversations', 'id=conv-1&mode=chats&view=archived&task=task-1'),
        '/admin/conversations?mode=chats&view=archived&task=task-1'
    );
});

test('shouldPushMobileConversationHistory only pushes when opening a mobile chat from the list', () => {
    assert.equal(shouldPushMobileConversationHistory({
        isMobileViewport: true,
        workflowUrlMode: 'chats',
        activeId: 'conv-1',
        previousUrlConversationId: null,
    }), true);

    assert.equal(shouldPushMobileConversationHistory({
        isMobileViewport: false,
        workflowUrlMode: 'chats',
        activeId: 'conv-1',
        previousUrlConversationId: null,
    }), false);

    assert.equal(shouldPushMobileConversationHistory({
        isMobileViewport: true,
        workflowUrlMode: 'chats',
        activeId: 'conv-2',
        previousUrlConversationId: 'conv-1',
    }), false);

    assert.equal(shouldPushMobileConversationHistory({
        isMobileViewport: true,
        workflowUrlMode: 'deals',
        activeId: 'conv-1',
        previousUrlConversationId: null,
    }), false);
});
