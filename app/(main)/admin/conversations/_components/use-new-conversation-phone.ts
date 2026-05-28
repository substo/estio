'use client';

import { useCallback, useState } from 'react';

import { startNewConversation } from '../actions';
import {
    buildNewConversationResultError,
    normalizeNewConversationStartInput,
} from './new-conversation-dialog-helpers';

export function useNewConversationPhone(args: {
    onConversationCreated?: (conversationId: string) => void;
    onClose: () => void;
    setError: (error: string | null) => void;
}) {
    const [phoneInput, setPhoneInput] = useState('');
    const [creatingPhone, setCreatingPhone] = useState(false);

    const startByPhone = useCallback(async () => {
        const input = normalizeNewConversationStartInput(phoneInput);
        if (!input) return;

        setCreatingPhone(true);
        args.setError(null);

        try {
            const res = await startNewConversation(input);
            if (res.success && res.conversationId) {
                args.onConversationCreated?.(res.conversationId);
                args.onClose();
            } else {
                args.setError(res.error || 'Failed to create conversation');
            }
        } catch (error: any) {
            args.setError(buildNewConversationResultError(error));
        } finally {
            setCreatingPhone(false);
        }
    }, [args, phoneInput]);

    const resetPhone = useCallback(() => {
        setPhoneInput('');
        setCreatingPhone(false);
    }, []);

    return {
        phoneInput,
        setPhoneInput,
        creatingPhone,
        startByPhone,
        resetPhone,
    };
}
