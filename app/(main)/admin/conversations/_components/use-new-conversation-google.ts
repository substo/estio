'use client';

import { useCallback, useState } from 'react';

import { useToast } from '@/components/ui/use-toast';
import {
    importNewGoogleContactAction,
    openOrStartConversationForContact,
    searchGoogleContactsAction,
} from '@/app/(main)/admin/contacts/actions';

export function useNewConversationGoogle(args: {
    locationId?: string;
    onConversationCreated?: (conversationId: string) => void;
    onClose: () => void;
    setError: (error: string | null) => void;
}) {
    const { toast } = useToast();
    const [googleSearch, setGoogleSearch] = useState('');
    const [googleResults, setGoogleResults] = useState<any[]>([]);
    const [loadingGoogle, setLoadingGoogle] = useState(false);
    const [googleNotConnected, setGoogleNotConnected] = useState(false);
    const [googleAuthExpired, setGoogleAuthExpired] = useState(false);
    const [creatingGoogle, setCreatingGoogle] = useState(false);

    const searchGoogle = useCallback(async () => {
        setLoadingGoogle(true);
        setGoogleNotConnected(false);
        try {
            const res = await searchGoogleContactsAction(googleSearch);
            if (res.success && res.data) {
                setGoogleResults(res.data);
            } else if (res.message === 'GOOGLE_NOT_CONNECTED') {
                setGoogleNotConnected(true);
            } else if (res.message === 'GOOGLE_AUTH_EXPIRED') {
                setGoogleAuthExpired(true);
            }
        } finally {
            setLoadingGoogle(false);
        }
    }, [googleSearch]);

    const importAndOpenGoogleContact = useCallback(async (resourceName: string) => {
        if (!args.locationId) return;

        setCreatingGoogle(true);
        args.setError(null);
        try {
            const res = await importNewGoogleContactAction(resourceName, args.locationId);
            if (res.success && res.contactId) {
                const startRes = await openOrStartConversationForContact(res.contactId);
                if (startRes.success && startRes.conversationId) {
                    toast({
                        title: startRes.isNew ? 'Conversation created' : 'Conversation opened',
                        description: res.message || 'Using the existing contact record.',
                    });
                    args.onConversationCreated?.(startRes.conversationId);
                    args.onClose();
                } else {
                    toast({ title: 'Contact ready, but chat failed', description: startRes.error, variant: 'destructive' });
                }
            } else {
                args.setError(res.message || 'Failed to import Google contact');
            }
        } catch (error: any) {
            args.setError(error.message);
        } finally {
            setCreatingGoogle(false);
        }
    }, [args, toast]);

    const resetGoogle = useCallback(() => {
        setGoogleSearch('');
        setGoogleResults([]);
        setGoogleNotConnected(false);
        setGoogleAuthExpired(false);
        setLoadingGoogle(false);
        setCreatingGoogle(false);
    }, []);

    return {
        googleSearch,
        setGoogleSearch,
        googleResults,
        loadingGoogle,
        googleNotConnected,
        googleAuthExpired,
        creatingGoogle,
        searchGoogle,
        importAndOpenGoogleContact,
        resetGoogle,
    };
}
