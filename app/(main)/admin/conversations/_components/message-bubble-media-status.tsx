"use client";

import { AlertTriangle, Download, ExternalLink, Paperclip, RefreshCw, User } from "lucide-react";
import { memo } from "react";
import type { MouseEvent } from "react";
import { cn } from "@/lib/utils";
import type { NormalizedMessageAttachment, WebBridgeMediaState } from "./message-bubble-attachment-actions";
import type { MessageBubbleTheme } from "./message-bubble-theme";

type MessageBubbleMediaStatusProps = {
    contactAttachments: NormalizedMessageAttachment[];
    fileAttachments: NormalizedMessageAttachment[];
    webBridgeMedia: WebBridgeMediaState;
    hasUnstoredWebBridgeMedia: boolean;
    canRefetchMedia: boolean;
    isRefetchingMedia: boolean;
    handleRefetchMedia: (e: MouseEvent<HTMLButtonElement>) => void | Promise<void>;
    getDownloadUrl: (url: string) => string;
    attachmentsLength: number;
    isEmail: boolean;
    theme: MessageBubbleTheme;
};

function MessageBubbleMediaStatusComponent({
    contactAttachments,
    fileAttachments,
    webBridgeMedia,
    hasUnstoredWebBridgeMedia,
    canRefetchMedia,
    isRefetchingMedia,
    handleRefetchMedia,
    getDownloadUrl,
    attachmentsLength,
    isEmail,
    theme,
}: MessageBubbleMediaStatusProps) {
    const refetchStatus = String(webBridgeMedia?.refetch?.status || "");
    const isRefetchInProgress = refetchStatus === "queued" || refetchStatus === "processing";
    const refetchStageLabel = formatMediaRefetchStage(webBridgeMedia?.refetch?.stage);
    const refetchError = webBridgeMedia?.refetch?.error || null;

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
                        theme.mediaContactLinkClassName
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
                        theme.mediaFileLinkClassName
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
                        theme.mediaUnavailableCardClassName
                    )}>
                        <div className="flex items-start gap-2">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            <div className="min-w-0 space-y-0.5">
                                <div className="font-medium">Media not stored</div>
                                <div className="break-words">
                                    {webBridgeMedia.error || webBridgeMedia.reason || "WhatsApp sent media, but Estio could not store the attachment yet."}
                                </div>
                                {(webBridgeMedia.meta?.filename || webBridgeMedia.meta?.mimetype) && (
                                    <div className={cn("truncate", theme.mediaUnavailableMutedTextClassName)}>
                                        {[webBridgeMedia.meta?.filename, webBridgeMedia.meta?.mimetype].filter(Boolean).join(" · ")}
                                    </div>
                                )}
                                {isRefetchInProgress && (
                                    <div className={cn("mt-1 inline-flex items-center gap-1.5", theme.mediaUnavailableMutedTextClassName)}>
                                        <RefreshCw className="h-3 w-3 animate-spin" />
                                        <span>{refetchStageLabel || "Re-fetching media"} · runs in background</span>
                                    </div>
                                )}
                                {!isRefetchInProgress && refetchStatus === "failed" && refetchError && (
                                    <div className={cn("mt-1 break-words", theme.mediaUnavailableMutedTextClassName)}>
                                        Last re-fetch failed: {refetchError}
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
                            theme.mediaRefetchButtonClassName
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

export const MessageBubbleMediaStatus = memo(MessageBubbleMediaStatusComponent);

function formatMediaRefetchStage(stage?: string | null) {
    switch (stage) {
        case "queued":
            return "Queued";
        case "fetching_from_bridge":
            return "Fetching from WhatsApp Web";
        case "storing_media":
            return "Storing media";
        case "completed":
            return "Stored";
        case "ingest_failed":
            return "Storage failed";
        case "missing_media_payload":
            return "Media payload missing";
        case "bridge_message_missing":
            return "Message not found in WhatsApp Web";
        default:
            return stage ? stage.replace(/_/g, " ") : null;
    }
}
