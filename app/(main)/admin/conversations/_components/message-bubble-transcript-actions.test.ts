import assert from 'node:assert/strict';
import test from 'node:test';

import {
    formatExtractionList,
    formatExtractionSummary,
    getExtractionActionLabel,
    getTranscriptActionLabel,
    getTranscriptPreviewText,
    isPendingStatus,
    shouldShowTranscriptToggle,
} from './message-bubble-transcript-actions';

test('isPendingStatus detects pending transcript states', () => {
    assert.equal(isPendingStatus('pending'), true);
    assert.equal(isPendingStatus('processing'), true);
    assert.equal(isPendingStatus('completed'), false);
    assert.equal(isPendingStatus('failed'), false);
    assert.equal(isPendingStatus(undefined), false);
});

test('getTranscriptPreviewText preserves 280 character truncation', () => {
    const text = 'a'.repeat(281);

    assert.equal(getTranscriptPreviewText(text, false), `${'a'.repeat(280)}...`);
    assert.equal(getTranscriptPreviewText(text, true), text);
    assert.equal(getTranscriptPreviewText('short text', false), 'short text');
});

test('shouldShowTranscriptToggle only shows for transcript text longer than 280 characters', () => {
    assert.equal(shouldShowTranscriptToggle('a'.repeat(280)), false);
    assert.equal(shouldShowTranscriptToggle('a'.repeat(281)), true);
    assert.equal(shouldShowTranscriptToggle(null), false);
});

test('formatExtractionList preserves array-only formatting', () => {
    assert.deepEqual(formatExtractionList([' buyer ', '', null, 'seller']), ['buyer', 'seller']);
    assert.deepEqual(formatExtractionList('buyer'), []);
    assert.deepEqual(formatExtractionList(undefined), []);
    assert.deepEqual(formatExtractionList([]), []);
});

test('formatExtractionSummary keeps viewing note defaults', () => {
    assert.deepEqual(formatExtractionSummary({}), {
        prospects: 'None',
        requirements: 'None',
        budget: 'Not specified',
        locations: 'None',
        objections: 'None',
        nextActions: 'None',
    });

    assert.deepEqual(formatExtractionSummary({
        prospects: ['Alice', ' Bob '],
        requirements: ['3 bed'],
        budget: ' 500k ',
        locations: ['Limassol'],
        objections: ['Timing'],
        nextActions: ['Call back'],
    }), {
        prospects: 'Alice; Bob',
        requirements: '3 bed',
        budget: '500k',
        locations: 'Limassol',
        objections: 'Timing',
        nextActions: 'Call back',
    });
});

test('getTranscriptActionLabel preserves transcript button labels', () => {
    assert.equal(getTranscriptActionLabel({ activeAttachmentId: null, attachmentId: 'a1', mode: 'start' }), 'Transcribe now');
    assert.equal(getTranscriptActionLabel({ activeAttachmentId: 'a1', attachmentId: 'a1', mode: 'start' }), 'Starting...');
    assert.equal(getTranscriptActionLabel({ activeAttachmentId: null, attachmentId: 'a1', mode: 'regenerate' }), 'Regenerate transcript');
    assert.equal(getTranscriptActionLabel({ activeAttachmentId: 'a1', attachmentId: 'a1', mode: 'regenerate' }), 'Regenerating...');
    assert.equal(getTranscriptActionLabel({ activeAttachmentId: null, attachmentId: 'a1', mode: 'retry' }), 'Retry transcript');
    assert.equal(getTranscriptActionLabel({ activeAttachmentId: 'a1', attachmentId: 'a1', mode: 'retry' }), 'Retrying...');
});

test('getExtractionActionLabel preserves extraction button labels', () => {
    assert.equal(getExtractionActionLabel({ activeAttachmentId: null, attachmentId: 'a1', hasExtraction: false }), 'Extract viewing notes');
    assert.equal(getExtractionActionLabel({ activeAttachmentId: 'a1', attachmentId: 'a1', hasExtraction: false }), 'Extracting...');
    assert.equal(getExtractionActionLabel({ activeAttachmentId: null, attachmentId: 'a1', hasExtraction: true }), 'Regenerate notes');
    assert.equal(getExtractionActionLabel({ activeAttachmentId: 'a1', attachmentId: 'a1', hasExtraction: true }), 'Regenerating notes...');
    assert.equal(getExtractionActionLabel({ activeAttachmentId: null, attachmentId: 'a1', retry: true }), 'Retry extraction');
    assert.equal(getExtractionActionLabel({ activeAttachmentId: 'a1', attachmentId: 'a1', retry: true }), 'Retrying...');
});
