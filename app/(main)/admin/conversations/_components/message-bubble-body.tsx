"use client";

import { cn } from "@/lib/utils";
import type { MessageTranslationVariant } from "@/lib/ghl/conversations";
import { EmailFrame, type EmailFrameSelection } from "./email-frame";
import { LinkifiedText } from "./linkified-text";
import type { MessageBubbleTheme } from "./message-bubble-theme";

interface MessageBubbleBodyProps {
    body: string;
    isEmail: boolean;
    isExpanded: boolean;
    isOutbound: boolean;
    activeTranslation: MessageTranslationVariant | null;
    translationViewMode: "thread" | "original" | "translated";
    threadTranslationMode: "original" | "translated";
    theme: MessageBubbleTheme;
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
    theme: MessageBubbleTheme;
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
    theme,
    onEmailSelectionChange,
}: MessageBubbleBodyProps) {
    const isRichHtml = body ? isRichHtmlBody(body) : false;
    const effectiveViewMode = translationViewMode === "thread" ? threadTranslationMode : translationViewMode;
    const translatedText = String(activeTranslation?.translatedText || "").trim();
    const showTranslatedText = !isOutbound && !!translatedText && effectiveViewMode === "translated";
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
            <div className="space-y-0.5">
                <div className={cn(
                    "text-[11px] font-medium",
                    isOutbound ? theme.translationMetaClassName : "text-slate-500"
                )}>
                    {isOutbound ? "Sent to client" : `Translated${activeTranslation?.sourceLanguage ? ` from ${activeTranslation.sourceLanguage}` : ""}`}
                </div>
                <LinkifiedText text={translatedText} linkClassName={theme.linkClassName} />
            </div>
        );
    }

    if (effectiveViewMode !== "translated" && (isEmail || isRichHtml)) {
        return <EmailFrame html={body} onSelectionChange={onEmailSelectionChange} />;
    }

    if ((isEmail || isRichHtml) && !activeTranslation) {
        return <EmailFrame html={body} onSelectionChange={onEmailSelectionChange} />;
    }
    if (sourceText && effectiveViewMode === "translated") {
        return (
            <div className="space-y-0.5">
                <div className={cn(
                    "text-[11px] font-medium",
                    isOutbound ? theme.translationMetaClassName : "text-slate-500"
                )}>
                    Internal source
                </div>
                <LinkifiedText text={sourceText} linkClassName={theme.linkClassName} />
            </div>
        );
    }
    return <LinkifiedText text={sourceText || body} linkClassName={theme.linkClassName} />;
}

export function MessageBubbleTranslationActions({
    isEmail,
    isOutbound,
    activeTranslation,
    translationViewMode,
    threadTranslationMode,
    canTranslateMessage,
    isTranslatingMessage,
    theme,
    onTranslateMessage,
    onToggleTranslationViewMode,
}: MessageBubbleTranslationActionsProps) {
    if (!canTranslateMessage && !activeTranslation) return null;
    return (
        <div className={cn(isEmail ? "bg-white px-4 pb-1" : "pt-1")}>
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
                            isOutbound ? theme.translationPrimaryActionClassName : "text-blue-600 hover:bg-blue-50"
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
                                isOutbound ? theme.translationSecondaryActionClassName : "text-slate-600 hover:bg-slate-100"
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
                                    isOutbound ? theme.translationPrimaryActionClassName : "text-blue-600 hover:bg-blue-50"
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
