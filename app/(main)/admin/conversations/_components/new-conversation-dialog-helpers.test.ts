import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildInitialPasteLeadStatuses,
    buildNewConversationResultError,
    mergePasteLeadResultStatuses,
    normalizeNewConversationStartInput,
    resolveWhatsAppChatIdentity,
} from './new-conversation-dialog-helpers';

test('normalizes manual start input by trimming only', () => {
    assert.equal(normalizeNewConversationStartInput('  +357 99 045 511  '), '+357 99 045 511');
});

test('resolves WhatsApp chat identity using existing priority', () => {
    assert.equal(resolveWhatsAppChatIdentity({ phone: '35799045511', jid: 'jid-1', lid: 'lid-1' }), '+35799045511');
    assert.equal(resolveWhatsAppChatIdentity({ phone: '+35799045511', jid: 'jid-1', lid: 'lid-1' }), '+35799045511');
    assert.equal(resolveWhatsAppChatIdentity({ phone: null, jid: 'jid-1', lid: 'lid-1' }), 'jid-1');
    assert.equal(resolveWhatsAppChatIdentity({ phone: null, jid: '', lid: 'lid-1' }), 'lid-1');
    assert.equal(resolveWhatsAppChatIdentity({ phone: null, jid: '', lid: null }), '');
});

test('builds conversation errors from strings, Error-like objects, and fallbacks', () => {
    assert.equal(buildNewConversationResultError('No identity'), 'No identity');
    assert.equal(buildNewConversationResultError(new Error('Failed request')), 'Failed request');
    assert.equal(buildNewConversationResultError(null, 'Fallback copy'), 'Fallback copy');
});

test('seeds Paste Lead statuses using preview state', () => {
    const withoutPreview = buildInitialPasteLeadStatuses({ hasPreview: false, traceId: 'trace-1' });
    assert.deepEqual(withoutPreview.map((status) => [status.event, status.state, status.detail]), [
        ['paste_lead_import_started', 'running', undefined],
        ['lead_parse_started', 'running', undefined],
    ]);

    const withPreview = buildInitialPasteLeadStatuses({ hasPreview: true, traceId: 'trace-2' });
    assert.deepEqual(withPreview.map((status) => [status.event, status.state, status.detail]), [
        ['paste_lead_import_started', 'running', undefined],
        ['lead_parse_completed', 'completed', 'preview cache'],
    ]);
});

test('uses server Paste Lead statuses when present and otherwise appends terminal status', () => {
    const current = buildInitialPasteLeadStatuses({ hasPreview: true, traceId: 'trace-1' });
    const serverStatuses = buildInitialPasteLeadStatuses({ hasPreview: false, traceId: 'trace-2' });
    assert.equal(mergePasteLeadResultStatuses(current, { statuses: serverStatuses }), serverStatuses);

    const failed = mergePasteLeadResultStatuses(current, { success: false, error: 'Import failed', pasteLeadTraceId: 'trace-3' });
    assert.equal(failed.at(-1)?.event, 'paste_lead_import_failed');
    assert.equal(failed.at(-1)?.detail, 'Import failed');

    const succeeded = mergePasteLeadResultStatuses(current, { success: true, pasteLeadTraceId: 'trace-4' });
    assert.equal(succeeded.at(-1)?.event, 'paste_lead_import_completed');
});
