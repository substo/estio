"use client";

import { Download, ExternalLink, FileVideo } from "lucide-react";
import { cn } from "@/lib/utils";
import type { NormalizedMessageAttachment } from "./message-bubble-attachment-actions";
import type { MessageBubbleTheme } from "./message-bubble-theme";

type MessageVideoAttachmentsProps = {
    videoAttachments: NormalizedMessageAttachment[];
    getDownloadUrl: (url: string) => string;
    theme: MessageBubbleTheme;
};

export function MessageVideoAttachments({
    videoAttachments,
    getDownloadUrl,
    theme,
}: MessageVideoAttachmentsProps) {
    return (
        <>
            {videoAttachments.map((attachment, i) => (
                <div
                    key={`video-${i}-${attachment.url}`}
                    className={cn(
                        "rounded-lg border border-black/10 bg-black/5 p-2.5 w-full max-w-full min-w-0",
                        theme.attachmentShellClassName
                    )}
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="mb-2 flex min-w-0 items-center gap-2">
                        <div className={cn(
                            "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-black/10 bg-white/70",
                            theme.attachmentCardClassName
                        )}>
                            <FileVideo className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-medium">
                                {attachment.fileName || `Video ${i + 1}`}
                            </p>
                            <p className={cn("truncate text-[11px]", theme.attachmentMutedTextClassName)}>
                                {attachment.mimeType || "Video attachment"}
                            </p>
                        </div>
                        <a
                            href={getDownloadUrl(attachment.url)}
                            download={attachment.fileName || `video-${i + 1}`}
                            className={cn(
                                "inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] hover:bg-black/10",
                                theme.attachmentDownloadClassName
                            )}
                            title="Download video"
                        >
                            <Download className="h-3.5 w-3.5" />
                            Download
                        </a>
                        <a
                            href={attachment.url}
                            target="_blank"
                            rel="noreferrer"
                            className={cn(
                                "inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] hover:bg-black/10",
                                theme.attachmentDownloadClassName
                            )}
                            title="Open video"
                        >
                            <ExternalLink className="h-3.5 w-3.5" />
                            Open
                        </a>
                    </div>
                    <video
                        controls
                        preload="metadata"
                        src={attachment.url}
                        className="block max-h-96 w-full rounded-md bg-black"
                    />
                </div>
            ))}
        </>
    );
}
