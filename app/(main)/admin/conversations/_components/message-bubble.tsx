"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Mail, Smartphone, Paperclip, ExternalLink, ChevronDown, ChevronUp, ArrowRight, Download, Maximize2, RefreshCw, Clock, Check, CheckCheck, AlertTriangle, UserPlus, User, Phone as PhoneIcon, Building2, MailIcon, ExternalLink as ExternalLinkIcon, MessageCirclePlus, MoreHorizontal, Clipboard, Search, FileText, Wand2, ListPlus, ListTodo, Sparkles, Home, Languages } from "lucide-react";
import { saveSharedContact, openOrStartConversationForContact, checkSharedContactsSavedState } from "@/app/(main)/admin/contacts/actions";
import type { SharedContactInfo } from "@/lib/whatsapp/evolution-media";
import { format } from "date-fns";
import { EmailFrame, type EmailFrameSelection } from "./email-frame";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { LinkifiedText } from "./linkified-text";
import type { MessageTranslationState, MessageTranslationVariant } from "@/lib/ghl/conversations";
import { selectActiveTranslation } from "@/lib/conversations/translation-view";
import {
    MessageSelectionActions,
    type MessageSelectionActionTarget,
    type SelectionBatchInput,
    type SelectionBatchItem,
} from "./message-selection-actions";

type MessageAttachment = string | {
    id?: string;
    url: string;
    mimeType?: string | null;
    fileName?: string | null;
    transcript?: {
        status: "pending" | "processing" | "completed" | "failed";
        text?: string | null;
        error?: string | null;
        model?: string | null;
        provider?: string | null;
        updatedAt?: string | null;
        restricted?: boolean;
        extraction?: {
            status: "pending" | "processing" | "completed" | "failed";
            payload?: {
                prospects?: string[];
                requirements?: string[];
                budget?: string | null;
                locations?: string[];
                objections?: string[];
                nextActions?: string[];
            } | null;
            error?: string | null;
            model?: string | null;
            provider?: string | null;
            updatedAt?: string | null;
            restricted?: boolean;
        } | null;
    } | null;
};

const CONTACTS_DATA_SEPARATOR = "\n---CONTACTS_DATA---\n";

/**
 * Parse shared contact data from a message body that contains the structured separator.
 * Returns null if the message doesn't contain contact data.
 */
function parseSharedContactsFromBody(body: string): SharedContactInfo[] | null {
    if (!body || !body.includes("---CONTACTS_DATA---")) return null;
    const separatorIndex = body.indexOf(CONTACTS_DATA_SEPARATOR);
    if (separatorIndex < 0) return null;
    const jsonPart = body.slice(separatorIndex + CONTACTS_DATA_SEPARATOR.length).trim();
    if (!jsonPart) return null;
    try {
        const parsed = JSON.parse(jsonPart);
        if (Array.isArray(parsed) && parsed.length > 0) {
            return parsed as SharedContactInfo[];
        }
    } catch {
        // Not valid JSON — fallback
    }
    return null;
}

/**
 * Get the human-readable prefix from a contact message body (before the separator).
 */
function getContactBodyReadablePart(body: string): string {
    if (!body.includes("---CONTACTS_DATA---")) return body;
    const separatorIndex = body.indexOf(CONTACTS_DATA_SEPARATOR);
    return separatorIndex >= 0 ? body.slice(0, separatorIndex).trim() : body;
}

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
    const [selectedImageIndex, setSelectedImageIndex] = useState<number | null>(null);
    const [selectionTarget, setSelectionTarget] = useState<MessageSelectionActionTarget | null>(null);
    const [isRefetchingMedia, setIsRefetchingMedia] = useState(false);
    const [transcriptActionAttachmentId, setTranscriptActionAttachmentId] = useState<string | null>(null);
    const [extractActionAttachmentId, setExtractActionAttachmentId] = useState<string | null>(null);
    const [expandedTranscriptIds, setExpandedTranscriptIds] = useState<Record<string, boolean>>({});
    const resolvedMessageTranslation = selectActiveTranslation(message.translations || [], preferredDisplayLanguage || null) || message.translation?.active || null;
    const [activeTranslation, setActiveTranslation] = useState<MessageTranslationVariant | null>(resolvedMessageTranslation);
    const [translationViewMode, setTranslationViewMode] = useState<"thread" | "original" | "translated">("thread");
    const [isTranslatingMessage, setIsTranslatingMessage] = useState(false);
    const contentRef = useRef<HTMLDivElement>(null);
    const sharedContacts = parseSharedContactsFromBody(message.body || "");
    const isContactMessage = !!sharedContacts && sharedContacts.length > 0;
    const [contactSaveStates, setContactSaveStates] = useState<Record<number, { saving?: boolean; saved?: boolean; contactId?: string; conversationId?: string; isNew?: boolean; error?: string }>>({}); 
    const [contactOpenMessageStates, setContactOpenMessageStates] = useState<Record<number, boolean>>({});
    const [isHydratingContactStates, setIsHydratingContactStates] = useState<boolean>(isContactMessage);
    const router = useRouter(); 
    const [pendingAction, setPendingAction] = useState<string | null>(null);
    const contextMenuButtonRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (!isContactMessage || !locationId || !message.body) {
            setIsHydratingContactStates(false);
            return;
        }

        const parsedContacts = parseSharedContactsFromBody(message.body);
        if (!parsedContacts || parsedContacts.length === 0) {
            setIsHydratingContactStates(false);
            return;
        }
        
        const phoneNumbers = parsedContacts.map(c => c.phoneNumber).filter(Boolean) as string[];
        if (phoneNumbers.length === 0) {
            setIsHydratingContactStates(false);
            return;
        }

        let isMounted = true;
        setIsHydratingContactStates(true);
        void checkSharedContactsSavedState(locationId, phoneNumbers).then(res => {
            if (!isMounted) return;
            if (res.success && res.states) {
                setContactSaveStates(prev => {
                    const newState = { ...prev };
                    parsedContacts.forEach((c, idx) => {
                        if (c.phoneNumber && res.states![c.phoneNumber]?.saved) {
                            newState[idx] = {
                                ...newState[idx],
                                saved: true,
                                contactId: res.states![c.phoneNumber].contactId,
                                conversationId: res.states![c.phoneNumber].conversationId
                            };
                        }
                    });
                    return newState;
                });
            }
            setIsHydratingContactStates(false);
        }).catch(() => {
            if (isMounted) setIsHydratingContactStates(false);
        });

        return () => { isMounted = false; };
    }, [isContactMessage, locationId, message.body]);

    useEffect(() => {
        setSelectionTarget(null);
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

    // Helper to detect if content is rich HTML (heuristic)
    const isRichHtml = message.body && (message.body.includes('<div') || message.body.includes('<html') || message.body.includes('<table'));

    // Helper to strip HTML for snippet
    const getSnippet = (html: string) => {
        if (!html) return "";
        const text = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '') // Remove style blocks
            .replace(/<[^>]*>/g, ' ') // Replace tags with space
            .replace(/\s+/g, ' ') // Collapse spaces
            .trim();
        return text.substring(0, 150) + (text.length > 150 ? "..." : "");
    };

    const snippet = isEmail ? getSnippet(message.body) : "";
    const attachments = (message.attachments || []).map((attachment) =>
        typeof attachment === "string"
            ? { id: undefined, url: attachment, mimeType: undefined, fileName: undefined, transcript: null }
            : attachment
    );
    const imageAttachments = attachments.filter((attachment) => {
        const mimeType = (attachment.mimeType || "").toLowerCase();
        if (mimeType.startsWith("image/")) return true;

        const target = (attachment.fileName || attachment.url || "").toLowerCase().split("?")[0];
        return [".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".svg"].some((ext) => target.endsWith(ext));
    });
    const audioAttachments = attachments.filter((attachment) => {
        const mimeType = (attachment.mimeType || "").toLowerCase();
        if (mimeType.startsWith("audio/")) return true;

        const target = (attachment.fileName || attachment.url || "").toLowerCase().split("?")[0];
        return [".ogg", ".opus", ".mp3", ".m4a", ".webm", ".wav", ".aac"].some((ext) => target.endsWith(ext));
    });
    const fileAttachments = attachments.filter((attachment) =>
        !imageAttachments.includes(attachment) && !audioAttachments.includes(attachment)
    );
    const selectedImage = selectedImageIndex !== null ? imageAttachments[selectedImageIndex] : null;
    const hasLikelyMediaPlaceholder = ["[Audio]", "[Image]", "[Media]", "[Document]", "[Contact]"].includes(String(message.body || "").trim());
    const hasRenderableMediaAttachment = imageAttachments.length > 0 || audioAttachments.length > 0 || fileAttachments.length > 0;
    const canRefetchMedia = !!onRefetchMedia && isWhatsApp && !isContactMessage && (hasRenderableMediaAttachment || hasLikelyMediaPlaceholder);

    const handleSaveContact = useCallback(async (index: number, contact: SharedContactInfo) => {
        if (!locationId || contactSaveStates[index]?.saving) return;
        setContactSaveStates(prev => ({ ...prev, [index]: { saving: true } }));
        try {
            const result = await saveSharedContact({
                locationId,
                displayName: contact.displayName,
                phoneNumber: contact.phoneNumber,
                email: contact.email,
                organization: contact.organization,
            });
            if (result.success) {
                setContactSaveStates(prev => ({
                    ...prev,
                    [index]: {
                        saved: true,
                        contactId: result.contactId,
                        isNew: result.isNew,
                    },
                }));
            } else {
                setContactSaveStates(prev => ({
                    ...prev,
                    [index]: { error: result.error || 'Failed to save' },
                }));
            }
        } catch (err: any) {
            setContactSaveStates(prev => ({
                ...prev,
                [index]: { error: err?.message || 'Failed to save' },
            }));
        }
    }, [locationId, contactSaveStates]);

    const handleStartMessaging = useCallback(async (index: number, contactId: string) => {
        if (contactOpenMessageStates[index]) return;
        setContactOpenMessageStates(prev => ({ ...prev, [index]: true }));
        try {
            const res = await openOrStartConversationForContact(contactId);
            if (res?.success && res.conversationId) {
                router.push(`/admin/conversations?id=${encodeURIComponent(res.conversationId)}`);
                router.refresh();
            } else {
                setContactSaveStates(prev => ({
                    ...prev,
                    [index]: { ...prev[index], error: res?.error || 'Failed to open message' }
                }));
            }
        } catch (err: any) {
            setContactSaveStates(prev => ({
                ...prev,
                [index]: { ...prev[index], error: err.message || 'Error occurred' }
            }));
        } finally {
            setContactOpenMessageStates(prev => ({ ...prev, [index]: false }));
        }
    }, [contactOpenMessageStates, router]);

    const getDownloadUrl = (url: string) => {
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
    };

    const handleRefetchMedia = async (e: React.MouseEvent<HTMLButtonElement>) => {
        e.stopPropagation();
        if (!onRefetchMedia || isRefetchingMedia) return;

        setIsRefetchingMedia(true);
        try {
            await Promise.resolve(onRefetchMedia(message.id));
        } finally {
            setIsRefetchingMedia(false);
        }
    };

    const isTranscriptExpanded = (attachmentId?: string, fallbackIndex?: number) => {
        const key = attachmentId || `${message.id}:audio:${fallbackIndex || 0}`;
        return !!expandedTranscriptIds[key];
    };

    const toggleTranscriptExpanded = (attachmentId?: string, fallbackIndex?: number) => {
        const key = attachmentId || `${message.id}:audio:${fallbackIndex || 0}`;
        setExpandedTranscriptIds((prev) => ({ ...prev, [key]: !prev[key] }));
    };

    const handleRequestTranscript = async (
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
    };

    const handleExtractViewingNotes = async (
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
    };

    const formatExtractionList = (value: unknown): string[] => {
        if (!Array.isArray(value)) return [];
        return value
            .map((item) => String(item || "").trim())
            .filter((item) => !!item);
    };

    const clearSelectionTarget = () => setSelectionTarget(null);

    const setSelectionFromRect = useCallback((
        rawText: string,
        rect: { top: number; left: number; right: number; bottom: number; width: number; height: number },
        source: "message" | "email"
    ) => {
        const text = String(rawText || "").replace(/\u00a0/g, " ").trim();
        if (!text || text.length < 2 || (!rect.width && !rect.height)) {
            if (source === "message") {
                setSelectionTarget((prev) => (prev?.source === "message" ? null : prev));
            } else {
                setSelectionTarget((prev) => (prev?.source === "email" ? null : prev));
            }
            return;
        }

        setSelectionTarget({
            text,
            source,
            rect,
        });
    }, []);

    // Strategy A: Universal selection detection via document selectionchange.
    // Works on both desktop (mouse drag) and mobile (touch selection handles).
    // Replaces the previous onMouseUp/onKeyUp approach that didn't fire on mobile.
    useEffect(() => {
        const contentNode = contentRef.current;
        if (!contentNode) return;

        let timer: ReturnType<typeof setTimeout> | null = null;

        const onSelectionChange = () => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
                const sel = window.getSelection();
                if (!sel || sel.rangeCount === 0 || !sel.toString().trim()) {
                    setSelectionTarget((prev) => (prev?.source === "message" ? null : prev));
                    return;
                }

                const range = sel.getRangeAt(0);
                // Allow cross-message drag selection as long as this bubble intersects
                let intersects = false;
                try { intersects = range.intersectsNode(contentNode); } catch { intersects = false; }
                if (!intersects) return;

                const rawText = sel.toString();
                const rect = range.getBoundingClientRect();
                setSelectionFromRect(rawText, {
                    top: rect.top,
                    left: rect.left,
                    right: rect.right,
                    bottom: rect.bottom,
                    width: rect.width,
                    height: rect.height,
                }, "message");
            }, 200);
        };

        document.addEventListener("selectionchange", onSelectionChange);
        return () => {
            document.removeEventListener("selectionchange", onSelectionChange);
            if (timer) clearTimeout(timer);
        };
    }, [setSelectionFromRect]);

    // Strategy B: Get actionable text for context menu triggers.
    // Prefers active text selection, then falls back to the full message body.
    const getActionableText = useCallback(() => {
        if (selectionTarget?.text?.trim()) return selectionTarget.text.trim();
        if (isContactMessage) return getContactBodyReadablePart(message.body);
        return String(message.body || "")
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
            .replace(/<[^>]*>/g, " ")
            .replace(/\s+/g, " ")
            .trim();
    }, [selectionTarget, isContactMessage, message.body]);

    // Strategy B: Handle context menu action trigger.
    const handleContextMenuAction = useCallback((action: string) => {
        const text = getActionableText();
        if (!text || text.length < 2) return;
        const button = contextMenuButtonRef.current;
        const rect = button?.getBoundingClientRect() || { top: 200, left: 200, right: 220, bottom: 220, width: 20, height: 20 };
        setSelectionTarget({
            text,
            source: "message",
            rect: {
                top: rect.top,
                left: rect.left,
                right: rect.right,
                bottom: rect.bottom,
                width: rect.width,
                height: rect.height,
            },
        });
        setPendingAction(action);
    }, [getActionableText]);

    const handleEmailSelectionChange = (selection: EmailFrameSelection | null) => {
        if (!selection) {
            setSelectionTarget((prev) => (prev?.source === "email" ? null : prev));
            return;
        }
        setSelectionFromRect(selection.text, selection.rect, "email");
    };

    const canTranslateMessage = translationReadEnabled
        && !isOutbound
        && !!onTranslateMessage
        && String(message.body || "").trim().length > 0;

    const handleTranslateMessage = async () => {
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
    };

    const renderMessageBody = () => {
        const effectiveViewMode = translationViewMode === "thread" ? threadTranslationMode : translationViewMode;
        const showTranslatedText = !!activeTranslation?.translatedText?.trim() && effectiveViewMode === "translated";
        const translatedText = String(activeTranslation?.translatedText || "").trim();
        const sourceText = isOutbound && activeTranslation?.sourceText
            ? String(activeTranslation.sourceText || "").trim()
            : "";
        if (translatedText && showTranslatedText) {
            return (
                <div className="space-y-1">
                    <div className={cn(
                        "text-[11px] font-medium",
                        isOutbound ? "text-blue-100" : "text-slate-500"
                    )}>
                        {isOutbound ? "Sent to client" : `Translated${activeTranslation?.sourceLanguage ? ` from ${activeTranslation.sourceLanguage}` : ""}`}
                    </div>
                    <LinkifiedText text={translatedText} />
                </div>
            );
        }

        if (effectiveViewMode !== "translated" && (isEmail || isRichHtml)) {
            return <EmailFrame html={message.body} onSelectionChange={handleEmailSelectionChange} />;
        }

        if ((isEmail || isRichHtml) && !activeTranslation) {
            return <EmailFrame html={message.body} onSelectionChange={handleEmailSelectionChange} />;
        }
        if (sourceText) {
            return (
                <div className="space-y-1">
                    <div className={cn(
                        "text-[11px] font-medium",
                        isOutbound ? "text-blue-100" : "text-slate-500"
                    )}>
                        Internal source
                    </div>
                    <LinkifiedText text={sourceText} />
                </div>
            );
        }
        return <LinkifiedText text={sourceText || message.body} />;
    };

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
                {/* Per-message context menu (Strategy B) — hover reveal desktop, always visible mobile */}
                {!(isEmail && !isExpanded) && (
                    <div className={cn(
                        "absolute top-1.5 z-10 transition-opacity duration-150",
                        isOutbound ? "left-1.5" : "right-1.5",
                        "opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                    )}>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <button
                                    ref={contextMenuButtonRef}
                                    type="button"
                                    className={cn(
                                        "h-6 w-6 rounded-full flex items-center justify-center transition-colors",
                                        isOutbound
                                            ? "bg-blue-500/40 hover:bg-blue-500/60 text-white"
                                            : "bg-gray-100 hover:bg-gray-200 text-gray-500"
                                    )}
                                    onClick={(e) => e.stopPropagation()}
                                    title="Message actions"
                                >
                                    <MoreHorizontal className="h-3.5 w-3.5" />
                                </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align={isOutbound ? "start" : "end"} className="w-44" data-no-pane-swipe>
                                <DropdownMenuItem onClick={() => handleContextMenuAction("pasteLead")} className="gap-2 text-xs">
                                    <Clipboard className="h-3.5 w-3.5" />
                                    Paste Lead
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleContextMenuAction("findContact")} className="gap-2 text-xs">
                                    <Search className="h-3.5 w-3.5" />
                                    Find Contact
                                </DropdownMenuItem>
                                {!!onTranslateMessage && (
                                    <>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem onClick={() => handleTranslateMessage()} className="gap-2 text-xs text-blue-600 focus:text-blue-700">
                                            <Languages className="h-3.5 w-3.5" />
                                            Translate Message
                                        </DropdownMenuItem>
                                    </>
                                )}
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                    onClick={() => handleContextMenuAction("summarize")}
                                    className="gap-2 text-xs"
                                    disabled={!message.conversationId}
                                >
                                    <FileText className="h-3.5 w-3.5" />
                                    Summarize
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    onClick={() => handleContextMenuAction("custom")}
                                    className="gap-2 text-xs"
                                    disabled={!message.conversationId}
                                >
                                    <Wand2 className="h-3.5 w-3.5" />
                                    Custom
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                    onClick={() => handleContextMenuAction("createTask")}
                                    className="gap-2 text-xs"
                                    disabled={!message.conversationId}
                                >
                                    <ListTodo className="h-3.5 w-3.5" />
                                    Create Task
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    onClick={() => handleContextMenuAction("suggestTasks")}
                                    className="gap-2 text-xs"
                                    disabled={!message.conversationId}
                                >
                                    <Sparkles className="h-3.5 w-3.5" />
                                    AI Tasks
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    onClick={() => handleContextMenuAction("suggestViewings")}
                                    className="gap-2 text-xs"
                                    disabled={!message.conversationId}
                                >
                                    <Home className="h-3.5 w-3.5" />
                                    Suggest Viewings
                                </DropdownMenuItem>
                                {onAddSelectionToBatch && (
                                    <>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem onClick={() => handleContextMenuAction("addBatch")} className="gap-2 text-xs">
                                            <ListPlus className="h-3.5 w-3.5" />
                                            Add to Batch
                                        </DropdownMenuItem>
                                    </>
                                )}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                )}
                {/* SMS/WhatsApp Header */}
                {(isSMS || isWhatsApp) && (
                    <div className={cn(
                        "px-3 py-1.5 text-[11px] flex items-center gap-2 border-b min-w-0",
                        isOutbound ? "bg-blue-700/30 text-blue-100 border-blue-500/50" : "bg-gray-50 text-gray-500 border-gray-100"
                    )}>
                        <Smartphone className="h-3 w-3 shrink-0" />
                        <span className="flex-1 w-0 min-w-0 truncate">
                            {isOutbound
                                ? `To: ${contactPhone || contactName || "Contact"}`
                                : `From: ${contactPhone || contactName || "Contact"}`
                            }
                        </span>
                    </div>
                )}

                {/* Email Specific Header */}
                {isEmail && (
                    <div className="flex flex-col border-b border-gray-100">
                        {/* Top: Type Label and Expand Hint */}
                        <div className={cn("px-4 py-2 text-xs font-semibold flex items-center justify-between gap-2", isOutbound ? "bg-blue-700/50 text-white border-b border-blue-500" : "bg-gray-50 text-gray-700")}>
                            <div className="flex items-center gap-2">
                                <Mail className="h-3 w-3 shrink-0" />
                                <span className="opacity-70 text-[10px] uppercase tracking-wider">Email Message</span>
                            </div>
                            {!isExpanded && <span className={cn("font-normal text-[10px] shrink-0", isOutbound ? "text-blue-100" : "text-gray-400")}>Click to expand</span>}
                        </div>

                        {/* Middle: Subject */}
                        <div className="px-4 py-2 bg-white">
                            <span className="font-semibold text-sm text-gray-900 block break-words">{message.subject || "No Subject"}</span>
                        </div>

                        {/* Bottom: From -> To */}
                        {(message.contactName || message.emailFrom || message.emailTo) && (
                            <div className="px-4 pb-2 flex flex-wrap items-center gap-2 text-xs text-gray-500 bg-white">
                                <span className="flex items-center gap-1 max-w-[45%] truncate" title={message.emailFrom}>
                                    <span className="font-medium text-gray-600">From:</span> {message.emailFrom || (isOutbound ? "You" : message.contactName || "Contact")}
                                </span>
                                <ArrowRight className="h-3 w-3 text-gray-300 shrink-0" />
                                <span className="flex items-center gap-1 max-w-[45%] truncate" title={message.emailTo}>
                                    <span className="font-medium text-gray-600">To:</span> {message.emailTo || (isOutbound ? message.contactName || "Contact" : "You")}
                                </span>
                            </div>
                        )}

                    </div>
                )}

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
                        // Contact Card View
                        <div className="space-y-2">
                            {sharedContacts.map((contact, idx) => {
                                const state = contactSaveStates[idx];
                                return (
                                    <div
                                        key={`contact-${idx}-${contact.displayName}`}
                                        className={cn(
                                            "rounded-lg border p-3 space-y-2",
                                            isOutbound
                                                ? "border-white/20 bg-white/10"
                                                : "border-gray-200 bg-gray-50"
                                        )}
                                    >
                                        {/* Contact Header */}
                                        <div className="flex items-center gap-2">
                                            <div className={cn(
                                                "h-8 w-8 rounded-full flex items-center justify-center shrink-0",
                                                isOutbound ? "bg-white/20" : "bg-blue-100"
                                            )}>
                                                <User className={cn(
                                                    "h-4 w-4",
                                                    isOutbound ? "text-white" : "text-blue-600"
                                                )} />
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <p className={cn(
                                                    "font-semibold text-sm truncate",
                                                    isOutbound ? "text-white" : "text-gray-900"
                                                )}>
                                                    {contact.displayName}
                                                </p>
                                                {contact.organization && (
                                                    <p className={cn(
                                                        "text-[11px] truncate flex items-center gap-1",
                                                        isOutbound ? "text-blue-100" : "text-gray-500"
                                                    )}>
                                                        <Building2 className="h-3 w-3 shrink-0" />
                                                        {contact.organization}
                                                    </p>
                                                )}
                                            </div>
                                        </div>

                                        {/* Contact Details */}
                                        <div className="space-y-1">
                                            {contact.phoneNumber && (
                                                <a
                                                    href={`tel:${contact.phoneNumber}`}
                                                    onClick={(e) => e.stopPropagation()}
                                                    className={cn(
                                                        "flex items-center gap-2 text-xs rounded px-2 py-1 transition-colors",
                                                        isOutbound
                                                            ? "text-blue-100 hover:bg-white/10"
                                                            : "text-gray-600 hover:bg-gray-100"
                                                    )}
                                                >
                                                    <PhoneIcon className="h-3 w-3 shrink-0" />
                                                    <span className="truncate">{contact.phoneNumber}</span>
                                                </a>
                                            )}
                                            {contact.email && (
                                                <a
                                                    href={`mailto:${contact.email}`}
                                                    onClick={(e) => e.stopPropagation()}
                                                    className={cn(
                                                        "flex items-center gap-2 text-xs rounded px-2 py-1 transition-colors",
                                                        isOutbound
                                                            ? "text-blue-100 hover:bg-white/10"
                                                            : "text-gray-600 hover:bg-gray-100"
                                                    )}
                                                >
                                                    <MailIcon className="h-3 w-3 shrink-0" />
                                                    <span className="truncate">{contact.email}</span>
                                                </a>
                                            )}
                                        </div>

                                        {/* Actions */}
                                        <div className="flex items-center gap-2 pt-1">
                                            {isHydratingContactStates ? (
                                                <div className={cn("flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium", isOutbound ? "text-white/70" : "text-muted-foreground")}>
                                                    <RefreshCw className="h-3 w-3 animate-spin" />
                                                    Checking...
                                                </div>
                                            ) : state?.saved ? (
                                                <>
                                                    <span className={cn(
                                                        "flex items-center gap-1 text-[11px] font-medium",
                                                        isOutbound ? "text-emerald-200" : "text-emerald-600"
                                                    )}>
                                                        <Check className="h-3 w-3" />
                                                        {state.isNew ? "Saved" : "Already exists"}
                                                    </span>
                                                    {state.contactId && (
                                                        <a
                                                            href={`/admin/contacts/${state.contactId}/view`}
                                                            onClick={(e) => e.stopPropagation()}
                                                            className={cn(
                                                                "inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors",
                                                                isOutbound
                                                                    ? "bg-white/20 text-white hover:bg-white/30"
                                                                    : "bg-blue-50 text-blue-700 hover:bg-blue-100"
                                                            )}
                                                        >
                                                            <ExternalLinkIcon className="h-3 w-3" />
                                                            Open Contact
                                                        </a>
                                                    )}
                                                    {state.contactId && (
                                                        state.conversationId ? (
                                                            <a
                                                                href={`/admin/conversations?id=${encodeURIComponent(state.conversationId)}`}
                                                                onClick={(e) => e.stopPropagation()}
                                                                className={cn(
                                                                    "inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors",
                                                                    isOutbound
                                                                        ? "bg-white/20 text-white hover:bg-white/30"
                                                                        : "bg-blue-50 text-blue-700 hover:bg-blue-100"
                                                                )}
                                                            >
                                                                <MessageCirclePlus className="h-3 w-3" />
                                                                Send Message
                                                            </a>
                                                        ) : (
                                                            <button
                                                                type="button"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    void handleStartMessaging(idx, state.contactId!);
                                                                }}
                                                                disabled={contactOpenMessageStates[idx]}
                                                                className={cn(
                                                                    "inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors",
                                                                    isOutbound
                                                                        ? "bg-white/20 text-white hover:bg-white/30 disabled:opacity-60"
                                                                        : "bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-60"
                                                                )}
                                                            >
                                                                <MessageCirclePlus className="h-3 w-3" />
                                                                {contactOpenMessageStates[idx] ? "Opening..." : "Send Message"}
                                                            </button>
                                                        )
                                                    )}
                                                </>
                                            ) : state?.error ? (
                                                <span className={cn(
                                                    "text-[11px]",
                                                    isOutbound ? "text-red-200" : "text-red-600"
                                                )}>
                                                    {state.error}
                                                </span>
                                            ) : (
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        void handleSaveContact(idx, contact);
                                                    }}
                                                    disabled={state?.saving || !locationId}
                                                    className={cn(
                                                        "inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-[11px] font-medium transition-colors",
                                                        isOutbound
                                                            ? "bg-white/20 text-white hover:bg-white/30 disabled:opacity-60"
                                                            : "bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
                                                    )}
                                                >
                                                    <UserPlus className="h-3 w-3" />
                                                    {state?.saving ? "Saving..." : "Save to Contacts"}
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ) : isEmail && !isExpanded ? (
                        // Snippet View
                        <div className="text-gray-500 text-sm italic">
                            {snippet || "Click to view email content..."}
                        </div>
                    ) : (
                        renderMessageBody()
                    )}
                </div>

                {(canTranslateMessage || activeTranslation) && (
                    <div className={cn("px-4 pb-1", isEmail && "bg-white")}>
                        <div className="flex items-center gap-2 text-[11px]">
                            {canTranslateMessage && !activeTranslation && (
                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        void handleTranslateMessage();
                                    }}
                                    disabled={isTranslatingMessage}
                                    className={cn(
                                        "rounded px-1.5 py-0.5",
                                        isOutbound ? "text-blue-100 hover:bg-white/20" : "text-blue-600 hover:bg-blue-50"
                                    )}
                                >
                                    {isTranslatingMessage ? "Translating..." : "Translate"}
                                </button>
                            )}
                            {activeTranslation && (
                                <>
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setTranslationViewMode((current) => {
                                                const effectiveViewMode = current === "thread" ? threadTranslationMode : current;
                                                return effectiveViewMode === "translated" ? "original" : "translated";
                                            });
                                        }}
                                        className={cn(
                                            "rounded px-1.5 py-0.5",
                                            isOutbound ? "text-blue-100 hover:bg-white/20" : "text-slate-600 hover:bg-slate-100"
                                        )}
                                    >
                                        {(() => {
                                            const effectiveViewMode = translationViewMode === "thread" ? threadTranslationMode : translationViewMode;
                                            if (isOutbound) {
                                                return effectiveViewMode === "translated" ? "Show sent" : "Show source";
                                            }
                                            return effectiveViewMode === "translated" ? "Show original" : "Show translation";
                                        })()}
                                    </button>
                                    {canTranslateMessage && (
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                void handleTranslateMessage();
                                            }}
                                            disabled={isTranslatingMessage}
                                            className={cn(
                                                "rounded px-1.5 py-0.5",
                                                isOutbound ? "text-blue-100 hover:bg-white/20" : "text-blue-600 hover:bg-blue-50"
                                            )}
                                        >
                                            {isTranslatingMessage ? "Refreshing..." : "Refresh translation"}
                                        </button>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                )}

                {/* Attachments */}
                {attachments.length > 0 && (
                    <div className={cn("px-4 pb-2 space-y-1 mt-2", isEmail && "bg-gray-50 pt-2 border-t")}>
                        {imageAttachments.map((attachment, i) => (
                            <button
                                key={`img-${i}-${attachment.url}`}
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedImageIndex(i);
                                }}
                                aria-label={`Open image attachment ${i + 1}`}
                                className="block rounded-lg overflow-hidden border border-black/10 bg-black/5 hover:opacity-95 transition-opacity"
                            >
                                <div className="relative">
                                    <img
                                        src={attachment.url}
                                        alt={attachment.fileName || `Image attachment ${i + 1}`}
                                        loading="lazy"
                                        className="block max-h-80 w-auto max-w-full object-contain bg-white"
                                    />
                                    <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md bg-black/65 px-2 py-1 text-[11px] font-medium text-white shadow">
                                        <Maximize2 className="h-3 w-3" />
                                        View
                                    </span>
                                </div>
                            </button>
                        ))}
                        {audioAttachments.map((attachment, i) => (
                            <div
                                key={`audio-${i}-${attachment.url}`}
                                data-horizontal-scroll
                                className={cn(
                                    "rounded-lg border border-black/10 bg-black/5 p-2 overflow-x-auto w-full max-w-full min-w-0",
                                    isOutbound && !isEmail ? "bg-white/10 border-white/20" : "bg-black/[0.03]"
                                )}
                                onClick={(e) => e.stopPropagation()}
                            >
                                <audio
                                    controls
                                    preload="metadata"
                                    src={attachment.url}
                                    className="w-full max-w-full min-w-0 sm:max-w-[320px]"
                                />
                                <div className="mt-1 flex items-center gap-2 text-[11px] min-w-0">
                                    <span className="min-w-0 flex-1 truncate">{attachment.fileName || `Audio attachment ${i + 1}`}</span>
                                    <a
                                        href={getDownloadUrl(attachment.url)}
                                        download={attachment.fileName || `audio-${i + 1}`}
                                        className={cn(
                                            "ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-black/10 shrink-0",
                                            isOutbound && !isEmail ? "text-blue-100 hover:bg-white/20" : "text-gray-600"
                                        )}
                                    >
                                        <Download className="h-3 w-3" />
                                        Download
                                    </a>
                                </div>

                                {!attachment.transcript && onRequestTranscript && attachment.id && (
                                    <div className="mt-2 rounded-md border border-black/10 bg-white/70 px-2 py-1.5 text-xs">
                                        <div className="flex items-center gap-2">
                                            <span className={cn("text-[11px]", isOutbound && !isEmail ? "text-blue-100/90" : "text-gray-600")}>
                                                No transcript yet.
                                            </span>
                                            <button
                                                type="button"
                                                onClick={(e) => handleRequestTranscript(e, attachment.id, { force: false })}
                                                disabled={transcriptActionAttachmentId === attachment.id}
                                                className={cn(
                                                    "ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px]",
                                                    isOutbound && !isEmail
                                                        ? "bg-white/20 text-blue-50 hover:bg-white/30 disabled:opacity-70"
                                                        : "bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-70"
                                                )}
                                            >
                                                {transcriptActionAttachmentId === attachment.id ? "Starting..." : "Transcribe now"}
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {attachment.transcript && (
                                    <div
                                        className={cn(
                                            "mt-2 rounded-md border px-2 py-1.5 text-xs",
                                            isOutbound && !isEmail
                                                ? "border-white/20 bg-white/10 text-blue-50"
                                                : "border-black/10 bg-white/70 text-gray-700"
                                        )}
                                    >
                                        <div className="flex items-center gap-2">
                                            <span className="font-medium">
                                                Transcript
                                            </span>
                                            <span className={cn(
                                                "rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide",
                                                attachment.transcript.status === "completed" && (isOutbound && !isEmail ? "bg-emerald-500/25 text-emerald-100" : "bg-emerald-100 text-emerald-700"),
                                                attachment.transcript.status === "failed" && (isOutbound && !isEmail ? "bg-red-500/25 text-red-100" : "bg-red-100 text-red-700"),
                                                (attachment.transcript.status === "pending" || attachment.transcript.status === "processing") && (isOutbound && !isEmail ? "bg-amber-500/25 text-amber-100" : "bg-amber-100 text-amber-700")
                                            )}>
                                                {attachment.transcript.status}
                                            </span>
                                            {attachment.transcript.model && (
                                                <span className={cn(
                                                    "ml-auto text-[10px]",
                                                    isOutbound && !isEmail ? "text-blue-100/80" : "text-gray-500"
                                                )}>
                                                    {attachment.transcript.model}
                                                </span>
                                            )}
                                        </div>

                                        {(attachment.transcript.status === "pending" || attachment.transcript.status === "processing") && (
                                            <p className={cn("mt-1 text-[11px]", isOutbound && !isEmail ? "text-blue-100/90" : "text-gray-600")}>
                                                Transcribing...
                                            </p>
                                        )}

                                        {attachment.transcript.status === "completed" && (
                                            <div className="mt-1 space-y-2">
                                                {attachment.transcript?.restricted ? (
                                                    <p className={cn("text-[11px] italic", isOutbound && !isEmail ? "text-blue-100/85" : "text-gray-600")}>
                                                        Transcript text is hidden by policy.
                                                    </p>
                                                ) : (
                                                    <>
                                                        <p className={cn(
                                                            "whitespace-pre-wrap leading-relaxed [overflow-wrap:anywhere] [word-break:break-word]",
                                                            isOutbound && !isEmail ? "text-blue-50" : "text-gray-700"
                                                        )}>
                                                            {(() => {
                                                                const text = String(attachment.transcript?.text || "");
                                                                const expanded = isTranscriptExpanded(attachment.id, i);
                                                                if (expanded || text.length <= 280) return text;
                                                                return `${text.slice(0, 280)}...`;
                                                            })()}
                                                        </p>
                                                        {String(attachment.transcript.text || "").length > 280 && (
                                                            <button
                                                                type="button"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    toggleTranscriptExpanded(attachment.id, i);
                                                                }}
                                                                className={cn(
                                                                    "text-[11px] underline underline-offset-2",
                                                                    isOutbound && !isEmail ? "text-blue-100 hover:text-white" : "text-gray-600 hover:text-gray-900"
                                                                )}
                                                            >
                                                                {isTranscriptExpanded(attachment.id, i) ? "Show less" : "Show more"}
                                                            </button>
                                                        )}
                                                    </>
                                                )}
                                                {!attachment.transcript?.restricted && (
                                                    <div className="flex flex-wrap items-center gap-1.5">
                                                        {onRequestTranscript && attachment.id && (
                                                            <button
                                                                type="button"
                                                                onClick={(e) => handleRequestTranscript(e, attachment.id, { force: true })}
                                                                disabled={transcriptActionAttachmentId === attachment.id}
                                                                className={cn(
                                                                    "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px]",
                                                                    isOutbound && !isEmail
                                                                        ? "bg-white/20 text-blue-50 hover:bg-white/30 disabled:opacity-70"
                                                                        : "bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-70"
                                                                )}
                                                            >
                                                                {transcriptActionAttachmentId === attachment.id ? "Regenerating..." : "Regenerate transcript"}
                                                            </button>
                                                        )}
                                                        {onExtractViewingNotes && attachment.id && (
                                                            <button
                                                                type="button"
                                                                onClick={(e) => handleExtractViewingNotes(e, attachment.id, { force: !!attachment.transcript?.extraction })}
                                                                disabled={extractActionAttachmentId === attachment.id}
                                                                className={cn(
                                                                    "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px]",
                                                                    isOutbound && !isEmail
                                                                        ? "bg-white/20 text-blue-50 hover:bg-white/30 disabled:opacity-70"
                                                                        : "bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-70"
                                                                )}
                                                            >
                                                                {extractActionAttachmentId === attachment.id
                                                                    ? (attachment.transcript?.extraction ? "Regenerating notes..." : "Extracting...")
                                                                    : (attachment.transcript?.extraction ? "Regenerate notes" : "Extract viewing notes")}
                                                            </button>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {attachment.transcript.status === "failed" && (
                                            <div className="mt-1 space-y-1">
                                                <p className={cn("text-[11px]", isOutbound && !isEmail ? "text-red-100" : "text-red-600")}>
                                                    {attachment.transcript?.restricted
                                                        ? "Transcript details are hidden by policy."
                                                        : (attachment.transcript.error || "Transcription failed.")}
                                                </p>
                                                {!attachment.transcript?.restricted && (onRequestTranscript || onRetryTranscript) && attachment.id && (
                                                    <button
                                                        type="button"
                                                        onClick={(e) => handleRequestTranscript(e, attachment.id, { force: true })}
                                                        disabled={transcriptActionAttachmentId === attachment.id}
                                                        className={cn(
                                                            "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px]",
                                                            isOutbound && !isEmail
                                                                ? "bg-white/20 text-blue-50 hover:bg-white/30 disabled:opacity-70"
                                                                : "bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-70"
                                                        )}
                                                    >
                                                        {transcriptActionAttachmentId === attachment.id ? "Retrying..." : "Retry transcript"}
                                                    </button>
                                                )}
                                            </div>
                                        )}

                                        {attachment.transcript.status === "completed" && attachment.transcript.extraction && (
                                            <div
                                                className={cn(
                                                    "mt-2 rounded-md border px-2 py-1.5 text-[11px]",
                                                    isOutbound && !isEmail
                                                        ? "border-white/20 bg-white/10 text-blue-50"
                                                        : "border-black/10 bg-white text-gray-700"
                                                )}
                                            >
                                                <div className="flex items-center gap-2">
                                                    <span className="font-medium">Viewing notes</span>
                                                    <span className={cn(
                                                        "rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide",
                                                        attachment.transcript.extraction.status === "completed" && (isOutbound && !isEmail ? "bg-emerald-500/25 text-emerald-100" : "bg-emerald-100 text-emerald-700"),
                                                        attachment.transcript.extraction.status === "failed" && (isOutbound && !isEmail ? "bg-red-500/25 text-red-100" : "bg-red-100 text-red-700"),
                                                        (attachment.transcript.extraction.status === "pending" || attachment.transcript.extraction.status === "processing") && (isOutbound && !isEmail ? "bg-amber-500/25 text-amber-100" : "bg-amber-100 text-amber-700")
                                                    )}>
                                                        {attachment.transcript.extraction.status}
                                                    </span>
                                                    {attachment.transcript.extraction.model && (
                                                        <span className={cn(
                                                            "ml-auto text-[10px]",
                                                            isOutbound && !isEmail ? "text-blue-100/80" : "text-gray-500"
                                                        )}>
                                                            {attachment.transcript.extraction.model}
                                                        </span>
                                                    )}
                                                </div>

                                                {(attachment.transcript.extraction.status === "pending" || attachment.transcript.extraction.status === "processing") && (
                                                    <p className={cn("mt-1 text-[11px]", isOutbound && !isEmail ? "text-blue-100/90" : "text-gray-600")}>
                                                        Extracting viewing notes...
                                                    </p>
                                                )}

                                                {attachment.transcript.extraction.status === "failed" && (
                                                    <div className="mt-1 space-y-1">
                                                        <p className={cn("text-[11px]", isOutbound && !isEmail ? "text-red-100" : "text-red-600")}>
                                                            {attachment.transcript.extraction?.restricted
                                                                ? "Viewing notes details are hidden by policy."
                                                                : (attachment.transcript.extraction.error || "Viewing notes extraction failed.")}
                                                        </p>
                                                        {!attachment.transcript.extraction?.restricted && onExtractViewingNotes && attachment.id && (
                                                            <button
                                                                type="button"
                                                                onClick={(e) => handleExtractViewingNotes(e, attachment.id, { force: true })}
                                                                disabled={extractActionAttachmentId === attachment.id}
                                                                className={cn(
                                                                    "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px]",
                                                                    isOutbound && !isEmail
                                                                        ? "bg-white/20 text-blue-50 hover:bg-white/30 disabled:opacity-70"
                                                                        : "bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-70"
                                                                )}
                                                            >
                                                                {extractActionAttachmentId === attachment.id ? "Retrying..." : "Retry extraction"}
                                                            </button>
                                                        )}
                                                    </div>
                                                )}

                                                {attachment.transcript.extraction.status === "completed" && (
                                                    attachment.transcript.extraction?.restricted ? (
                                                        <p className={cn("mt-1 text-[11px] italic", isOutbound && !isEmail ? "text-blue-100/85" : "text-gray-600")}>
                                                            Viewing notes are hidden by policy.
                                                        </p>
                                                    ) : (
                                                        <div className="mt-1 space-y-0.5 [overflow-wrap:anywhere] [word-break:break-word]">
                                                            <p>Prospects: {formatExtractionList((attachment.transcript.extraction.payload as any)?.prospects).join("; ") || "None"}</p>
                                                            <p>Requirements: {formatExtractionList((attachment.transcript.extraction.payload as any)?.requirements).join("; ") || "None"}</p>
                                                            <p>Budget: {String((attachment.transcript.extraction.payload as any)?.budget || "").trim() || "Not specified"}</p>
                                                            <p>Locations: {formatExtractionList((attachment.transcript.extraction.payload as any)?.locations).join("; ") || "None"}</p>
                                                            <p>Objections: {formatExtractionList((attachment.transcript.extraction.payload as any)?.objections).join("; ") || "None"}</p>
                                                            <p>Next actions: {formatExtractionList((attachment.transcript.extraction.payload as any)?.nextActions).join("; ") || "None"}</p>
                                                        </div>
                                                    )
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))}
                        {fileAttachments.map((attachment, i) => (
                            <a
                                key={`file-${i}-${attachment.url}`}
                                href={attachment.url}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className={cn(
                                    "flex min-w-0 w-full max-w-full items-center gap-2 text-xs p-2 rounded hover:bg-black/5 transition-colors",
                                    isOutbound && !isEmail ? "text-blue-100 hover:bg-white/20" : "text-gray-600"
                                )}
                            >
                                <Paperclip className="h-3 w-3 shrink-0" />
                                <span className="min-w-0 flex-1 truncate">{attachment.fileName || `Attachment ${i + 1}`}</span>
                                <ExternalLink className="h-3 w-3 shrink-0 ml-auto opacity-50" />
                            </a>
                        ))}
                    </div>
                )}

                {canRefetchMedia && (
                    <div className={cn("px-4 pb-2 mt-1", attachments.length === 0 && "pt-2")}>
                        <button
                            type="button"
                            onClick={handleRefetchMedia}
                            disabled={isRefetchingMedia}
                            className={cn(
                                "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors",
                                isOutbound && !isEmail
                                    ? "border-white/30 text-blue-100 hover:bg-white/20 disabled:opacity-70"
                                    : "border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-70"
                            )}
                            title="Delete local stored media and fetch it again from WhatsApp"
                        >
                            <RefreshCw className={cn("h-3 w-3", isRefetchingMedia && "animate-spin")} />
                            {isRefetchingMedia ? "Re-fetching..." : "Re-fetch Media"}
                        </button>
                    </div>
                )}

                {/* Expansion Toggle */}
                {isEmail && (
                    <div
                        className="bg-gray-50 border-t p-1 flex justify-center cursor-pointer hover:bg-gray-100 transition-colors"
                        onClick={() => setIsExpanded(!isExpanded)}
                    >
                        {isExpanded ? (
                            <div className="flex items-center gap-1 text-[10px] uppercase font-bold text-gray-500">
                                <span className="opacity-0 group-hover:opacity-100 transition-opacity">Collapse</span>
                                <ChevronUp className="h-4 w-4" />
                            </div>
                        ) : (
                            <div className="flex items-center gap-1 text-[10px] uppercase font-bold text-gray-500">
                                <span className="opacity-0 hover:opacity-100 transition-opacity">Expand</span>
                                <ChevronDown className="h-4 w-4" />
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Timestamp & Status */}
            <div className="flex items-center gap-1 mt-1 px-1 justify-between select-none min-w-0">
                <span className="text-[10px] text-gray-400 flex gap-1 items-center flex-1 min-w-0 truncate">
                    {isEmail && <Mail className="h-3 w-3 shrink-0" />}
                    {isSMS && <Smartphone className="h-3 w-3 shrink-0" />}
                    <span className="truncate">
                        {(message.contactName || contactName) && !isOutbound ? "Contact • " : "You • "}
                        {format(new Date(message.dateAdded), 'PP p')}
                    </span>
                </span>
                
                {isOutbound && (isSMS || isWhatsApp) && (
                    <span className="flex items-center gap-1 shrink-0 ml-2">
                        {message.status === 'sending' && (
                            (String(message.sendState || "").toLowerCase() === "retrying"
                                || String(message.outboxState?.status || "").toLowerCase() === "failed")
                                ? (
                                    <span className="flex items-center gap-1 text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded text-[10px] border border-amber-100 font-medium">
                                        <AlertTriangle className="h-3 w-3" />
                                        Retrying
                                    </span>
                                )
                                : (
                            <Clock className="h-3 w-3 text-gray-400" aria-label="Sending" />
                                )
                        )}
                        {message.status === 'sent' && (
                            <Check className="h-3 w-3 text-gray-400" aria-label="Sent" />
                        )}
                        {(message.status === 'delivered' || message.status === 'read' || message.status === 'played') && (
                            <CheckCheck className={cn("h-3 w-3", message.status === 'read' || message.status === 'played' ? "text-blue-500" : "text-gray-400")} aria-label={message.status === 'read' ? 'Read' : 'Delivered'} />
                        )}
                        {message.status === 'failed' && (
                            <div className="flex items-center gap-1">
                                <span className="flex items-center gap-1 text-red-500 bg-red-50 px-1.5 py-0.5 rounded text-[10px] border border-red-100 font-medium">
                                    <AlertTriangle className="h-3 w-3" />
                                    Failed
                                </span>
                                {onResendMessage && (
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onResendMessage(message.id);
                                        }}
                                        className="text-[10px] text-blue-600 hover:text-blue-800 hover:underline px-1 py-0.5 rounded transition-colors"
                                    >
                                        Resend
                                    </button>
                                )}
                            </div>
                        )}
                    </span>
                )}
            </div>

            <MessageSelectionActions
                selection={selectionTarget}
                onClearSelection={clearSelectionTarget}
                conversationId={message.conversationId || null}
                aiModel={aiModel || null}
                messageId={message.id}
                selectionBatch={selectionBatch}
                onAddSelectionToBatch={onAddSelectionToBatch}
                onRemoveSelectionBatchItem={onRemoveSelectionBatchItem}
                onClearSelectionBatch={onClearSelectionBatch}
                triggerAction={pendingAction}
                onTriggerActionHandled={() => setPendingAction(null)}
            />

            <Dialog open={selectedImageIndex !== null} onOpenChange={(open) => { if (!open) setSelectedImageIndex(null); }}>
                <DialogContent className="max-w-[96vw] w-[min(96vw,1100px)] p-0 gap-0 overflow-hidden border-zinc-800 bg-zinc-950 text-white">
                    <DialogTitle className="sr-only">
                        {selectedImage?.fileName || "Image attachment preview"}
                    </DialogTitle>
                    <DialogDescription className="sr-only">
                        Preview and download image attachment.
                    </DialogDescription>

                    <div className="flex items-center justify-between gap-2 border-b border-zinc-800 px-4 py-3 pr-14">
                        <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                                {selectedImage?.fileName || "Image attachment"}
                            </p>
                            <p className="text-xs text-zinc-400">
                                Press Esc to close
                            </p>
                        </div>
                        {selectedImage && (
                            <div className="flex items-center gap-2">
                                <a
                                    href={getDownloadUrl(selectedImage.url)}
                                    download={selectedImage.fileName || "attachment"}
                                    className="inline-flex items-center gap-2 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-100 hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-white/30"
                                >
                                    <Download className="h-3.5 w-3.5" />
                                    Download
                                </a>
                                <a
                                    href={selectedImage.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-2 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-100 hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-white/30"
                                >
                                    <ExternalLink className="h-3.5 w-3.5" />
                                    Open
                                </a>
                            </div>
                        )}
                    </div>

                    <div className="flex max-h-[80vh] items-center justify-center bg-black p-3 sm:p-4">
                        {selectedImage && (
                            <img
                                src={selectedImage.url}
                                alt={selectedImage.fileName || "Image attachment preview"}
                                className="max-h-[calc(80vh-2rem)] max-w-full object-contain"
                            />
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
