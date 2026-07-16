'use client';

import { useCallback, useState } from 'react';

import { useToast } from '@/components/ui/use-toast';

import { startNewConversation } from '../actions';
import {
    buildNewConversationResultError,
    normalizeNewConversationStartInput,
    shouldShowHistoryBackfillQueuedToast,
    type NewConversationCreatedResult,
} from './new-conversation-dialog-helpers';

export function useNewConversationPhone(args: {
    onConversationCreated?: (conversationId: string, result?: NewConversationCreatedResult) => void;
    onClose: () => void;
    setError: (error: string | null) => void;
}) {
    const { toast } = useToast();
    const [phoneInput, setPhoneInput] = useState('');
    const [creatingPhone, setCreatingPhone] = useState(false);

    const updatePhoneInput = useCallback((value: string) => {
        const normalized = normalizeNewConversationStartInput(value);
        const digitCount = value.replace(/\D/g, '').length;
        setPhoneInput(
            normalized.startsWith('+') && digitCount >= 7
                ? normalized
                : value
        );
    }, []);

    const startByPhone = useCallback(async () => {
        const input = normalizeNewConversationStartInput(phoneInput);
        if (!input) return;

        setCreatingPhone(true);
        args.setError(null);

        try {
            const res = await startNewConversation(input);
            if (res.success && res.conversationId) {
                if (shouldShowHistoryBackfillQueuedToast(res)) {
                    toast({
                        title: 'Conversation opened',
                        description: 'Recent WhatsApp history is syncing in the background.',
                    });
                }
                args.onConversationCreated?.(res.conversationId, res);
                args.onClose();
            } else {
                args.setError(res.error || 'Failed to create conversation');
            }
        } catch (error: any) {
            args.setError(buildNewConversationResultError(error));
        } finally {
            setCreatingPhone(false);
        }
    }, [args, phoneInput, toast]);

    const resetPhone = useCallback(() => {
        setPhoneInput('');
        setCreatingPhone(false);
    }, []);

    return {
        phoneInput,
        setPhoneInput: updatePhoneInput,
        creatingPhone,
        startByPhone,
        resetPhone,
    };
}
