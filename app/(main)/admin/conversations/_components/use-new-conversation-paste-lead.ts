'use client';

import { useCallback, useEffect, useRef, useState, type ClipboardEvent } from 'react';

import { useToast } from '@/components/ui/use-toast';
import { useAiModelCatalog } from '@/components/ai/use-ai-model-catalog';
import { GEMINI_FLASH_LATEST_ALIAS } from '@/lib/ai/models';
import {
    createPasteLeadStatus,
    type PasteLeadImportStatus,
} from '@/lib/conversations/paste-lead-status';

import {
    createParsedLead,
    getPasteLeadImportCapability,
    importLeadFromText,
    parseLeadFromText,
    type ParsedLeadData,
} from '../actions';
import { buildLeadTextFromClipboardData, insertTextIntoTextareaValue } from './paste-lead-rich-text';
import {
    buildPasteLeadRecoverableImportError,
    buildInitialPasteLeadStatuses,
    buildNewConversationResultError,
    getPasteLeadRecoverableParsedLead,
    mergePasteLeadResultStatuses,
} from './new-conversation-dialog-helpers';

function createClientPasteLeadTraceId() {
    return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? `paste_lead_client_${crypto.randomUUID()}`
        : `paste_lead_client_${Date.now()}`;
}

export function useNewConversationPasteLead(args: {
    open: boolean;
    onConversationCreated?: (conversationId: string) => void;
    onCloseAfterStatusSettles: () => Promise<void>;
    setError: (error: string | null) => void;
}) {
    const { toast } = useToast();
    const { models: availableModels } = useAiModelCatalog();
    const [leadText, setLeadText] = useState('');
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [parsedLead, setParsedLead] = useState<ParsedLeadData | null>(null);
    const [pasteLeadCanImportOldCrmProperties, setPasteLeadCanImportOldCrmProperties] = useState(false);
    const [selectedPasteLeadModel, setSelectedPasteLeadModel] = useState('');
    const [pasteLeadStatuses, setPasteLeadStatuses] = useState<PasteLeadImportStatus[]>([]);
    const [creatingPasteLead, setCreatingPasteLead] = useState(false);
    const leadParseCacheRef = useRef<{
        key: string;
        result: Awaited<ReturnType<typeof parseLeadFromText>> | null;
        promise: Promise<Awaited<ReturnType<typeof parseLeadFromText>>> | null;
    }>({ key: '', result: null, promise: null });

    const clearPreviewCache = useCallback(() => {
        leadParseCacheRef.current = { key: '', result: null, promise: null };
    }, []);

    const requestLeadPreview = useCallback((text: string) => {
        const key = text.trim();
        if (!key || key.length < 5) {
            return Promise.resolve({ success: false as const, error: 'Text is too short' });
        }

        const cached = leadParseCacheRef.current;
        if (cached.key === key) {
            if (cached.result) return Promise.resolve(cached.result);
            if (cached.promise) return cached.promise;
        }

        const pasteLeadTraceId = createClientPasteLeadTraceId();
        const promise = parseLeadFromText(key, selectedPasteLeadModel || undefined, { pasteLeadTraceId })
            .then((res) => {
                if (leadParseCacheRef.current.key === key) {
                    leadParseCacheRef.current.result = res;
                    leadParseCacheRef.current.promise = null;
                }
                return res;
            })
            .catch((error) => {
                if (leadParseCacheRef.current.key === key) {
                    leadParseCacheRef.current.promise = null;
                }
                throw error;
            });

        leadParseCacheRef.current = {
            key,
            result: null,
            promise,
        };

        return promise;
    }, [selectedPasteLeadModel]);

    const importLeadUsingPreviewCache = useCallback(async (text: string, pasteLeadTraceId: string) => {
        const key = text.trim();
        const cached = leadParseCacheRef.current;

        if (cached.key === key) {
            const parsed = cached.result || (cached.promise ? await cached.promise : null);
            if (parsed?.success && parsed.data) {
                return createParsedLead(parsed.data, key, {
                    pasteLeadTraceId,
                    parseTrace: parsed.trace,
                });
            }
        }

        return importLeadFromText(key, selectedPasteLeadModel || undefined, { pasteLeadTraceId });
    }, [selectedPasteLeadModel]);

    const seedPasteLeadStatuses = useCallback((hasPreview: boolean) => {
        const traceId = createClientPasteLeadTraceId();
        setPasteLeadStatuses(buildInitialPasteLeadStatuses({ hasPreview, traceId }));
        return traceId;
    }, []);

    const applyImportResultStatuses = useCallback((res: any) => {
        setPasteLeadStatuses((current) => mergePasteLeadResultStatuses(current, res));
    }, []);

    const handleLeadTextareaPaste = useCallback((event: ClipboardEvent<HTMLTextAreaElement>) => {
        const html = event.clipboardData.getData('text/html');
        if (!html) return;

        const enrichedText = buildLeadTextFromClipboardData(event.clipboardData);
        if (!enrichedText.trim()) return;

        event.preventDefault();
        const nextText = insertTextIntoTextareaValue(
            leadText,
            enrichedText,
            event.currentTarget.selectionStart,
            event.currentTarget.selectionEnd
        );
        setLeadText(nextText);
        setParsedLead(null);
        setPasteLeadStatuses([]);
        clearPreviewCache();
    }, [clearPreviewCache, leadText]);

    const selectPasteLeadModel = useCallback((value: string) => {
        setSelectedPasteLeadModel(value);
        setParsedLead(null);
        clearPreviewCache();
    }, [clearPreviewCache]);

    const reviewLeadFirst = useCallback(async () => {
        if (!leadText.trim()) return;
        setIsAnalyzing(true);
        args.setError(null);
        try {
            const res = await requestLeadPreview(leadText);
            if (res.success && res.data) {
                setParsedLead(res.data);
            } else {
                args.setError(res.error || 'Failed to parse text');
            }
        } catch (error: any) {
            args.setError(error?.message || 'Failed to parse text');
        } finally {
            setIsAnalyzing(false);
        }
    }, [args, leadText, requestLeadPreview]);

    const importLead = useCallback(async () => {
        if (!leadText.trim()) return;
        setCreatingPasteLead(true);
        args.setError(null);
        const pasteLeadTraceId = seedPasteLeadStatuses(Boolean(leadParseCacheRef.current.result?.success));
        try {
            const res = await importLeadUsingPreviewCache(leadText, pasteLeadTraceId);
            applyImportResultStatuses(res);
            if (res.success && res.conversationId) {
                toast({
                    title: 'Lead imported',
                    description: res.backgroundJobsQueued?.length
                        ? 'Lead imported, enriching in background.'
                        : 'Conversation is ready.',
                });
                args.onConversationCreated?.(res.conversationId);
                await args.onCloseAfterStatusSettles();
            } else {
                const recoverableParsedLead = getPasteLeadRecoverableParsedLead(res);
                if (recoverableParsedLead) {
                    setParsedLead(recoverableParsedLead);
                    args.setError(buildPasteLeadRecoverableImportError(res));
                } else {
                    args.setError(res.error || 'Failed to import lead');
                }
            }
        } catch (error: any) {
            const message = buildNewConversationResultError(error, 'Paste Lead import request failed.');
            setPasteLeadStatuses((current) => [
                ...current,
                createPasteLeadStatus('paste_lead_import_failed', 'failed', {
                    pasteLeadTraceId,
                    detail: message,
                }),
            ]);
            args.setError(message);
        } finally {
            setCreatingPasteLead(false);
        }
    }, [applyImportResultStatuses, args, importLeadUsingPreviewCache, leadText, seedPasteLeadStatuses, toast]);

    const confirmParsedLeadImport = useCallback(async () => {
        if (!parsedLead) return;
        setCreatingPasteLead(true);
        args.setError(null);
        const pasteLeadTraceId = seedPasteLeadStatuses(true);

        try {
            const res = await createParsedLead(parsedLead, leadText, { pasteLeadTraceId });
            applyImportResultStatuses(res);
            if (res.success && res.conversationId) {
                toast({
                    title: 'Lead imported',
                    description: res.backgroundJobsQueued?.length
                        ? 'Lead imported, enriching in background.'
                        : 'Conversation is ready.',
                });
                args.onConversationCreated?.(res.conversationId);
                await args.onCloseAfterStatusSettles();
            } else {
                const recoverableParsedLead = getPasteLeadRecoverableParsedLead(res);
                if (recoverableParsedLead) {
                    setParsedLead(recoverableParsedLead);
                    args.setError(buildPasteLeadRecoverableImportError(res));
                } else {
                    args.setError(res.error || 'Failed to create conversation');
                }
            }
        } catch (error: any) {
            const message = buildNewConversationResultError(error, 'Paste Lead import request failed.');
            setPasteLeadStatuses((current) => [
                ...current,
                createPasteLeadStatus('paste_lead_import_failed', 'failed', {
                    pasteLeadTraceId,
                    detail: message,
                }),
            ]);
            args.setError(message);
        } finally {
            setCreatingPasteLead(false);
        }
    }, [applyImportResultStatuses, args, leadText, parsedLead, seedPasteLeadStatuses, toast]);

    const resetPasteLead = useCallback(() => {
        setLeadText('');
        setParsedLead(null);
        setPasteLeadStatuses([]);
        setIsAnalyzing(false);
        setCreatingPasteLead(false);
        setSelectedPasteLeadModel('');
        clearPreviewCache();
    }, [clearPreviewCache]);

    useEffect(() => {
        if (selectedPasteLeadModel) return;
        setSelectedPasteLeadModel(GEMINI_FLASH_LATEST_ALIAS);
    }, [selectedPasteLeadModel]);

    useEffect(() => {
        if (!args.open || parsedLead) return;
        const text = leadText.trim();
        if (text.length < 5) return;

        const timer = window.setTimeout(() => {
            void requestLeadPreview(text).catch(() => {});
        }, 250);

        return () => window.clearTimeout(timer);
    }, [args.open, leadText, parsedLead, requestLeadPreview]);

    useEffect(() => {
        if (!args.open) return;
        let cancelled = false;

        void getPasteLeadImportCapability()
            .then((res) => {
                if (cancelled) return;
                setPasteLeadCanImportOldCrmProperties(Boolean(res.success && res.capability?.canImportOldCrmProperties));
            })
            .catch(() => {
                if (cancelled) return;
                setPasteLeadCanImportOldCrmProperties(false);
            });

        return () => {
            cancelled = true;
        };
    }, [args.open]);

    return {
        leadText,
        setLeadText,
        parsedLead,
        setParsedLead,
        isAnalyzing,
        creatingPasteLead,
        pasteLeadCanImportOldCrmProperties,
        selectedPasteLeadModel,
        selectPasteLeadModel,
        pasteLeadStatuses,
        availableModels,
        handleLeadTextareaPaste,
        reviewLeadFirst,
        importLead,
        confirmParsedLeadImport,
        resetPasteLead,
    };
}
