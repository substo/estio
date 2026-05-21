import assert from 'node:assert/strict';
import test from 'node:test';

import type { Conversation } from '@/lib/ghl/conversations';
import {
    buildDealContactOptions,
    chooseNextDealConversationId,
    resolveDealTitle,
    resolveSelectedConversationsForDeal,
    resolveSelectedDealConversation,
} from './conversation-deal-actions';

const participants = [
    {
        id: 'conv-old',
        contactId: 'contact-1',
        contactName: 'Older Contact',
        contactEmail: 'old@example.com',
        contactPhone: '+100',
        lastMessageDate: 100,
        unreadCount: 1,
        lastMessageType: 'SMS',
    },
    {
        id: 'conv-new',
        contactId: 'contact-1',
        contactName: 'Newer Contact',
        contactEmail: 'new@example.com',
        contactPhone: '+101',
        lastMessageDate: 300,
        unreadCount: 2,
        lastMessageType: 'WhatsApp',
    },
    {
        id: 'conv-email',
        contactName: '',
        contactEmail: 'email@example.com',
        lastMessageDate: 200,
    },
    {
        id: 'conv-id-only',
        contactName: 'Id Only',
        lastMessageDate: 50,
    },
] as Conversation[];

test('buildDealContactOptions dedupes by contact and sorts newest first', () => {
    const contacts = buildDealContactOptions(participants);

    assert.deepEqual(
        contacts.map((contact) => contact.conversationId),
        ['conv-new', 'conv-email', 'conv-id-only']
    );
    assert.equal(contacts[0].contactName, 'Newer Contact');
    assert.equal(contacts[0].unreadCount, 2);
    assert.equal(contacts[1].contactName, 'Unknown Contact');
});

test('resolveSelectedDealConversation returns the active participant only', () => {
    assert.equal(resolveSelectedDealConversation(participants, 'conv-email')?.id, 'conv-email');
    assert.equal(resolveSelectedDealConversation(participants, 'missing'), null);
    assert.equal(resolveSelectedDealConversation(participants, null), null);
});

test('resolveDealTitle preserves list, snapshot, and default fallback order', () => {
    assert.equal(resolveDealTitle({ title: ' List Deal ' }, { title: 'Snapshot Deal' }), 'List Deal');
    assert.equal(resolveDealTitle({ title: '' }, { title: ' Snapshot Deal ' }), 'Snapshot Deal');
    assert.equal(resolveDealTitle({ title: '   ' }, { title: '   ' }), 'Deal');
    assert.equal(resolveDealTitle(null, null), 'Deal');
});

test('resolveSelectedConversationsForDeal resolves ids from cache before visible conversations', () => {
    const cached = { id: 'conv-2', contactName: 'Cached Two' } as Conversation;
    const visible = [
        { id: 'conv-1', contactName: 'One' },
        { id: 'conv-2', contactName: 'Visible Two' },
        { id: 'conv-3', contactName: 'Three' },
    ] as Conversation[];

    const selected = resolveSelectedConversationsForDeal(
        ['conv-2', 'conv-3', 'missing'],
        new Map([['conv-2', cached]]),
        visible
    );

    assert.deepEqual(selected.map((conversation) => conversation.contactName), ['Cached Two', 'Three']);
});

test('chooseNextDealConversationId preserves preferred, url, previous, and contact fallback order', () => {
    const contacts = buildDealContactOptions(participants);

    assert.equal(
        chooseNextDealConversationId(participants, contacts, ' conv-email ', 'conv-new', 'conv-old'),
        'conv-email'
    );
    assert.equal(
        chooseNextDealConversationId(participants, contacts, 'missing', 'conv-email', 'conv-old'),
        'conv-email'
    );
    assert.equal(
        chooseNextDealConversationId(participants, contacts, null, 'missing', 'conv-old'),
        'conv-old'
    );
    assert.equal(
        chooseNextDealConversationId(participants, contacts, null, null, 'missing'),
        'conv-new'
    );
    assert.equal(chooseNextDealConversationId([], [], null, null, null), null);
});
