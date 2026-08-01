import {
    createPasteLeadStatus,
    type PasteLeadImportStatus,
} from '@/lib/conversations/paste-lead-status';
import { normalizeInternationalPhone } from '@/lib/utils/phone';

type RecoverableParsedLead = {
    contact?: {
        name?: string | null;
        phone?: string | null;
        email?: string | null;
        [key: string]: unknown;
    };
    requirements?: {
        budget?: string | null;
        location?: string | null;
        type?: string | null;
        [key: string]: unknown;
    };
    [key: string]: unknown;
};

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

export type NewConversationCreatedResult = {
    conversationId: string;
    legacyConversationId?: string | null;
    isNew?: boolean;
    contactId?: string | null;
    contactName?: string | null;
    contactPhone?: string | null;
    contactEmail?: string | null;
    locationId?: string | null;
    messageType?: string | null;
    lastMessageBody?: string | null;
    lastMessageDate?: number | null;
    historyBackfillQueued?: boolean;
    backgroundJobsQueued?: string[];
};

export function normalizeNewConversationStartInput(input: string) {
    const trimmed = input.trim();
    if (!trimmed) return '';
    if (/@lid$/i.test(trimmed) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return trimmed;

    const normalized = normalizeInternationalPhone(trimmed);
    return normalized.formatted || trimmed;
}

export function getNewConversationPhoneInputError(input: string) {
    const trimmed = input.trim();
    if (!trimmed) return 'Enter a phone number.';
    const digits = trimmed.replace(/\D/g, '');
    if (digits.length < 7) {
        return 'Phone number is too short. Please include the country code.';
    }
    const normalized = normalizeInternationalPhone(trimmed);
    if (!normalized.isValid || !normalized.formatted) {
        return 'Enter a valid international phone number with a country code.';
    }
    return null;
}

export function matchesNewConversationContact(
    contact: { locationId: string; phone?: string | null; email?: string | null; lid?: string | null },
    args: { locationId: string; rawDigits: string; requestedIdentity: string; requestedLid: string; isEmail: boolean }
) {
    if (contact.locationId !== args.locationId) return false;
    if (args.requestedLid) return contact.lid === args.requestedLid;
    if (args.isEmail) return contact.email?.toLowerCase() === args.requestedIdentity.toLowerCase();
    if (!contact.phone) return false;

    const contactDigits = contact.phone.replace(/\D/g, '');
    return contactDigits === args.rawDigits ||
        (contactDigits.endsWith(args.rawDigits) && args.rawDigits.length >= 7) ||
        (args.rawDigits.endsWith(contactDigits) && contactDigits.length >= 7);
}

export function matchesNewConversationRecord(
    conversation: { locationId: string; contactId: string } | null,
    args: { locationId: string; contactId: string }
) {
    return Boolean(conversation &&
        conversation.locationId === args.locationId &&
        conversation.contactId === args.contactId);
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

export function getPasteLeadRecoverableParsedLead<TParsedLead extends RecoverableParsedLead>(result: {
    success?: boolean;
    parsedLead?: TParsedLead | null;
    data?: TParsedLead | null;
}) {
    if (result?.success) return null;
    return result?.parsedLead || result?.data || null;
}

export function buildPasteLeadRecoverableImportError(result: {
    error?: string | null;
    failedStage?: string | null;
    partialContactId?: string | null;
    partialConversationId?: string | null;
}) {
    const parts = ['Import failed after the lead was parsed. Review the extracted details below and save what can be recovered.'];
    if (result?.failedStage) parts.push(`Failed stage: ${result.failedStage}.`);
    if (result?.partialContactId) parts.push('Contact was saved before the failure.');
    if (result?.partialConversationId) parts.push('Conversation was saved before the failure.');
    if (result?.error) parts.push(result.error);
    return parts.join(' ');
}
