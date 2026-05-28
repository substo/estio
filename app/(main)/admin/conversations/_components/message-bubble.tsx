"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import type { MessageTranslationState, MessageTranslationVariant } from "@/lib/ghl/conversations";
import { selectActiveTranslation } from "@/lib/conversations/translation-view";
import {
    type SelectionBatchInput,
    type SelectionBatchItem,
} from "./message-selection-actions";
import {
    classifyMessageAttachments,
    deriveBodyVCardDownloadHref,
    deriveMediaUnavailableState,
    deriveSharedContactsFromMessageBody,
    normalizeMessageAttachments,
    type MessageAttachment,
    type NormalizedMessageAttachment,
} from "./message-bubble-attachment-actions";
import { MessageAudioAttachment } from "./message-audio-attachment";
import { MessageBubbleMediaStatus } from "./message-bubble-media-status";
import { MessageImageAttachments } from "./message-image-attachments";
import { MessageSharedContactCards } from "./message-shared-contact-cards";
import { MessageBubbleActionsMenu, useMessageBubbleActions } from "./message-bubble-actions-menu";
import { MessageBubbleBody, MessageBubbleTranslationActions } from "./message-bubble-body";
import {
    MessageBubbleChannelHeader,
    MessageBubbleEmailExpandFooter,
    MessageBubbleTimestampStatusRow,
} from "./message-bubble-chrome";
import { getWhatsAppFailureFallbackUiState } from "./conversation-message-actions";

const EMPTY_ATTACHMENTS: NormalizedMessageAttachment[] = [];

export interface MessageBubbleProps {
    message: {
        id: string;
        conversationId?: string;
        contactId?: string;
        body: string;
        type: string;
        direction: 'inbound' | 'outbound';
        status?: string;
        sendState?: string;
        outboxState?: {
            id?: string | null;
            status?: string | null;
            scheduledAt?: string | null;
            attemptCount?: number;
            lastError?: string | null;
            processedAt?: string | null;
            lockedAt?: string | null;
        } | null;
        dateAdded: string | Date; // Accept both for compatibility
        subject?: string;
        attachments?: MessageAttachment[];
        emailFrom?: string;
        emailTo?: string;
        source?: string;
        webBridgeMedia?: {
            status?: string | null;
            reason?: string | null;
            error?: string | null;
            meta?: {
                mimetype?: string | null;
                filename?: string | null;
                size?: number | null;
                type?: string | null;
                caption?: string | null;
                attemptedDownload?: boolean | null;
                inlined?: boolean | null;
            } | null;
            updatedAt?: string | null;
        } | null;
        contactName?: string;
        legacyCrmLead?: {
            status?: string;
            matched?: boolean;
            classification?: string | null;
            senderMatchMode?: string | null;
            reason?: string | null;
            error?: string | null;
            attempts?: number;
            processedAt?: string | null;
            processedContactId?: string | null;
            processedConversationId?: string | null;
            legacyLeadUrl?: string | null;
            canProcess?: boolean;
            canReprocess?: boolean;
            detectionEnabled?: boolean;
        };
        detectedLanguage?: string | null;
        detectedLanguageConfidence?: number | null;
        translation?: MessageTranslationState | null;
        translations?: MessageTranslationVariant[];
    };
    locationId?: string;
    contactPhone?: string;
    contactEmail?: string;
    contactName?: string; // Fallback contact name if message.contactName missing
    aiModel?: string | null;
    enableMountAnimation?: boolean;
    selectionBatch?: SelectionBatchItem[];
    onAddSelectionToBatch?: (item: SelectionBatchInput) => { added: boolean; total: number } | void;
    onRemoveSelectionBatchItem?: (id: string) => void;
    onClearSelectionBatch?: () => void;
    onRefetchMedia?: (messageId: string) => void | Promise<void>;
    onRequestTranscript?: (
        messageId: string,
        attachmentId: string,
        options?: { force?: boolean }
    ) => void | Promise<void>;
    onExtractViewingNotes?: (
        messageId: string,
        attachmentId: string,
        options?: { force?: boolean }
    ) => void | Promise<void>;
    onRetryTranscript?: (messageId: string, attachmentId: string) => void | Promise<void>;
    onResendMessage?: (messageId: string) => void | Promise<void>;
    onSendSmsFallback?: (messageId: string) => void | Promise<void>;
    smsRelayEnabled?: boolean;
    translationReadEnabled?: boolean;
    threadTranslationMode?: "original" | "translated";
    preferredDisplayLanguage?: string | null;
    onTranslateMessage?: (messageId: string, targetLanguage?: string | null) => Promise<{
        success: boolean;
        error?: string;
        translation?: MessageTranslationVariant | null;
    }>;
}

export function MessageBubble({
    message,
    locationId,
    contactPhone,
    contactEmail: _contactEmail,
    contactName,
    aiModel,
    enableMountAnimation = true,
    selectionBatch,
    onAddSelectionToBatch,
    onRemoveSelectionBatchItem,
    onClearSelectionBatch,
    onRefetchMedia,
    onRequestTranscript,
    onExtractViewingNotes,
    onRetryTranscript,
    onResendMessage,
    onSendSmsFallback,
    smsRelayEnabled = false,
    translationReadEnabled = false,
    threadTranslationMode = "original",
    preferredDisplayLanguage,
    onTranslateMessage,
}: MessageBubbleProps) {
    const isOutbound = message.direction === 'outbound';
    const isEmail = (message.type || '').toUpperCase().includes('EMAIL');
    const isSMS = (message.type || '').toUpperCase().includes('SMS') || (message.type || '').toUpperCase().includes('PHONE');
    const isWhatsApp = (message.type || '').toUpperCase().includes('WHATSAPP');
    const [isExpanded, setIsExpanded] = useState(!isEmail); // Emails collapsed by default
    const [isRefetchingMedia, setIsRefetchingMedia] = useState(false);
    const [transcriptActionAttachmentId, setTranscriptActionAttachmentId] = useState<string | null>(null);
    const [extractActionAttachmentId, setExtractActionAttachmentId] = useState<string | null>(null);
    const [expandedTranscriptIds, setExpandedTranscriptIds] = useState<Record<string, boolean>>({});
    const resolvedMessageTranslation = selectActiveTranslation(message.translations || [], preferredDisplayLanguage || null) || message.translation?.active || null;
    const [activeTranslation, setActiveTranslation] = useState<MessageTranslationVariant | null>(resolvedMessageTranslation);
    const [translationViewMode, setTranslationViewMode] = useState<"thread" | "original" | "translated">("thread");
    const [isTranslatingMessage, setIsTranslatingMessage] = useState(false);
    const attachments = useMemo(() => normalizeMessageAttachments(message.attachments), [message.attachments]);
    const bodySharedContacts = useMemo(
        () => deriveSharedContactsFromMessageBody(message.body || ""),
        [message.body]
    );
    const bodyVCardDownloadHref = useMemo(() => deriveBodyVCardDownloadHref(message.body), [message.body]);
    const sharedContacts = useMemo(() => {
        const attachmentSharedContacts = attachments.flatMap((attachment) => attachment.sharedContacts || []);
        return [...bodySharedContacts, ...attachmentSharedContacts];
    }, [attachments, bodySharedContacts]);
    const isContactMessage = !!sharedContacts && sharedContacts.length > 0;
    const router = useRouter(); 
    const {
        contentRef,
        contextMenuButtonRef,
        handleContextMenuAction,
        handleEmailSelectionChange,
        selectionActions,
    } = useMessageBubbleActions({
        messageId: message.id,
        conversationId: message.conversationId || null,
        body: message.body || "",
        isEmail,
        isContactMessage,
        isExpanded,
        translationReset: {
            translation: message.translation,
            translations: message.translations,
            preferredDisplayLanguage,
        },
        aiModel: aiModel || null,
        selectionBatch,
        onAddSelectionToBatch,
        onRemoveSelectionBatchItem,
        onClearSelectionBatch,
    });

    useEffect(() => {
        setExpandedTranscriptIds({});
        setTranscriptActionAttachmentId(null);
        setExtractActionAttachmentId(null);
        setActiveTranslation(selectActiveTranslation(message.translations || [], preferredDisplayLanguage || null) || message.translation?.active || null);
        setTranslationViewMode("thread");
        setIsTranslatingMessage(false);
    }, [message.id, isExpanded, message.translation, message.translations, preferredDisplayLanguage]);

    useEffect(() => {
        setActiveTranslation(selectActiveTranslation(message.translations || [], preferredDisplayLanguage || null) || message.translation?.active || null);
    }, [message.translation, message.translations, preferredDisplayLanguage]);

    const {
        imageAttachments,
        audioAttachments,
        contactAttachments,
        fileAttachments,
    } = useMemo(() => classifyMessageAttachments(attachments), [attachments]);
    const hasLikelyMediaPlaceholder = ["[Audio]", "[Image]", "[Media]", "[Document]", "[Contact]"].includes(String(message.body || "").trim());
    const webBridgeMedia = message.webBridgeMedia || null;
    const hasUnstoredWebBridgeMedia = deriveMediaUnavailableState({
        isWhatsApp,
        source: message.source,
        webBridgeMedia,
        attachments,
    });
    const hasRenderableMediaAttachment = imageAttachments.length > 0 || audioAttachments.length > 0 || contactAttachments.length > 0 || fileAttachments.length > 0;
    const canRefetchMedia = !!onRefetchMedia && isWhatsApp && !isContactMessage && (hasRenderableMediaAttachment || hasLikelyMediaPlaceholder || hasUnstoredWebBridgeMedia);
    const failureFallbackUi = useMemo(() => getWhatsAppFailureFallbackUiState({
        message,
        smsRelayEnabled,
        contactPhone,
    }), [contactPhone, message, smsRelayEnabled]);

    const getDownloadUrl = useCallback((url: string) => {
        try {
            if (url.includes("/api/media/attachments/")) {
                const parsed = new URL(url, "http://localhost");
                parsed.searchParams.set("download", "1");
                return `${parsed.pathname}${parsed.search}`;
            }
        } catch {
            // Fall through to original URL
        }
        return url;
    }, []);

    const handleRefetchMedia = useCallback(async (e: React.MouseEvent<HTMLButtonElement>) => {
        e.stopPropagation();
        if (!onRefetchMedia || isRefetchingMedia) return;

        setIsRefetchingMedia(true);
        try {
            await Promise.resolve(onRefetchMedia(message.id));
        } finally {
            setIsRefetchingMedia(false);
        }
    }, [isRefetchingMedia, message.id, onRefetchMedia]);

    const isTranscriptExpanded = useCallback((attachmentId?: string, fallbackIndex?: number) => {
        const key = attachmentId || `${message.id}:audio:${fallbackIndex || 0}`;
        return !!expandedTranscriptIds[key];
    }, [expandedTranscriptIds, message.id]);

    const toggleTranscriptExpanded = useCallback((attachmentId?: string, fallbackIndex?: number) => {
        const key = attachmentId || `${message.id}:audio:${fallbackIndex || 0}`;
        setExpandedTranscriptIds((prev) => ({ ...prev, [key]: !prev[key] }));
    }, [message.id]);

    const handleRequestTranscript = useCallback(async (
        e: React.MouseEvent<HTMLButtonElement>,
        attachmentId?: string,
        options?: { force?: boolean }
    ) => {
        e.stopPropagation();
        if (!attachmentId || transcriptActionAttachmentId) return;

        const canUseOnDemand = !!onRequestTranscript;
        const canUseRetryFallback = !!onRetryTranscript;
        if (!canUseOnDemand && !canUseRetryFallback) return;

        setTranscriptActionAttachmentId(attachmentId);
        try {
            if (canUseOnDemand) {
                await Promise.resolve(onRequestTranscript(message.id, attachmentId, options));
                return;
            }
            if (canUseRetryFallback) {
                await Promise.resolve(onRetryTranscript(message.id, attachmentId));
            }
        } finally {
            setTranscriptActionAttachmentId(null);
        }
    }, [message.id, onRequestTranscript, onRetryTranscript, transcriptActionAttachmentId]);

    const handleExtractViewingNotes = useCallback(async (
        e: React.MouseEvent<HTMLButtonElement>,
        attachmentId?: string,
        options?: { force?: boolean }
    ) => {
        e.stopPropagation();
        if (!onExtractViewingNotes || !attachmentId || extractActionAttachmentId) return;

        setExtractActionAttachmentId(attachmentId);
        try {
            await Promise.resolve(onExtractViewingNotes(message.id, attachmentId, options));
        } finally {
            setExtractActionAttachmentId(null);
        }
    }, [extractActionAttachmentId, message.id, onExtractViewingNotes]);

    const canTranslateMessage = translationReadEnabled
        && !isOutbound
        && !!onTranslateMessage
        && String(message.body || "").trim().length > 0;

    const handleTranslateMessage = useCallback(async () => {
        if (!onTranslateMessage || isTranslatingMessage) return;
        setIsTranslatingMessage(true);
        try {
            const result = await onTranslateMessage(message.id, preferredDisplayLanguage || null);
            if (!result?.success || !result?.translation) return;
            setActiveTranslation(result.translation);
            setTranslationViewMode("translated");
        } finally {
            setIsTranslatingMessage(false);
        }
    }, [isTranslatingMessage, message.id, onTranslateMessage, preferredDisplayLanguage]);

    const handleToggleTranslationViewMode = useCallback(() => {
        setTranslationViewMode((current) => {
            const effectiveViewMode = current === "thread" ? threadTranslationMode : current;
            return effectiveViewMode === "translated" ? "original" : "translated";
        });
    }, [threadTranslationMode]);
    const handleEmailExpandToggle = useCallback(() => {
        setIsExpanded((current) => !current);
    }, []);

    return (
        <div
            className={cn(
                "flex flex-col max-w-[85%] min-w-0 overflow-hidden",
                enableMountAnimation && "animate-in fade-in slide-in-from-bottom-2 duration-300",
                isOutbound ? "ml-auto items-end" : "mr-auto items-start"
            )}
        >
            <div
                className={cn(
                    "group relative px-4 py-3 rounded-2xl text-sm shadow-sm overflow-hidden w-full transition-all duration-200",
                    isOutbound
                        ? "bg-blue-600 text-white rounded-tr-none"
                        : "bg-white text-gray-800 border rounded-tl-none",
                    isEmail && "border-l-4 border-l-orange-400 p-0 overflow-hidden", // Email styling distinction
                    isEmail && !isExpanded && "cursor-pointer hover:shadow-md hover:border-l-orange-500" // Clickable indication
                )}
                onClick={() => {
                    if (isEmail && !isExpanded) {
                        setIsExpanded(true);
                    }
                }}
            >
                <MessageBubbleActionsMenu
                    isOutbound={isOutbound}
                    canShow={!(isEmail && !isExpanded)}
                    hasConversation={!!message.conversationId}
                    canTranslate={!!onTranslateMessage}
                    canAddSelectionToBatch={!!onAddSelectionToBatch}
                    onTranslateMessage={handleTranslateMessage}
                    contextMenuButtonRef={contextMenuButtonRef}
                    onContextMenuAction={handleContextMenuAction}
                />
                <MessageBubbleChannelHeader
                    message={message}
                    isEmail={isEmail}
                    isSMS={isSMS}
                    isWhatsApp={isWhatsApp}
                    isOutbound={isOutbound}
                    isExpanded={isExpanded}
                    contactName={contactName}
                    contactPhone={contactPhone}
                />

                {/* Content Area */}
                <div className={cn(
                    "w-full max-w-full overflow-x-hidden transition-all duration-300 ease-in-out relative break-words [overflow-wrap:anywhere]",
                    isEmail ? "bg-white text-black" : "", // Force white background for emails
                    isEmail && "p-4",
                    !isEmail && "whitespace-pre-wrap [word-break:break-word]"
                )}
                    ref={contentRef}
                >
                    {isContactMessage && sharedContacts ? (
                        <MessageSharedContactCards
                            sharedContacts={sharedContacts}
                            bodyVCardDownloadHref={bodyVCardDownloadHref}
                            isOutbound={isOutbound}
                            messageId={message.id}
                            locationId={locationId}
                            router={router}
                        />
                    ) : (
                        <MessageBubbleBody
                            body={message.body}
                            isEmail={isEmail}
                            isExpanded={isExpanded}
                            isOutbound={isOutbound}
                            activeTranslation={activeTranslation}
                            translationViewMode={translationViewMode}
                            threadTranslationMode={threadTranslationMode}
                            onEmailSelectionChange={handleEmailSelectionChange}
                        />
                    )}
                </div>

                <MessageBubbleTranslationActions
                    isEmail={isEmail}
                    isOutbound={isOutbound}
                    activeTranslation={activeTranslation}
                    translationViewMode={translationViewMode}
                    threadTranslationMode={threadTranslationMode}
                    canTranslateMessage={canTranslateMessage}
                    isTranslatingMessage={isTranslatingMessage}
                    onTranslateMessage={handleTranslateMessage}
                    onToggleTranslationViewMode={handleToggleTranslationViewMode}
                />

                {/* Attachments */}
                {attachments.length > 0 && (
                    <div className={cn("px-4 pb-2 space-y-1 mt-2", isEmail && "bg-gray-50 pt-2 border-t")}>
                        <MessageImageAttachments
                            imageAttachments={imageAttachments}
                            getDownloadUrl={getDownloadUrl}
                        />
                        {audioAttachments.map((attachment, i) => (
                            <MessageAudioAttachment
                                key={`audio-${i}-${attachment.url}`}
                                attachment={attachment}
                                index={i}
                                messageId={message.id}
                                isOutbound={isOutbound}
                                isEmail={isEmail}
                                transcriptActionAttachmentId={transcriptActionAttachmentId}
                                extractActionAttachmentId={extractActionAttachmentId}
                                isTranscriptExpanded={isTranscriptExpanded}
                                toggleTranscriptExpanded={toggleTranscriptExpanded}
                                handleRequestTranscript={handleRequestTranscript}
                                handleExtractViewingNotes={handleExtractViewingNotes}
                                getDownloadUrl={getDownloadUrl}
                                onRequestTranscript={onRequestTranscript}
                                onRetryTranscript={onRetryTranscript}
                                onExtractViewingNotes={onExtractViewingNotes}
                            />
                        ))}
                        <MessageBubbleMediaStatus
                            contactAttachments={contactAttachments}
                            fileAttachments={fileAttachments}
                            webBridgeMedia={webBridgeMedia}
                            hasUnstoredWebBridgeMedia={false}
                            canRefetchMedia={false}
                            isRefetchingMedia={isRefetchingMedia}
                            handleRefetchMedia={handleRefetchMedia}
                            getDownloadUrl={getDownloadUrl}
                            attachmentsLength={attachments.length}
                            isOutbound={isOutbound}
                            isEmail={isEmail}
                        />
                    </div>
                )}

                <MessageBubbleMediaStatus
                    contactAttachments={EMPTY_ATTACHMENTS}
                    fileAttachments={EMPTY_ATTACHMENTS}
                    webBridgeMedia={webBridgeMedia}
                    hasUnstoredWebBridgeMedia={hasUnstoredWebBridgeMedia}
                    canRefetchMedia={canRefetchMedia}
                    isRefetchingMedia={isRefetchingMedia}
                    handleRefetchMedia={handleRefetchMedia}
                    getDownloadUrl={getDownloadUrl}
                    attachmentsLength={attachments.length}
                    isOutbound={isOutbound}
                    isEmail={isEmail}
                />

                <MessageBubbleEmailExpandFooter
                    isEmail={isEmail}
                    isExpanded={isExpanded}
                    onExpandToggle={handleEmailExpandToggle}
                />
            </div>

                <MessageBubbleTimestampStatusRow
                    message={message}
                isEmail={isEmail}
                isSMS={isSMS}
                isWhatsApp={isWhatsApp}
                isOutbound={isOutbound}
                    contactName={contactName}
                    onResendMessage={onResendMessage}
                    failureFallbackLabel={failureFallbackUi.label}
                    smsFallbackLabel={failureFallbackUi.smsFallbackLabel}
                    smsFallbackUnavailableLabel={failureFallbackUi.smsFallbackUnavailableLabel}
                    onSendSmsFallback={onSendSmsFallback}
                />

            {selectionActions}
        </div>
    );
}
