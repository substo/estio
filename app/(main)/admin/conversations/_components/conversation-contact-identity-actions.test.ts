import assert from 'node:assert/strict';
import test from 'node:test';

import type { Conversation } from '@/lib/ghl/conversations';
import {
    applyConversationIdentityPatch,
    applyDealContactIdentityPatch,
    applyRefreshedConversationIdentityPatch,
    applyRefreshedDealContactIdentityPatch,
    applyRefreshedWorkspaceContactContextIdentityPatch,
    applyWorkspaceContactContextIdentityPatch,
    normalizeConversationContactIdentityPatch,
    type DealContactOption,
} from './conversation-contact-identity-actions';

const baseConversation = {
    id: 'conv-1',
    contactId: 'contact-1',
    locationId: 'loc-1',
    lastMessageBody: 'hello',
    lastMessageDate: 1,
    unreadCount: 0,
    status: 'open',
    type: 'TYPE_SMS',
    contactName: 'Old Name',
    contactEmail: 'old@example.com',
    contactPhone: '+1000',
    contactPreferredLanguage: 'en',
} as Conversation;

const baseDealContact: DealContactOption = {
    conversationId: 'conv-1',
    contactId: 'contact-1',
    contactName: 'Old Name',
    contactEmail: 'old@example.com',
    contactPhone: '+1000',
    lastMessageDate: 1,
};

test('normalizeConversationContactIdentityPatch trims ids and preserves empty-field semantics', () => {
    const patch = normalizeConversationContactIdentityPatch(' conv-1 ', {
        id: ' contact-1 ',
        name: '   ',
        email: '   ',
        phone: ' +2000 ',
        preferredLang: '   ',
        contactType: ' Agent ',
    });

    assert.deepEqual(patch, {
        conversationId: 'conv-1',
        contactId: 'contact-1',
        name: 'Unknown Contact',
        email: undefined,
        phone: '+2000',
        preferredLang: null,
        contactType: 'Agent',
    });
    assert.equal(normalizeConversationContactIdentityPatch('', { id: 'contact-1' }), null);
    assert.equal(normalizeConversationContactIdentityPatch('conv-1', { id: '   ' }), null);
});

test('applyConversationIdentityPatch patches by conversation id or contact id only', () => {
    const patch = normalizeConversationContactIdentityPatch('conv-1', {
        id: 'contact-1',
        name: 'New Name',
        email: 'new@example.com',
        phone: '+2000',
        preferredLang: 'el',
        contactType: 'Agent',
    });
    assert.ok(patch);

    const byConversation = applyConversationIdentityPatch({ ...baseConversation, contactId: 'other-contact' }, patch);
    assert.equal(byConversation.contactName, 'New Name');
    assert.equal(byConversation.contactEmail, 'new@example.com');
    assert.equal(byConversation.contactPhone, '+2000');
    assert.equal(byConversation.contactPreferredLanguage, 'el');
    assert.equal(byConversation.contactType, 'Agent');

    const byContact = applyConversationIdentityPatch({ ...baseConversation, id: 'other-conv' }, patch);
    assert.equal(byContact.contactName, 'New Name');

    const unchanged = { ...baseConversation, id: 'other-conv', contactId: 'other-contact' };
    assert.equal(applyConversationIdentityPatch(unchanged, patch), unchanged);
});

test('deal contact and workspace context patches skip email and phone when normalized empty', () => {
    const patch = normalizeConversationContactIdentityPatch('conv-1', {
        id: 'contact-1',
        email: '',
        phone: '',
        preferredLang: '',
    });
    assert.ok(patch);

    const dealContact = applyDealContactIdentityPatch(baseDealContact, patch);
    assert.equal(dealContact.contactEmail, 'old@example.com');
    assert.equal(dealContact.contactPhone, '+1000');

    const context = applyWorkspaceContactContextIdentityPatch({
        contact: { id: 'contact-1', email: 'old@example.com', phone: '+1000', preferredLang: 'en' },
        other: true,
    }, patch);
    assert.deepEqual(context.contact, { id: 'contact-1', email: 'old@example.com', phone: '+1000', preferredLang: null });
});

test('refreshed identity patch layers fresh conversation first and saved patch last', () => {
    const patch = normalizeConversationContactIdentityPatch('conv-1', {
        id: 'contact-1',
        name: 'Saved Name',
        email: 'saved@example.com',
        phone: '+3000',
        preferredLang: 'el',
        contactType: 'Agent',
    });
    assert.ok(patch);

    const fresh = {
        ...baseConversation,
        contactName: 'Fresh Name',
        contactEmail: 'fresh@example.com',
        contactPhone: '+2000',
        contactPreferredLanguage: 'fr',
    };

    const conversation = applyRefreshedConversationIdentityPatch(baseConversation, fresh, patch);
    assert.equal(conversation.contactName, 'Saved Name');
    assert.equal(conversation.contactEmail, 'saved@example.com');
    assert.equal(conversation.contactPhone, '+3000');
    assert.equal(conversation.contactPreferredLanguage, 'el');
    assert.equal(conversation.contactType, 'Agent');

    const dealContact = applyRefreshedDealContactIdentityPatch(baseDealContact, fresh, patch);
    assert.equal(dealContact.contactName, 'Saved Name');
    assert.equal(dealContact.contactEmail, 'saved@example.com');
    assert.equal(dealContact.contactPhone, '+3000');

    const context = applyRefreshedWorkspaceContactContextIdentityPatch({
        contact: { id: 'contact-1', name: 'Old Name', email: 'old@example.com', phone: '+1000', preferredLang: 'en', contactType: 'Lead' },
    }, fresh, patch);
    assert.equal(context.contact.name, 'Saved Name');
    assert.equal(context.contact.email, 'saved@example.com');
    assert.equal(context.contact.phone, '+3000');
    assert.equal(context.contact.preferredLang, 'el');
    assert.equal(context.contact.contactType, 'Agent');
});
