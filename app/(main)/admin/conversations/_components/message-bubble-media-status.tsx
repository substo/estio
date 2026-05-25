"use client";

import { AlertTriangle, Download, ExternalLink, Paperclip, RefreshCw, User } from "lucide-react";
import type { MouseEvent } from "react";
import { cn } from "@/lib/utils";
import type { NormalizedMessageAttachment } from "./message-bubble-attachment-actions";

type WebBridgeMedia = {
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

type MessageBubbleMediaStatusProps = {
    contactAttachments: NormalizedMessageAttachment[];
    fileAttachments: NormalizedMessageAttachment[];
    webBridgeMedia: WebBridgeMedia;
    hasUnstoredWebBridgeMedia: boolean;
    canRefetchMedia: boolean;
    isRefetchingMedia: boolean;
    handleRefetchMedia: (e: MouseEvent<HTMLButtonElement>) => void | Promise<void>;
    getDownloadUrl: (url: string) => string;
    attachmentsLength: number;
    isOutbound: boolean;
    isEmail: boolean;
};

export function MessageBubbleMediaStatus({
    contactAttachments,
    fileAttachments,
    webBridgeMedia,
    hasUnstoredWebBridgeMedia,
    canRefetchMedia,
    isRefetchingMedia,
    handleRefetchMedia,
    getDownloadUrl,
    attachmentsLength,
    isOutbound,
    isEmail,
}: MessageBubbleMediaStatusProps) {
    return (
        <>
            {contactAttachments.map((attachment, i) => (
                <a
                    key={`contact-file-${i}-${attachment.url}`}
                    href={getDownloadUrl(attachment.url)}
                    download={attachment.fileName || `contact-${i + 1}.vcf`}
                    onClick={(e) => e.stopPropagation()}
                    className={cn(
                        "flex min-w-0 w-full max-w-full items-center gap-2 text-xs p-2 rounded border transition-colors",
                        isOutbound && !isEmail
                            ? "border-white/20 bg-white/10 text-blue-100 hover:bg-white/20"
                            : "border-blue-100 bg-blue-50 text-blue-700 hover:bg-blue-100"
                    )}
                >
                    <User className="h-3 w-3 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">
                        {attachment.fileName || `Contact card ${i + 1}`}
                    </span>
                    <Download className="h-3 w-3 shrink-0 opacity-70" />
                    <span className="shrink-0">Download vCard</span>
                </a>
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

            {hasUnstoredWebBridgeMedia && webBridgeMedia && (
                <div className={cn("px-4 pb-2 mt-2", isEmail && "bg-gray-50 pt-2 border-t")}>
                    <div className={cn(
                        "rounded-md border px-3 py-2 text-xs",
                        isOutbound && !isEmail
                            ? "border-white/25 bg-white/10 text-blue-50"
                            : "border-amber-200 bg-amber-50 text-amber-900"
                    )}>
                        <div className="flex items-start gap-2">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            <div className="min-w-0 space-y-0.5">
                                <div className="font-medium">Media not stored</div>
                                <div className="break-words">
                                    {webBridgeMedia.error || webBridgeMedia.reason || "WhatsApp sent media, but Estio could not store the attachment yet."}
                                </div>
                                {(webBridgeMedia.meta?.filename || webBridgeMedia.meta?.mimetype) && (
                                    <div className={cn("truncate", isOutbound && !isEmail ? "text-blue-100/80" : "text-amber-800")}>
                                        {[webBridgeMedia.meta?.filename, webBridgeMedia.meta?.mimetype].filter(Boolean).join(" · ")}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {canRefetchMedia && (
                <div className={cn("px-4 pb-2 mt-1", attachmentsLength === 0 && "pt-2")}>
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
        </>
    );
}
