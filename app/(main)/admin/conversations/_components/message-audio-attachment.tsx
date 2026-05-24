"use client";

import { Download } from "lucide-react";
import type { MouseEvent } from "react";
import { cn } from "@/lib/utils";
import type { NormalizedMessageAttachment } from "./message-bubble-attachment-actions";
import {
    formatExtractionSummary,
    getExtractionActionLabel,
    getExtractionStatusTone,
    getTranscriptActionLabel,
    getTranscriptPreviewText,
    getTranscriptStatusTone,
    isPendingStatus,
    shouldShowTranscriptToggle,
} from "./message-bubble-transcript-actions";

type MessageAudioAttachmentProps = {
    attachment: NormalizedMessageAttachment;
    index: number;
    messageId: string;
    isOutbound: boolean;
    isEmail: boolean;
    transcriptActionAttachmentId: string | null;
    extractActionAttachmentId: string | null;
    isTranscriptExpanded: (attachmentId?: string, fallbackIndex?: number) => boolean;
    toggleTranscriptExpanded: (attachmentId?: string, fallbackIndex?: number) => void;
    handleRequestTranscript: (
        e: MouseEvent<HTMLButtonElement>,
        attachmentId?: string,
        options?: { force?: boolean }
    ) => void | Promise<void>;
    handleExtractViewingNotes: (
        e: MouseEvent<HTMLButtonElement>,
        attachmentId?: string,
        options?: { force?: boolean }
    ) => void | Promise<void>;
    getDownloadUrl: (url: string) => string;
    onRequestTranscript?: (
        messageId: string,
        attachmentId: string,
        options?: { force?: boolean }
    ) => void | Promise<void>;
    onRetryTranscript?: (messageId: string, attachmentId: string) => void | Promise<void>;
    onExtractViewingNotes?: (
        messageId: string,
        attachmentId: string,
        options?: { force?: boolean }
    ) => void | Promise<void>;
};

export function MessageAudioAttachment({
    attachment,
    index,
    messageId: _messageId,
    isOutbound,
    isEmail,
    transcriptActionAttachmentId,
    extractActionAttachmentId,
    isTranscriptExpanded,
    toggleTranscriptExpanded,
    handleRequestTranscript,
    handleExtractViewingNotes,
    getDownloadUrl,
    onRequestTranscript,
    onRetryTranscript,
    onExtractViewingNotes,
}: MessageAudioAttachmentProps) {
    const isOutboundBubble = isOutbound && !isEmail;
    const transcript = attachment.transcript;
    const transcriptExpanded = isTranscriptExpanded(attachment.id, index);
    const transcriptText = transcript?.text || "";
    const extraction = transcript?.extraction;
    const extractionSummary = extraction ? formatExtractionSummary(extraction.payload) : null;

    return (
        <div
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
                <span className="min-w-0 flex-1 truncate">{attachment.fileName || `Audio attachment ${index + 1}`}</span>
                <a
                    href={getDownloadUrl(attachment.url)}
                    download={attachment.fileName || `audio-${index + 1}`}
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
                            {getTranscriptActionLabel({
                                activeAttachmentId: transcriptActionAttachmentId,
                                attachmentId: attachment.id,
                                mode: "start",
                            })}
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
                            getTranscriptStatusTone(attachment.transcript.status, isOutboundBubble)
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

                    {isPendingStatus(attachment.transcript.status) && (
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
                                        {getTranscriptPreviewText(transcriptText, transcriptExpanded)}
                                    </p>
                                    {shouldShowTranscriptToggle(transcriptText) && (
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                toggleTranscriptExpanded(attachment.id, index);
                                            }}
                                            className={cn(
                                                "text-[11px] underline underline-offset-2",
                                                isOutbound && !isEmail ? "text-blue-100 hover:text-white" : "text-gray-600 hover:text-gray-900"
                                            )}
                                        >
                                            {transcriptExpanded ? "Show less" : "Show more"}
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
                                            {getTranscriptActionLabel({
                                                activeAttachmentId: transcriptActionAttachmentId,
                                                attachmentId: attachment.id,
                                                mode: "regenerate",
                                            })}
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
                                            {getExtractionActionLabel({
                                                activeAttachmentId: extractActionAttachmentId,
                                                attachmentId: attachment.id,
                                                hasExtraction: !!attachment.transcript?.extraction,
                                            })}
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
                                    {getTranscriptActionLabel({
                                        activeAttachmentId: transcriptActionAttachmentId,
                                        attachmentId: attachment.id,
                                        mode: "retry",
                                    })}
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
                                    getExtractionStatusTone(attachment.transcript.extraction.status, isOutboundBubble)
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

                            {isPendingStatus(attachment.transcript.extraction.status) && (
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
                                            {getExtractionActionLabel({
                                                activeAttachmentId: extractActionAttachmentId,
                                                attachmentId: attachment.id,
                                                retry: true,
                                            })}
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
                                        <p>Prospects: {extractionSummary?.prospects}</p>
                                        <p>Requirements: {extractionSummary?.requirements}</p>
                                        <p>Budget: {extractionSummary?.budget}</p>
                                        <p>Locations: {extractionSummary?.locations}</p>
                                        <p>Objections: {extractionSummary?.objections}</p>
                                        <p>Next actions: {extractionSummary?.nextActions}</p>
                                    </div>
                                )
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
