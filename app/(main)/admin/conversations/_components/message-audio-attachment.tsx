"use client";

import { AlertTriangle, CheckCircle2, Download, FileAudio, Loader2, RefreshCw, Sparkles } from "lucide-react";
import type { MouseEvent } from "react";
import { cn } from "@/lib/utils";
import type { NormalizedMessageAttachment } from "./message-bubble-attachment-actions";
import type { MessageBubbleTheme } from "./message-bubble-theme";
import {
    formatExtractionSummary,
    getAudioAttachmentDescription,
    getAudioAttachmentTitle,
    getExtractionActionLabel,
    getTranscriptActionLabel,
    getTranscriptPreviewText,
    getTranscriptStatusLabel,
    isPendingStatus,
    shouldShowTranscriptToggle,
} from "./message-bubble-transcript-actions";

type MessageAudioAttachmentProps = {
    attachment: NormalizedMessageAttachment;
    index: number;
    messageId: string;
    theme: MessageBubbleTheme;
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
    theme,
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
    const transcript = attachment.transcript;
    const transcriptExpanded = isTranscriptExpanded(attachment.id, index);
    const transcriptText = transcript?.text || "";
    const extraction = transcript?.extraction;
    const extractionSummary = extraction ? formatExtractionSummary(extraction.payload) : null;
    const hasTranscript = !!attachment.transcript;
    const transcriptStatus = attachment.transcript?.status || null;
    const canRequestTranscript = !!onRequestTranscript && !!attachment.id;
    const canRetryTranscript = (!!onRequestTranscript || !!onRetryTranscript) && !!attachment.id;
    const isTranscriptActionActive = transcriptActionAttachmentId === attachment.id;
    const description = getAudioAttachmentDescription(attachment);
    const title = getAudioAttachmentTitle(index);
    const StatusIcon = transcriptStatus === "completed"
        ? CheckCircle2
        : transcriptStatus === "failed"
            ? AlertTriangle
            : isPendingStatus(transcriptStatus)
                ? Loader2
                : Sparkles;

    return (
        <div
            className={cn(
                "rounded-lg border border-black/10 bg-black/5 p-2.5 overflow-x-auto w-full max-w-full min-w-0",
                theme.attachmentShellClassName
            )}
            onClick={(e) => e.stopPropagation()}
        >
            <div className="mb-2 flex min-w-0 items-start gap-2">
                <div className={cn(
                    "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-black/10 bg-white/70",
                    theme.attachmentCardClassName
                )}>
                    <FileAudio className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <span className="font-medium leading-5">{title}</span>
                        <span className={cn(
                            "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide",
                            hasTranscript ? theme.transcriptStatusTone(transcriptStatus) : theme.attachmentButtonClassName
                        )}>
                            <StatusIcon className={cn("h-3 w-3", isPendingStatus(transcriptStatus) && "animate-spin")} />
                            {hasTranscript ? getTranscriptStatusLabel(transcriptStatus) : "Needs transcript"}
                        </span>
                    </div>
                    <p className={cn("mt-0.5 text-[11px]", theme.attachmentMutedTextClassName)}>
                        {description}
                    </p>
                </div>
                <a
                    href={getDownloadUrl(attachment.url)}
                    download={attachment.fileName || `audio-${index + 1}`}
                    className={cn(
                        "inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] hover:bg-black/10",
                        theme.attachmentDownloadClassName
                    )}
                    title="Download voice message"
                >
                    <Download className="h-3.5 w-3.5" />
                    Download
                </a>
            </div>
            <audio
                controls
                preload="metadata"
                src={attachment.url}
                className="w-full max-w-full min-w-0"
            />
            {!hasTranscript && canRequestTranscript && (
                <div className={cn("mt-2 rounded-md border px-2 py-1.5 text-xs", theme.attachmentCardClassName)}>
                    <div className="flex flex-wrap items-center gap-2">
                        <span className={cn("text-[11px]", theme.attachmentPrimaryTextClassName)}>
                            Transcript has not been created yet.
                        </span>
                        <button
                            type="button"
                            onClick={(e) => handleRequestTranscript(e, attachment.id, { force: false })}
                            disabled={isTranscriptActionActive}
                            className={cn(
                                "ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px]",
                                theme.attachmentButtonClassName
                            )}
                        >
                            <Sparkles className="h-3 w-3" />
                            {getTranscriptActionLabel({
                                activeAttachmentId: transcriptActionAttachmentId,
                                attachmentId: attachment.id,
                                mode: "start",
                            })}
                        </button>
                    </div>
                </div>
            )}

            {hasTranscript && attachment.transcript && (
                <div
                    className={cn(
                        "mt-2 rounded-md border px-2 py-1.5 text-xs",
                        theme.attachmentCardClassName
                    )}
                >
                    <div className="flex items-center gap-2">
                        <span className="font-medium">
                            Transcript
                        </span>
                        <span className={cn(
                            "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide",
                            theme.transcriptStatusTone(attachment.transcript.status)
                        )}>
                            <StatusIcon className={cn("h-3 w-3", isPendingStatus(attachment.transcript.status) && "animate-spin")} />
                            {getTranscriptStatusLabel(attachment.transcript.status)}
                        </span>
                        {attachment.transcript.model && (
                            <span className={cn(
                                "ml-auto text-[10px]",
                                theme.attachmentMutedTextClassName
                            )}>
                                {attachment.transcript.model}
                            </span>
                        )}
                    </div>

                    {isPendingStatus(attachment.transcript.status) && (
                        <p className={cn("mt-1 text-[11px]", theme.attachmentMutedTextClassName)}>
                            Transcribing...
                        </p>
                    )}

                    {attachment.transcript.status === "completed" && (
                        <div className="mt-1 space-y-2">
                            {attachment.transcript?.restricted ? (
                                <p className={cn("text-[11px] italic", theme.attachmentMutedTextClassName)}>
                                    Transcript text is hidden by policy.
                                </p>
                            ) : (
                                <>
                                    <p className={cn(
                                        "whitespace-pre-wrap leading-relaxed [overflow-wrap:anywhere] [word-break:break-word]",
                                        theme.attachmentPrimaryTextClassName
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
                                                theme.attachmentMutedTextClassName
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
                                            disabled={isTranscriptActionActive}
                                            className={cn(
                                                "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px]",
                                                theme.attachmentButtonClassName
                                            )}
                                        >
                                            <RefreshCw className="h-3 w-3" />
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
                                                theme.attachmentButtonClassName
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
                            <p className={cn("text-[11px]", theme.attachmentDangerTextClassName)}>
                                {attachment.transcript?.restricted
                                    ? "Transcript details are hidden by policy."
                                    : (attachment.transcript.error || "Transcription failed.")}
                            </p>
                            {!attachment.transcript?.restricted && (onRequestTranscript || onRetryTranscript) && attachment.id && (
                                <button
                                    type="button"
                                    onClick={(e) => handleRequestTranscript(e, attachment.id, { force: true })}
                                    disabled={!canRetryTranscript || isTranscriptActionActive}
                                    className={cn(
                                        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px]",
                                        theme.attachmentButtonClassName
                                    )}
                                >
                                    <RefreshCw className="h-3 w-3" />
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
                                theme.attachmentNestedCardClassName
                            )}
                        >
                            <div className="flex items-center gap-2">
                                <span className="font-medium">Viewing notes</span>
                                <span className={cn(
                                    "rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide",
                                    theme.transcriptStatusTone(attachment.transcript.extraction.status)
                                )}>
                                    {attachment.transcript.extraction.status}
                                </span>
                                {attachment.transcript.extraction.model && (
                                    <span className={cn(
                                        "ml-auto text-[10px]",
                                        theme.attachmentMutedTextClassName
                                    )}>
                                        {attachment.transcript.extraction.model}
                                    </span>
                                )}
                            </div>

                            {isPendingStatus(attachment.transcript.extraction.status) && (
                                <p className={cn("mt-1 text-[11px]", theme.attachmentMutedTextClassName)}>
                                    Extracting viewing notes...
                                </p>
                            )}

                            {attachment.transcript.extraction.status === "failed" && (
                                <div className="mt-1 space-y-1">
                                    <p className={cn("text-[11px]", theme.attachmentDangerTextClassName)}>
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
                                                theme.attachmentButtonClassName
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
                                    <p className={cn("mt-1 text-[11px] italic", theme.attachmentMutedTextClassName)}>
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
