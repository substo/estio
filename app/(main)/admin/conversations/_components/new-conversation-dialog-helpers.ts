import {
    createPasteLeadStatus,
    type PasteLeadImportStatus,
} from '@/lib/conversations/paste-lead-status';

export interface WhatsAppChat {
    jid: string;
    phone: string | null;
    lid?: string | null;
    name: string;
    isGroup: boolean;
    alreadySynced: boolean;
    identityPending?: boolean;
    lastMessageTimestamp: number | null;
}

export type GoogleContactSearchResult = {
    resourceName: string;
    name?: string | null;
    email?: string | null;
    phone?: string | null;
    photo?: string | null;
};

export type GoogleContactImportOutcome = 'imported' | 'linked' | 'updated' | 'existing';

export type GoogleContactConversationOutcome = 'created' | 'opened';

export type GoogleContactRowOutcome = {
    importOutcome?: GoogleContactImportOutcome | null;
    conversationOutcome?: GoogleContactConversationOutcome | null;
    error?: string | null;
};

export function normalizeNewConversationStartInput(input: string) {
    return input.trim();
}

export function buildNewConversationResultError(
    error: unknown,
    fallback = 'Failed to create conversation'
) {
    if (typeof error === 'string' && error.trim()) return error;
    if (error && typeof error === 'object' && 'message' in error) {
        const message = (error as { message?: unknown }).message;
        if (typeof message === 'string' && message.trim()) return message;
    }
    return fallback;
}

export function resolveWhatsAppChatIdentity(chat: Pick<WhatsAppChat, 'phone' | 'jid' | 'lid'>) {
    if (chat.phone) {
        return chat.phone.startsWith('+') ? chat.phone : `+${chat.phone}`;
    }
    return chat.jid || chat.lid || '';
}

export function shouldShowHistoryBackfillQueuedToast(result: {
    historyBackfillQueued?: boolean;
    backgroundJobsQueued?: string[];
}) {
    return Boolean(
        result?.historyBackfillQueued ||
        result?.backgroundJobsQueued?.includes('webBridgeHistoryBackfill')
    );
}

export function shouldApplyGoogleSearchResult(requestId: number, latestRequestId: number) {
    return requestId === latestRequestId;
}

export function canStartGoogleContactConversation(contact: Pick<GoogleContactSearchResult, 'phone' | 'email'> | null | undefined) {
    return Boolean(contact?.phone || contact?.email);
}

export function getGoogleContactDisabledReason(contact: Pick<GoogleContactSearchResult, 'phone' | 'email'> | null | undefined) {
    if (canStartGoogleContactConversation(contact)) return null;
    return 'Phone or email required to start a conversation.';
}

export function getGoogleConnectionErrorMessage(message?: string | null) {
    if (message === 'GOOGLE_NOT_CONNECTED') {
        return 'Google Contacts is not connected. Connect Google in Integrations and try again.';
    }
    if (message === 'GOOGLE_AUTH_EXPIRED') {
        return 'Your Google connection expired. Reconnect Google and try again.';
    }
    return message || 'Google Contacts request failed.';
}

export function getGoogleImportOutcomeLabel(outcome?: GoogleContactImportOutcome | null) {
    switch (outcome) {
        case 'imported':
            return 'Imported new contact';
        case 'linked':
            return 'Linked existing contact';
        case 'updated':
            return 'Updated existing contact';
        case 'existing':
            return 'Existing contact';
        default:
            return null;
    }
}

export function getGoogleConversationOutcomeLabel(outcome?: GoogleContactConversationOutcome | null) {
    switch (outcome) {
        case 'created':
            return 'Created new conversation';
        case 'opened':
            return 'Opened existing conversation';
        default:
            return null;
    }
}

export function buildGoogleRowOutcomeLabel(outcome: GoogleContactRowOutcome | null | undefined) {
    if (outcome?.error) return outcome.error;

    const labels = [
        getGoogleImportOutcomeLabel(outcome?.importOutcome),
        getGoogleConversationOutcomeLabel(outcome?.conversationOutcome),
    ].filter(Boolean);

    return labels.length > 0 ? labels.join(' • ') : null;
}

export function buildInitialPasteLeadStatuses(args: {
    hasPreview: boolean;
    traceId: string;
}) {
    return [
        createPasteLeadStatus('paste_lead_import_started', 'running', { pasteLeadTraceId: args.traceId }),
        createPasteLeadStatus(args.hasPreview ? 'lead_parse_completed' : 'lead_parse_started', args.hasPreview ? 'completed' : 'running', {
            pasteLeadTraceId: args.traceId,
            detail: args.hasPreview ? 'preview cache' : undefined,
        }),
    ];
}

export function mergePasteLeadResultStatuses(
    current: PasteLeadImportStatus[],
    result: {
        success?: boolean;
        error?: string;
        pasteLeadTraceId?: string;
        statuses?: PasteLeadImportStatus[];
    }
) {
    if (Array.isArray(result?.statuses) && result.statuses.length > 0) {
        return result.statuses;
    }

    return [
        ...current,
        createPasteLeadStatus(result?.success ? 'paste_lead_import_completed' : 'paste_lead_import_failed', result?.success ? 'completed' : 'failed', {
            pasteLeadTraceId: result?.pasteLeadTraceId,
            detail: result?.error || undefined,
        }),
    ];
}
