import assert from 'node:assert/strict';
import test from 'node:test';

import {
    classifyMessageAttachments,
    deriveBodyVCardDownloadHref,
    deriveMediaUnavailableState,
    deriveSharedContactsFromMessageBody,
    normalizeMessageAttachments,
    type NormalizedMessageAttachment,
} from './message-bubble-attachment-actions';

const vcard = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    'FN:Jane Client',
    'TEL:+35799123456',
    'EMAIL:jane@example.test',
    'ORG:Example Estates',
    'END:VCARD',
].join('\n');

test('normalizeMessageAttachments converts string attachments to the existing object shape', () => {
    assert.deepEqual(normalizeMessageAttachments(['https://example.test/photo.jpg']), [
        {
            id: undefined,
            url: 'https://example.test/photo.jpg',
            mimeType: undefined,
            fileName: undefined,
            sharedContacts: null,
            transcript: null,
        },
    ]);
});

test('classifyMessageAttachments detects images by mime type and url or filename extension', () => {
    const byMime = { url: 'https://example.test/media', mimeType: 'image/jpeg' };
    const byUrl = { url: 'https://example.test/media/photo.PNG?token=1' };
    const byName = { url: 'https://example.test/download', fileName: 'diagram.webp' };

    const result = classifyMessageAttachments([byMime, byUrl, byName]);

    assert.deepEqual(result.imageAttachments, [byMime, byUrl, byName]);
    assert.deepEqual(result.audioAttachments, []);
    assert.deepEqual(result.contactAttachments, []);
    assert.deepEqual(result.fileAttachments, []);
});

test('classifyMessageAttachments detects audio by mime type and url or filename extension', () => {
    const byMime = { url: 'https://example.test/media', mimeType: 'audio/ogg; codecs=opus' };
    const byUrl = { url: 'https://example.test/voice.OPUS?token=1' };
    const byName = { url: 'https://example.test/download', fileName: 'note.m4a' };

    const result = classifyMessageAttachments([byMime, byUrl, byName]);

    assert.deepEqual(result.audioAttachments, [byMime, byUrl, byName]);
    assert.deepEqual(result.imageAttachments, []);
    assert.deepEqual(result.contactAttachments, []);
    assert.deepEqual(result.fileAttachments, []);
});

test('classifyMessageAttachments detects contact cards by mime, url, and sharedContacts', () => {
    const bySharedContacts: NormalizedMessageAttachment = {
        url: 'https://example.test/shared',
        sharedContacts: [{ displayName: 'Jane Client', phoneNumber: '+35799123456' }],
    };
    const byMime = { url: 'https://example.test/media', mimeType: 'text/vcard; charset=utf-8' };
    const byUrl = { url: 'https://example.test/contact.VCF?token=1' };
    const byName = { url: 'https://example.test/download', fileName: 'person.vcard' };

    const result = classifyMessageAttachments([bySharedContacts, byMime, byUrl, byName]);

    assert.deepEqual(result.contactAttachments, [bySharedContacts, byMime, byUrl, byName]);
    assert.deepEqual(result.imageAttachments, []);
    assert.deepEqual(result.audioAttachments, []);
    assert.deepEqual(result.fileAttachments, []);
});

test('classifyMessageAttachments keeps unrecognized attachments as files', () => {
    const file = { url: 'https://example.test/document.pdf', mimeType: 'application/pdf' };

    const result = classifyMessageAttachments([file]);

    assert.deepEqual(result.fileAttachments, [file]);
});

test('deriveSharedContactsFromMessageBody and deriveBodyVCardDownloadHref preserve body vCard handling', () => {
    assert.deepEqual(deriveSharedContactsFromMessageBody(vcard), [
        {
            displayName: 'Jane Client',
            phoneNumber: '+35799123456',
            email: 'jane@example.test',
            organization: 'Example Estates',
        },
    ]);
    assert.equal(
        deriveBodyVCardDownloadHref(vcard),
        `data:text/vcard;charset=utf-8,${encodeURIComponent(vcard)}`
    );
    assert.equal(deriveBodyVCardDownloadHref('plain body'), null);
});

test('deriveMediaUnavailableState preserves WhatsApp web bridge unavailable detection', () => {
    assert.equal(deriveMediaUnavailableState({
        isWhatsApp: true,
        source: 'whatsapp_web_bridge',
        webBridgeMedia: { status: 'failed' },
        attachments: [],
    }), true);
    assert.equal(deriveMediaUnavailableState({
        isWhatsApp: true,
        source: 'whatsapp_web_bridge',
        webBridgeMedia: { status: 'stored' },
        attachments: [],
    }), false);
    assert.equal(deriveMediaUnavailableState({
        isWhatsApp: true,
        source: 'whatsapp_web_bridge',
        webBridgeMedia: { status: 'failed' },
        attachments: [{ url: 'https://example.test/photo.jpg' }],
    }), false);
    assert.equal(deriveMediaUnavailableState({
        isWhatsApp: false,
        source: 'whatsapp_web_bridge',
        webBridgeMedia: { status: 'failed' },
        attachments: [],
    }), false);
});
