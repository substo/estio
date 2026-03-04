"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Mail, Smartphone, Paperclip, ExternalLink, ChevronDown, ChevronUp, ArrowRight, Download, Maximize2, RefreshCw } from "lucide-react";
import { format } from "date-fns";
import { EmailFrame, type EmailFrameSelection } from "./email-frame";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { LinkifiedText } from "./linkified-text";
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

export interface MessageBubbleProps {
    message: {
        id: string;
        conversationId?: string;
        contactId?: string;
        body: string;
        type: string;
        direction: 'inbound' | 'outbound';
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
    };
    contactPhone?: string;
    contactEmail?: string;
    contactName?: string; // Fallback contact name if message.contactName missing
    aiModel?: string | null;
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
}

export function MessageBubble({
    message,
    contactPhone,
    contactEmail: _contactEmail,
    contactName,
    aiModel,
    selectionBatch,
    onAddSelectionToBatch,
    onRemoveSelectionBatchItem,
    onClearSelectionBatch,
    onRefetchMedia,
    onRequestTranscript,
    onExtractViewingNotes,
    onRetryTranscript,
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
    const contentRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        setSelectionTarget(null);
        setExpandedTranscriptIds({});
        setTranscriptActionAttachmentId(null);
        setExtractActionAttachmentId(null);
    }, [message.id, isExpanded]);

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
    const hasLikelyMediaPlaceholder = ["[Audio]", "[Image]", "[Media]", "[Document]"].includes(String(message.body || "").trim());
    const hasRenderableMediaAttachment = imageAttachments.length > 0 || audioAttachments.length > 0 || fileAttachments.length > 0;
    const canRefetchMedia = !!onRefetchMedia && isWhatsApp && (hasRenderableMediaAttachment || hasLikelyMediaPlaceholder);
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

    const setSelectionFromRect = (
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
    };

    const handleContentSelection = () => {
        if (typeof window === "undefined") return;
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) {
            setSelectionTarget((prev) => (prev?.source === "message" ? null : prev));
            return;
        }

        const rawText = selection.toString();
        if (!rawText.trim()) {
            setSelectionTarget((prev) => (prev?.source === "message" ? null : prev));
            return;
        }

        const range = selection.getRangeAt(0);
        const contentNode = contentRef.current;
        if (!contentNode) {
            return;
        }

        // Allow cross-message drag selection as long as this bubble intersects
        // the current range. The old common-ancestor check blocked multi-bubble
        // selections because the shared ancestor is often outside this bubble.
        let intersects = false;
        try {
            intersects = range.intersectsNode(contentNode);
        } catch {
            intersects = false;
        }
        if (!intersects) {
            return;
        }

        const rect = range.getBoundingClientRect();
        setSelectionFromRect(rawText, {
            top: rect.top,
            left: rect.left,
            right: rect.right,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
        }, "message");
    };

    const handleEmailSelectionChange = (selection: EmailFrameSelection | null) => {
        if (!selection) {
            setSelectionTarget((prev) => (prev?.source === "email" ? null : prev));
            return;
        }
        setSelectionFromRect(selection.text, selection.rect, "email");
    };

    return (
        <div
            className={cn(
                "flex flex-col max-w-[85%] min-w-0 overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-300",
                isOutbound ? "ml-auto items-end" : "mr-auto items-start"
            )}
        >
            <div
                className={cn(
                    "relative px-4 py-3 rounded-2xl text-sm shadow-sm overflow-hidden w-full transition-all duration-200",
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
                {/* SMS/WhatsApp Header */}
                {(isSMS || isWhatsApp) && (
                    <div className={cn(
                        "px-3 py-1.5 text-[11px] flex items-center gap-2 border-b",
                        isOutbound ? "bg-blue-700/30 text-blue-100 border-blue-500/50" : "bg-gray-50 text-gray-500 border-gray-100"
                    )}>
                        <Smartphone className="h-3 w-3 shrink-0" />
                        <span>
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
                    "w-full break-words overflow-x-auto max-w-full transition-all duration-300 ease-in-out relative",
                    isEmail ? "bg-white text-black" : "", // Force white background for emails
                    isEmail && "p-4",
                    !isEmail && "whitespace-pre-wrap"
                )}
                    ref={contentRef}
                    onMouseUp={handleContentSelection}
                    onKeyUp={handleContentSelection}
                >
                    {isEmail && !isExpanded ? (
                        // Snippet View
                        <div className="text-gray-500 text-sm italic">
                            {snippet || "Click to view email content..."}
                        </div>
                    ) : (
                        // Full View
                        (isEmail || isRichHtml) ? (
                            <EmailFrame html={message.body} onSelectionChange={handleEmailSelectionChange} />
                        ) : (
                            <LinkifiedText text={message.body} />
                        )
                    )}
                </div>

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
                                className={cn(
                                    "rounded-lg border border-black/10 bg-black/5 p-2",
                                    isOutbound && !isEmail ? "bg-white/10 border-white/20" : "bg-black/[0.03]"
                                )}
                                onClick={(e) => e.stopPropagation()}
                            >
                                <audio
                                    controls
                                    preload="metadata"
                                    src={attachment.url}
                                    className="w-full max-w-[320px]"
                                />
                                <div className="mt-1 flex items-center gap-2 text-[11px]">
                                    <span className="truncate">{attachment.fileName || `Audio attachment ${i + 1}`}</span>
                                    <a
                                        href={getDownloadUrl(attachment.url)}
                                        download={attachment.fileName || `audio-${i + 1}`}
                                        className={cn(
                                            "ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-black/10",
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
                                                            "whitespace-pre-wrap leading-relaxed",
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
                                                        <div className="mt-1 space-y-0.5">
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
                                    "flex items-center gap-2 text-xs p-2 rounded hover:bg-black/5 transition-colors truncate max-w-full",
                                    isOutbound && !isEmail ? "text-blue-100 hover:bg-white/20" : "text-gray-600"
                                )}
                            >
                                <Paperclip className="h-3 w-3 shrink-0" />
                                <span className="truncate">{attachment.fileName || `Attachment ${i + 1}`}</span>
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

            {/* Timestamp */}
            <span className="text-[10px] text-gray-400 mt-1 px-1 flex gap-1 items-center select-none">
                {isEmail && <Mail className="h-3 w-3" />}
                {isSMS && <Smartphone className="h-3 w-3" />}
                {(message.contactName || contactName) && !isOutbound ? "Contact • " : "You • "}
                {format(new Date(message.dateAdded), 'PP p')}
            </span>

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
