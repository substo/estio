'use client';

import { useCallback, useMemo, useState } from 'react';

import { fetchWhatsAppChats, startNewConversation } from '../actions';
import {
    buildNewConversationResultError,
    resolveWhatsAppChatIdentity,
    type WhatsAppChat,
} from './new-conversation-dialog-helpers';

export function useNewConversationWhatsAppPicker(args: {
    onConversationCreated?: (conversationId: string) => void;
    onClose: () => void;
    setError: (error: string | null) => void;
}) {
    const [chats, setChats] = useState<WhatsAppChat[]>([]);
    const [search, setSearch] = useState('');
    const [loadingChats, setLoadingChats] = useState(false);
    const [chatsLoaded, setChatsLoaded] = useState(false);
    const [creatingWhatsApp, setCreatingWhatsApp] = useState(false);

    const loadChats = useCallback(async () => {
        if (chatsLoaded) return;

        setLoadingChats(true);
        try {
            const res = await fetchWhatsAppChats();
            if (res.success && res.chats) {
                setChats(res.chats);
            } else {
                args.setError(res.error || 'Failed to load chats');
            }
            setChatsLoaded(true);
        } catch (error: any) {
            args.setError(buildNewConversationResultError(error, error?.message || 'Failed to load chats'));
        } finally {
            setLoadingChats(false);
        }
    }, [args, chatsLoaded]);

    const pickChat = useCallback(async (chat: WhatsAppChat) => {
        setCreatingWhatsApp(true);
        args.setError(null);

        try {
            const identity = resolveWhatsAppChatIdentity(chat);
            if (!identity) {
                args.setError('This WhatsApp chat does not expose a phone or bridge identity yet.');
                return;
            }

            const res = await startNewConversation(identity);
            if (res.success && res.conversationId) {
                args.onConversationCreated?.(res.conversationId);
                args.onClose();
            } else {
                args.setError(res.error || 'Failed to create conversation');
            }
        } catch (error: any) {
            args.setError(buildNewConversationResultError(error));
        } finally {
            setCreatingWhatsApp(false);
        }
    }, [args]);

    const filteredChats = useMemo(() => chats.filter((chat) =>
        chat.name.toLowerCase().includes(search.toLowerCase()) ||
        chat.phone.includes(search)
    ), [chats, search]);

    const resetWhatsAppPicker = useCallback(() => {
        setSearch('');
        setChats([]);
        setChatsLoaded(false);
        setLoadingChats(false);
        setCreatingWhatsApp(false);
    }, []);

    return {
        chats,
        filteredChats,
        search,
        setSearch,
        loadingChats,
        chatsLoaded,
        creatingWhatsApp,
        loadChats,
        pickChat,
        resetWhatsAppPicker,
    };
}
