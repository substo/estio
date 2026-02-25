"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Mail, Smartphone, Paperclip, ExternalLink, ChevronDown, ChevronUp, ArrowRight, Download, Maximize2, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { EmailFrame } from "./email-frame";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { toast } from "sonner";
import { processLegacyCrmLeadEmailAction } from "@/app/(main)/admin/conversations/actions";

type MessageAttachment = string | {
    url: string;
    mimeType?: string | null;
    fileName?: string | null;
};

export interface MessageBubbleProps {
    message: {
        id: string;
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
}

export function MessageBubble({ message, contactPhone, contactEmail, contactName }: MessageBubbleProps) {
    const isOutbound = message.direction === 'outbound';
    const isEmail = (message.type || '').toUpperCase().includes('EMAIL');
    const isSMS = (message.type || '').toUpperCase().includes('SMS') || (message.type || '').toUpperCase().includes('PHONE');
    const isWhatsApp = (message.type || '').toUpperCase().includes('WHATSAPP');
    const [isExpanded, setIsExpanded] = useState(!isEmail); // Emails collapsed by default
    const [selectedImageIndex, setSelectedImageIndex] = useState<number | null>(null);
    const [legacyCrmLead, setLegacyCrmLead] = useState(message.legacyCrmLead || null);
    const [isProcessingLegacyLead, setIsProcessingLegacyLead] = useState(false);

    useEffect(() => {
        setLegacyCrmLead(message.legacyCrmLead || null);
    }, [message.id, message.legacyCrmLead]);

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
            ? { url: attachment, mimeType: undefined, fileName: undefined }
            : attachment
    );
    const imageAttachments = attachments.filter((attachment) => {
        const mimeType = (attachment.mimeType || "").toLowerCase();
        if (mimeType.startsWith("image/")) return true;

        const target = (attachment.fileName || attachment.url || "").toLowerCase().split("?")[0];
        return [".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".svg"].some((ext) => target.endsWith(ext));
    });
    const fileAttachments = attachments.filter((attachment) => !imageAttachments.includes(attachment));
    const selectedImage = selectedImageIndex !== null ? imageAttachments[selectedImageIndex] : null;
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

    const stopClick = (e: React.MouseEvent) => e.stopPropagation();
    const legacyStatus = String(legacyCrmLead?.status || '').toLowerCase();
    const showLegacyCrmActions = isEmail && !!legacyCrmLead;
    const canProcessLegacyLead = !!legacyCrmLead
        && (!!legacyCrmLead.canProcess || !legacyStatus)
        && !['processed', 'failed', 'ignored', 'processing'].includes(legacyStatus)
        && !isProcessingLegacyLead;
    const canReprocessLegacyLead = !!legacyCrmLead
        && (!!legacyCrmLead.canReprocess || ['processed', 'failed', 'ignored'].includes(legacyStatus))
        && ['processed', 'failed', 'ignored'].includes(legacyStatus)
        && !isProcessingLegacyLead;
    const openLeadHref = legacyCrmLead?.processedContactId ? `/admin/contacts/${legacyCrmLead.processedContactId}/view` : null;

    const getLegacyStatusLabel = () => {
        if (!legacyCrmLead) return null;
        if (!legacyCrmLead.status) return legacyCrmLead.matched ? "Detected" : "Legacy CRM";
        switch (legacyStatus) {
            case 'processed':
                return "Processed";
            case 'failed':
                return "Failed";
            case 'ignored':
                return "Ignored";
            case 'processing':
                return "Processing";
            case 'pending':
                return "Pending";
            default:
                return legacyCrmLead.status;
        }
    };

    const getLegacyStatusClassName = () => {
        switch (legacyStatus) {
            case 'processed':
                return "bg-green-50 text-green-700 border-green-200";
            case 'failed':
                return "bg-red-50 text-red-700 border-red-200";
            case 'ignored':
                return "bg-slate-50 text-slate-700 border-slate-200";
            case 'processing':
                return "bg-amber-50 text-amber-700 border-amber-200";
            case 'pending':
                return "bg-blue-50 text-blue-700 border-blue-200";
            default:
                return "bg-orange-50 text-orange-700 border-orange-200";
        }
    };

    async function handleProcessLegacyLead(force = false) {
        if (!isEmail || isProcessingLegacyLead) return;
        setIsProcessingLegacyLead(true);
        setLegacyCrmLead((prev: any) => prev ? ({ ...prev, status: 'processing' }) : prev);
        try {
            const result: any = await processLegacyCrmLeadEmailAction(message.id, force ? { force: true } : undefined);
            if (!result?.success) {
                toast.error(result?.error || "Failed to process legacy CRM lead email");
                setLegacyCrmLead((prev: any) => ({
                    ...(prev || {}),
                    status: 'failed',
                    error: result?.error || "Processing failed",
                    canProcess: true,
                    canReprocess: true,
                }));
                return;
            }

            const processing = result?.processing || {};
            const parsed = result?.parsed || {};
            const extracted = processing?.extracted && typeof processing.extracted === "object" ? processing.extracted : null;

            setLegacyCrmLead((prev: any) => ({
                ...(prev || {}),
                status: processing?.status || (result?.skipped ? 'ignored' : 'processed'),
                matched: extracted?.matched ?? parsed?.matched ?? prev?.matched ?? true,
                classification: processing?.classification ?? parsed?.classification ?? prev?.classification ?? null,
                senderMatchMode: extracted?.senderMatchMode ?? parsed?.senderMatchMode ?? prev?.senderMatchMode ?? null,
                reason: extracted?.reason ?? result?.reason ?? parsed?.reason ?? null,
                error: processing?.error ?? null,
                attempts: typeof processing?.attempts === 'number' ? processing.attempts : (prev?.attempts || 0),
                processedAt: processing?.processedAt ? new Date(processing.processedAt).toISOString() : (prev?.processedAt || null),
                processedContactId: processing?.processedContactId ?? result?.importResult?.contactId ?? prev?.processedContactId ?? null,
                processedConversationId: processing?.processedConversationId ?? result?.importResult?.internalConversationId ?? prev?.processedConversationId ?? null,
                legacyLeadUrl: processing?.legacyLeadUrl ?? parsed?.leadUrl ?? prev?.legacyLeadUrl ?? null,
                canProcess: ['pending', 'failed', 'ignored', ''].includes(String(processing?.status || '').toLowerCase()),
                canReprocess: ['processed', 'failed', 'ignored'].includes(String(processing?.status || '').toLowerCase()),
                detectionEnabled: prev?.detectionEnabled ?? true,
            }));

            if (result?.alreadyProcessed && !force) {
                toast.message("Legacy CRM lead email already processed");
            } else if (processing?.status === 'ignored') {
                toast.message(result?.reason || "Email ignored (not a recognized legacy CRM lead notification)");
            } else {
                toast.success(force ? "Legacy CRM lead email reprocessed" : "Legacy CRM lead email processed");
            }
        } catch (error: any) {
            toast.error(error?.message || "Failed to process legacy CRM lead email");
        } finally {
            setIsProcessingLegacyLead(false);
        }
    }

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

                        {showLegacyCrmActions && (
                            <div
                                className="px-4 py-2 border-t border-orange-100 bg-orange-50/40 flex flex-wrap items-center gap-2"
                                onClick={stopClick}
                            >
                                <Badge variant="outline" className={cn("border text-[11px]", getLegacyStatusClassName())}>
                                    Old CRM {legacyCrmLead?.classification === 'follow_up' ? 'Follow-up' : 'Lead'} • {getLegacyStatusLabel()}
                                </Badge>

                                {legacyCrmLead?.error && (
                                    <span
                                        className="text-[11px] text-red-600 truncate max-w-[220px]"
                                        title={legacyCrmLead.error}
                                    >
                                        {legacyCrmLead.error}
                                    </span>
                                )}

                                {!legacyCrmLead?.error && legacyCrmLead?.reason && legacyStatus === 'ignored' && (
                                    <span
                                        className="text-[11px] text-slate-600 truncate max-w-[240px]"
                                        title={legacyCrmLead.reason}
                                    >
                                        {legacyCrmLead.reason}
                                    </span>
                                )}

                                <div className="ml-auto flex items-center gap-1">
                                    {canProcessLegacyLead && (
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            className="h-7 px-2 text-[11px]"
                                            onClick={(e) => {
                                                stopClick(e);
                                                handleProcessLegacyLead(false);
                                            }}
                                        >
                                            {isProcessingLegacyLead ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                                            {isProcessingLegacyLead ? "Processing..." : "Process Lead"}
                                        </Button>
                                    )}

                                    {canReprocessLegacyLead && (
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="ghost"
                                            className="h-7 px-2 text-[11px]"
                                            onClick={(e) => {
                                                stopClick(e);
                                                handleProcessLegacyLead(true);
                                            }}
                                        >
                                            {isProcessingLegacyLead ? <Loader2 className="h-3 w-3 animate-spin" /> : "Reprocess"}
                                            {!isProcessingLegacyLead ? null : " Reprocessing..."}
                                        </Button>
                                    )}

                                    {openLeadHref && (
                                        <Link
                                            href={openLeadHref}
                                            className="inline-flex h-7 items-center rounded-md border px-2 text-[11px] font-medium text-slate-700 hover:bg-white"
                                            onClick={stopClick}
                                        >
                                            Open Lead
                                        </Link>
                                    )}

                                    {legacyCrmLead?.legacyLeadUrl && (
                                        <a
                                            href={legacyCrmLead.legacyLeadUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] font-medium text-slate-700 hover:bg-white"
                                            onClick={stopClick}
                                        >
                                            Old CRM
                                            <ExternalLink className="h-3 w-3" />
                                        </a>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Content Area */}
                <div className={cn(
                    "w-full break-words break-all overflow-x-auto max-w-full transition-all duration-300 ease-in-out relative",
                    isEmail ? "bg-white text-black" : "", // Force white background for emails
                    isEmail && "p-4",
                    !isEmail && "whitespace-pre-wrap"
                )}>
                    {isEmail && !isExpanded ? (
                        // Snippet View
                        <div className="text-gray-500 text-sm italic">
                            {snippet || "Click to view email content..."}
                        </div>
                    ) : (
                        // Full View
                        (isEmail || isRichHtml) ? (
                            <EmailFrame html={message.body} />
                        ) : (
                            message.body
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
