'use client';

import { useCallback, useRef, useState } from 'react';

import { useToast } from '@/components/ui/use-toast';

import { startNewConversation } from '../actions';
import {
    buildNewConversationResultError,
    getNewConversationPhoneInputError,
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
    const pendingRef = useRef(false);

    const updatePhoneInput = useCallback((value: string) => {
        args.setError(null);
        const normalized = normalizeNewConversationStartInput(value);
        const digitCount = value.replace(/\D/g, '').length;
        setPhoneInput(
            normalized.startsWith('+') && digitCount >= 7
                ? normalized
                : value
        );
    }, [args]);

    const startByPhone = useCallback(async () => {
        if (pendingRef.current) return;

        const validationError = getNewConversationPhoneInputError(phoneInput);
        if (validationError) {
            args.setError(validationError);
            return;
        }

        const input = normalizeNewConversationStartInput(phoneInput);

        pendingRef.current = true;
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
            pendingRef.current = false;
            setCreatingPhone(false);
        }
    }, [args, phoneInput, toast]);

    const resetPhone = useCallback(() => {
        pendingRef.current = false;
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
