import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildPasteLeadRecoverableImportError,
    buildInitialPasteLeadStatuses,
    buildGoogleRowOutcomeLabel,
    buildNewConversationResultError,
    canStartGoogleContactConversation,
    getGoogleContactDisabledReason,
    getGoogleConnectionErrorMessage,
    getPasteLeadRecoverableParsedLead,
    getGoogleConversationOutcomeLabel,
    getGoogleImportOutcomeLabel,
    mergePasteLeadResultStatuses,
    normalizeNewConversationStartInput,
    resolveWhatsAppChatIdentity,
    shouldApplyGoogleSearchResult,
    shouldShowHistoryBackfillQueuedToast,
} from './new-conversation-dialog-helpers';

test('normalizes manual phone starts to E.164 like Paste Lead', () => {
    assert.equal(normalizeNewConversationStartInput('  +357 99 045 511  '), '+35799045511');
    assert.equal(normalizeNewConversationStartInput('357 99 045 511'), '+35799045511');
    assert.equal(normalizeNewConversationStartInput('99 045 511'), '+35799045511');
    assert.equal(normalizeNewConversationStartInput('00357 99 045 511'), '+35799045511');
});

test('keeps non-phone manual conversation identities intact', () => {
    assert.equal(normalizeNewConversationStartInput('  lead@example.com  '), 'lead@example.com');
    assert.equal(normalizeNewConversationStartInput('  12345@lid  '), '12345@lid');
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

test('detects queued Web Bridge history backfill metadata', () => {
    assert.equal(shouldShowHistoryBackfillQueuedToast({ historyBackfillQueued: true }), true);
    assert.equal(shouldShowHistoryBackfillQueuedToast({ backgroundJobsQueued: ['webBridgeHistoryBackfill'] }), true);
    assert.equal(shouldShowHistoryBackfillQueuedToast({ messagesImported: 0 } as any), false);
});

test('keeps only the latest Google search result', () => {
    assert.equal(shouldApplyGoogleSearchResult(2, 2), true);
    assert.equal(shouldApplyGoogleSearchResult(1, 2), false);
});

test('maps Google import and conversation outcomes to row labels', () => {
    assert.equal(getGoogleImportOutcomeLabel('imported'), 'Imported new contact');
    assert.equal(getGoogleImportOutcomeLabel('linked'), 'Linked existing contact');
    assert.equal(getGoogleImportOutcomeLabel('updated'), 'Updated existing contact');
    assert.equal(getGoogleImportOutcomeLabel('existing'), 'Existing contact');
    assert.equal(getGoogleConversationOutcomeLabel('created'), 'Created new conversation');
    assert.equal(getGoogleConversationOutcomeLabel('opened'), 'Opened existing conversation');
    assert.equal(buildGoogleRowOutcomeLabel({ importOutcome: 'linked', conversationOutcome: 'opened' }), 'Linked existing contact • Opened existing conversation');
    assert.equal(buildGoogleRowOutcomeLabel({ error: 'Import failed' }), 'Import failed');
});

test('maps Google connection errors to actionable copy', () => {
    assert.equal(
        getGoogleConnectionErrorMessage('GOOGLE_NOT_CONNECTED'),
        'Google Contacts is not connected. Connect Google in Integrations and try again.'
    );
    assert.equal(
        getGoogleConnectionErrorMessage('GOOGLE_AUTH_EXPIRED'),
        'Your Google connection expired. Reconnect Google and try again.'
    );
    assert.equal(getGoogleConnectionErrorMessage('Import failed'), 'Import failed');
});

test('allows email-only Google contacts to start conversations', () => {
    assert.equal(canStartGoogleContactConversation({ email: 'lead@example.com', phone: null }), true);
    assert.equal(getGoogleContactDisabledReason({ email: 'lead@example.com', phone: null }), null);
});

test('disables Google conversation start with no phone or email', () => {
    assert.equal(canStartGoogleContactConversation({ email: null, phone: null }), false);
    assert.equal(
        getGoogleContactDisabledReason({ email: null, phone: null }),
        'Phone or email required to start a conversation.'
    );
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

test('exposes recoverable Paste Lead parsed data after import failure', () => {
    const parsedLead = {
        contact: { name: 'Jane Lead', phone: '+35799000000' },
        requirements: { location: 'Paphos' },
        goal: 'To Buy',
    } as const;

    assert.equal(getPasteLeadRecoverableParsedLead({ success: false, parsedLead }), parsedLead);
    assert.equal(getPasteLeadRecoverableParsedLead({ success: false, data: parsedLead }), parsedLead);
    assert.equal(getPasteLeadRecoverableParsedLead({ success: true, parsedLead }), null);

    const message = buildPasteLeadRecoverableImportError({
        error: 'Conversation create failed',
        failedStage: 'conversation_create_failed',
        partialContactId: 'contact-1',
    });
    assert.match(message, /Review the extracted details/);
    assert.match(message, /conversation_create_failed/);
    assert.match(message, /Contact was saved/);
});
