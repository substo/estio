import assert from 'node:assert/strict';
import test from 'node:test';

import {
    classifyMessageAttachments,
    deriveAttachmentDownloadUrl,
    deriveBodyVCardDownloadHref,
    deriveMediaUnavailableState,
    deriveSharedContactsFromMessageBody,
    isLikelyMediaPlaceholderBody,
    normalizeMessageAttachments,
    shouldSuppressMediaPlaceholderBody,
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

test('normalizeMessageAttachments dedupes duplicate audio attachments and keeps completed transcript', () => {
    const result = normalizeMessageAttachments([
        {
            id: 'pending-copy',
            url: '/api/media/attachments/pending-copy',
            mimeType: 'audio/ogg; codecs=opus',
            fileName: 'voice.bin',
            transcript: { status: 'pending' },
        },
        {
            id: 'completed-copy',
            url: '/api/media/attachments/completed-copy',
            mimeType: 'audio/ogg; codecs=opus',
            fileName: 'voice.bin',
            transcript: { status: 'completed', text: 'Hello' },
        },
    ]);

    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'completed-copy');
    assert.equal(result[0].transcript?.status, 'completed');
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

test('deriveAttachmentDownloadUrl marks local attachment URLs for download', () => {
    assert.equal(
        deriveAttachmentDownloadUrl('/api/media/attachments/att_1'),
        '/api/media/attachments/att_1?download=1'
    );
    assert.equal(
        deriveAttachmentDownloadUrl('/api/media/attachments/att_1?preview=1'),
        '/api/media/attachments/att_1?preview=1&download=1'
    );
    assert.equal(
        deriveAttachmentDownloadUrl('https://example.test/photo.jpg'),
        'https://example.test/photo.jpg'
    );
});

test('media placeholder detection hides raw placeholders only when media is renderable', () => {
    assert.equal(isLikelyMediaPlaceholderBody('[Audio]'), true);
    assert.equal(isLikelyMediaPlaceholderBody(' [Image] '), true);
    assert.equal(isLikelyMediaPlaceholderBody('Actual customer text'), false);

    assert.equal(shouldSuppressMediaPlaceholderBody('[Audio]', true), true);
    assert.equal(shouldSuppressMediaPlaceholderBody('[Audio]', false), false);
    assert.equal(shouldSuppressMediaPlaceholderBody('Actual customer text', true), false);
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
