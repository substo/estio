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
