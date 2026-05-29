'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useToast } from '@/components/ui/use-toast';
import {
    importNewGoogleContactAction,
    openOrStartConversationForContact,
    searchGoogleContactsAction,
} from '@/app/(main)/admin/contacts/actions';
import {
    buildGoogleRowOutcomeLabel,
    getGoogleConnectionErrorMessage,
    shouldApplyGoogleSearchResult,
    type GoogleContactImportOutcome,
    type GoogleContactRowOutcome,
    type GoogleContactSearchResult,
    type NewConversationCreatedResult,
} from './new-conversation-dialog-helpers';

export function useNewConversationGoogle(args: {
    locationId?: string;
    onConversationCreated?: (conversationId: string, result?: NewConversationCreatedResult) => void;
    onClose: () => void;
    setError: (error: string | null) => void;
}) {
    const { locationId, onConversationCreated, onClose, setError } = args;
    const { toast } = useToast();
    const [googleSearch, setGoogleSearchState] = useState('');
    const [googleResults, setGoogleResults] = useState<GoogleContactSearchResult[]>([]);
    const [loadingGoogle, setLoadingGoogle] = useState(false);
    const [googleNotConnected, setGoogleNotConnected] = useState(false);
    const [googleAuthExpired, setGoogleAuthExpired] = useState(false);
    const [creatingGoogle, setCreatingGoogle] = useState(false);
    const [googleSearched, setGoogleSearched] = useState(false);
    const [googleRowOutcomes, setGoogleRowOutcomes] = useState<Record<string, GoogleContactRowOutcome>>({});
    const googleSearchRequestIdRef = useRef(0);

    const setGoogleSearch = useCallback((value: string) => {
        googleSearchRequestIdRef.current += 1;
        setGoogleSearchState(value);
        setGoogleRowOutcomes({});
    }, []);

    const searchGoogle = useCallback(async (query = googleSearch) => {
        const trimmedQuery = query.trim();
        const requestId = googleSearchRequestIdRef.current + 1;
        googleSearchRequestIdRef.current = requestId;

        if (!trimmedQuery) {
            setGoogleResults([]);
            setGoogleSearched(false);
            setLoadingGoogle(false);
            setGoogleNotConnected(false);
            setGoogleAuthExpired(false);
            return;
        }

        setLoadingGoogle(true);
        setGoogleSearched(true);
        setGoogleNotConnected(false);
        setGoogleAuthExpired(false);
        setError(null);
        try {
            const res = await searchGoogleContactsAction(trimmedQuery);
            if (!shouldApplyGoogleSearchResult(requestId, googleSearchRequestIdRef.current)) return;

            if (res.success && res.data) {
                setGoogleResults(res.data);
            } else if (res.message === 'GOOGLE_NOT_CONNECTED') {
                setGoogleNotConnected(true);
                setGoogleResults([]);
                setError(getGoogleConnectionErrorMessage(res.message));
            } else if (res.message === 'GOOGLE_AUTH_EXPIRED') {
                setGoogleAuthExpired(true);
                setGoogleResults([]);
                setError(getGoogleConnectionErrorMessage(res.message));
            } else {
                setGoogleResults([]);
                setError(getGoogleConnectionErrorMessage(res.message || 'Search failed. Please try again.'));
            }
        } catch (error: any) {
            if (shouldApplyGoogleSearchResult(requestId, googleSearchRequestIdRef.current)) {
                setGoogleResults([]);
                setError(error?.message || 'Search failed. Please try again.');
            }
        } finally {
            if (shouldApplyGoogleSearchResult(requestId, googleSearchRequestIdRef.current)) {
                setLoadingGoogle(false);
            }
        }
    }, [googleSearch, setError]);

    useEffect(() => {
        const trimmedQuery = googleSearch.trim();
        if (!trimmedQuery) {
            googleSearchRequestIdRef.current += 1;
            setGoogleResults([]);
            setGoogleSearched(false);
            setLoadingGoogle(false);
            setGoogleNotConnected(false);
            setGoogleAuthExpired(false);
            return;
        }

        const timeoutId = window.setTimeout(() => {
            void searchGoogle(trimmedQuery);
        }, 350);

        return () => window.clearTimeout(timeoutId);
    }, [googleSearch, searchGoogle]);

    const importAndOpenGoogleContact = useCallback(async (resourceName: string) => {
        if (!locationId) return;

        setCreatingGoogle(true);
        setError(null);
        setGoogleRowOutcomes((prev) => ({ ...prev, [resourceName]: {} }));
        try {
            const res = await importNewGoogleContactAction(resourceName, locationId);
            if (res.success && res.contactId) {
                const startRes = await openOrStartConversationForContact(res.contactId);
                if (startRes.success && startRes.conversationId) {
                    const importResult = res as any;
                    const rowOutcome: GoogleContactRowOutcome = {
                        importOutcome: (importResult.importOutcome || (importResult.existing ? 'existing' : 'imported')) as GoogleContactImportOutcome,
                        conversationOutcome: startRes.isNew ? 'created' : 'opened',
                    };
                    setGoogleRowOutcomes((prev) => ({ ...prev, [resourceName]: rowOutcome }));
                    toast({
                        title: buildGoogleRowOutcomeLabel(rowOutcome) || (startRes.isNew ? 'Conversation created' : 'Conversation opened'),
                        description: res.message || 'Using the contact record from Google.',
                    });
                    onConversationCreated?.(startRes.conversationId);
                    onClose();
                } else {
                    const error = startRes.error || 'Conversation start failed. Please try again.';
                    setGoogleRowOutcomes((prev) => ({ ...prev, [resourceName]: { error } }));
                    toast({ title: 'Contact ready, but conversation failed', description: error, variant: 'destructive' });
                }
            } else {
                const error = getGoogleConnectionErrorMessage(res.message || 'Failed to import Google contact');
                if (res.message === 'GOOGLE_NOT_CONNECTED') setGoogleNotConnected(true);
                if (res.message === 'GOOGLE_AUTH_EXPIRED') setGoogleAuthExpired(true);
                setGoogleRowOutcomes((prev) => ({ ...prev, [resourceName]: { error } }));
                setError(error);
            }
        } catch (error: any) {
            const message = error?.message || 'Import failed. Please try again.';
            setGoogleRowOutcomes((prev) => ({ ...prev, [resourceName]: { error: message } }));
            setError(message);
        } finally {
            setCreatingGoogle(false);
        }
    }, [locationId, onClose, onConversationCreated, setError, toast]);

    const resetGoogle = useCallback(() => {
        googleSearchRequestIdRef.current += 1;
        setGoogleSearchState('');
        setGoogleResults([]);
        setGoogleNotConnected(false);
        setGoogleAuthExpired(false);
        setLoadingGoogle(false);
        setCreatingGoogle(false);
        setGoogleSearched(false);
        setGoogleRowOutcomes({});
    }, []);

    return {
        googleSearch,
        setGoogleSearch,
        googleResults,
        loadingGoogle,
        googleNotConnected,
        googleAuthExpired,
        creatingGoogle,
        googleSearched,
        googleRowOutcomes,
        searchGoogle,
        importAndOpenGoogleContact,
        resetGoogle,
    };
}
