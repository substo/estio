"use client";

import { cn } from "@/lib/utils";
import type { MessageTranslationVariant } from "@/lib/ghl/conversations";
import { EmailFrame, type EmailFrameSelection } from "./email-frame";
import { LinkifiedText } from "./linkified-text";

interface MessageBubbleBodyProps {
    body: string;
    isEmail: boolean;
    isExpanded: boolean;
    isOutbound: boolean;
    activeTranslation: MessageTranslationVariant | null;
    translationViewMode: "thread" | "original" | "translated";
    threadTranslationMode: "original" | "translated";
    onEmailSelectionChange: (selection: EmailFrameSelection | null) => void;
}

interface MessageBubbleTranslationActionsProps {
    isEmail: boolean;
    isOutbound: boolean;
    activeTranslation: MessageTranslationVariant | null;
    translationViewMode: "thread" | "original" | "translated";
    threadTranslationMode: "original" | "translated";
    canTranslateMessage: boolean;
    isTranslatingMessage: boolean;
    onTranslateMessage: () => void;
    onToggleTranslationViewMode: () => void;
}

const isRichHtmlBody = (body: string) => (
    body.includes("<div") || body.includes("<html") || body.includes("<table")
);

const getEmailSnippet = (html: string) => {
    if (!html) return "";
    const text = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    return text.substring(0, 150) + (text.length > 150 ? "..." : "");
};

export function getMessageBubbleTranslationToggleLabel({
    isOutbound,
    translationViewMode,
    threadTranslationMode,
}: Pick<MessageBubbleTranslationActionsProps, "isOutbound" | "translationViewMode" | "threadTranslationMode">) {
    const effectiveViewMode = translationViewMode === "thread" ? threadTranslationMode : translationViewMode;
    if (isOutbound) {
        return effectiveViewMode === "translated" ? "Show sent" : "Show source";
    }
    return effectiveViewMode === "translated" ? "Show original" : "Show translation";
}

export function MessageBubbleBody({
    body,
    isEmail,
    isExpanded,
    isOutbound,
    activeTranslation,
    translationViewMode,
    threadTranslationMode,
    onEmailSelectionChange,
}: MessageBubbleBodyProps) {
    const isRichHtml = body ? isRichHtmlBody(body) : false;
    const effectiveViewMode = translationViewMode === "thread" ? threadTranslationMode : translationViewMode;
    const translatedText = String(activeTranslation?.translatedText || "").trim();
    const showTranslatedText = !!translatedText && effectiveViewMode === "translated";
    const sourceText = isOutbound && activeTranslation?.sourceText
        ? String(activeTranslation.sourceText || "").trim()
        : "";

    if (isEmail && !isExpanded) {
        return (
            <div className="text-gray-500 text-sm italic">
                {getEmailSnippet(body) || "Click to view email content..."}
            </div>
        );
    }

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
        return <EmailFrame html={body} onSelectionChange={onEmailSelectionChange} />;
    }

    if ((isEmail || isRichHtml) && !activeTranslation) {
        return <EmailFrame html={body} onSelectionChange={onEmailSelectionChange} />;
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
    return <LinkifiedText text={sourceText || body} />;
}

export function MessageBubbleTranslationActions({
    isEmail,
    isOutbound,
    activeTranslation,
    translationViewMode,
    threadTranslationMode,
    canTranslateMessage,
    isTranslatingMessage,
    onTranslateMessage,
    onToggleTranslationViewMode,
}: MessageBubbleTranslationActionsProps) {
    if (!canTranslateMessage && !activeTranslation) return null;
    return (
        <div className={cn("px-4 pb-1", isEmail && "bg-white")}>
            <div className="flex items-center gap-2 text-[11px]">
                {canTranslateMessage && !activeTranslation && (
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            onTranslateMessage();
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
                                onToggleTranslationViewMode();
                            }}
                            className={cn(
                                "rounded px-1.5 py-0.5",
                                isOutbound ? "text-blue-100 hover:bg-white/20" : "text-slate-600 hover:bg-slate-100"
                            )}
                        >
                            {getMessageBubbleTranslationToggleLabel({
                                isOutbound,
                                translationViewMode,
                                threadTranslationMode,
                            })}
                        </button>
                        {canTranslateMessage && (
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onTranslateMessage();
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
    );
}
