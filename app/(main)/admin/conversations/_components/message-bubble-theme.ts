"use client";

import type { TranscriptStatus } from "./message-bubble-transcript-actions";

export type MessageBubbleThemeInput = {
    isWhatsApp: boolean;
    isSMS: boolean;
    isEmail: boolean;
    isOutbound: boolean;
};

export type MessageBubbleTheme = {
    channel: "email" | "whatsapp" | "sms" | "default";
    isWhatsApp: boolean;
    bubbleClassName: string;
    channelHeaderClassName: string;
    channelHeaderIconClassName: string;
    timestampTextClassName: string;
    translationPrimaryActionClassName: string;
    translationSecondaryActionClassName: string;
    translationMetaClassName: string;
    linkClassName: string;
    attachmentShellClassName: string;
    attachmentDownloadClassName: string;
    attachmentCardClassName: string;
    attachmentNestedCardClassName: string;
    attachmentMutedTextClassName: string;
    attachmentPrimaryTextClassName: string;
    attachmentDangerTextClassName: string;
    attachmentButtonClassName: string;
    mediaContactLinkClassName: string;
    mediaFileLinkClassName: string;
    mediaUnavailableCardClassName: string;
    mediaUnavailableMutedTextClassName: string;
    mediaRefetchButtonClassName: string;
    transcriptStatusTone: (status: TranscriptStatus) => string | false;
};

const defaultInboundTheme = {
    channel: "default" as const,
    isWhatsApp: false,
    bubbleClassName: "bg-white text-gray-800 border rounded-tl-none",
    channelHeaderClassName: "bg-gray-50 text-gray-500 border-gray-100",
    channelHeaderIconClassName: "text-gray-400",
    timestampTextClassName: "text-gray-400",
    translationPrimaryActionClassName: "text-blue-600 hover:bg-blue-50",
    translationSecondaryActionClassName: "text-slate-600 hover:bg-slate-100",
    translationMetaClassName: "text-slate-500",
    linkClassName: "text-blue-700 underline decoration-blue-300 hover:text-blue-900",
    attachmentShellClassName: "bg-black/[0.03] border-black/10 text-gray-700",
    attachmentDownloadClassName: "text-gray-600 hover:bg-black/10",
    attachmentCardClassName: "border-black/10 bg-white/70 text-gray-700",
    attachmentNestedCardClassName: "border-black/10 bg-white text-gray-700",
    attachmentMutedTextClassName: "text-gray-600",
    attachmentPrimaryTextClassName: "text-gray-700",
    attachmentDangerTextClassName: "text-red-600",
    attachmentButtonClassName: "bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-70",
    mediaContactLinkClassName: "border-blue-100 bg-blue-50 text-blue-700 hover:bg-blue-100",
    mediaFileLinkClassName: "text-gray-600 hover:bg-black/5",
    mediaUnavailableCardClassName: "border-amber-200 bg-amber-50 text-amber-900",
    mediaUnavailableMutedTextClassName: "text-amber-800",
    mediaRefetchButtonClassName: "border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-70",
    transcriptStatusTone: getLightTranscriptStatusTone,
};

const smsOutboundTheme: MessageBubbleTheme = {
    ...defaultInboundTheme,
    channel: "sms",
    bubbleClassName: "bg-blue-600 text-white rounded-tr-none",
    channelHeaderClassName: "bg-blue-700/30 text-blue-100 border-blue-500/50",
    channelHeaderIconClassName: "text-blue-100",
    timestampTextClassName: "text-gray-400",
    translationPrimaryActionClassName: "text-blue-100 hover:bg-white/20",
    translationSecondaryActionClassName: "text-blue-100 hover:bg-white/20",
    translationMetaClassName: "text-blue-100",
    linkClassName: "text-blue-50 underline decoration-blue-100/80 hover:text-white",
    attachmentShellClassName: "bg-white/10 border-white/20 text-blue-50",
    attachmentDownloadClassName: "text-blue-100 hover:bg-white/20",
    attachmentCardClassName: "border-white/20 bg-white/10 text-blue-50",
    attachmentNestedCardClassName: "border-white/20 bg-white/10 text-blue-50",
    attachmentMutedTextClassName: "text-blue-100/90",
    attachmentPrimaryTextClassName: "text-blue-50",
    attachmentDangerTextClassName: "text-red-100",
    attachmentButtonClassName: "bg-white/20 text-blue-50 hover:bg-white/30 disabled:opacity-70",
    mediaContactLinkClassName: "border-white/20 bg-white/10 text-blue-100 hover:bg-white/20",
    mediaFileLinkClassName: "text-blue-100 hover:bg-white/20",
    mediaUnavailableCardClassName: "border-white/25 bg-white/10 text-blue-50",
    mediaUnavailableMutedTextClassName: "text-blue-100/85",
    mediaRefetchButtonClassName: "border-white/30 text-blue-100 hover:bg-white/20 disabled:opacity-70",
    transcriptStatusTone: getDarkTranscriptStatusTone,
};

const whatsappOutboundTheme: MessageBubbleTheme = {
    ...smsOutboundTheme,
    channel: "whatsapp",
    isWhatsApp: true,
    bubbleClassName: "bg-[#dcf8c6] text-slate-900 border border-[#b7e4a6] rounded-tr-[4px]",
    channelHeaderClassName: "bg-[#cdeeb8] text-emerald-900 border-[#b7e4a6]",
    channelHeaderIconClassName: "text-emerald-700",
    translationPrimaryActionClassName: "text-emerald-800 hover:bg-emerald-100/70",
    translationSecondaryActionClassName: "text-slate-700 hover:bg-emerald-100/70",
    translationMetaClassName: "text-emerald-800",
    linkClassName: "text-emerald-900 underline decoration-emerald-600/60 hover:text-emerald-700",
    attachmentShellClassName: "bg-white/55 border-emerald-200 text-slate-800",
    attachmentDownloadClassName: "text-emerald-800 hover:bg-emerald-100/70",
    attachmentCardClassName: "border-emerald-200 bg-white/70 text-slate-800",
    attachmentNestedCardClassName: "border-emerald-200 bg-white/80 text-slate-800",
    attachmentMutedTextClassName: "text-slate-600",
    attachmentPrimaryTextClassName: "text-slate-800",
    attachmentDangerTextClassName: "text-red-700",
    attachmentButtonClassName: "bg-emerald-50 text-emerald-900 hover:bg-emerald-100 disabled:opacity-70",
    mediaContactLinkClassName: "border-emerald-200 bg-white/65 text-emerald-900 hover:bg-white/90",
    mediaFileLinkClassName: "text-emerald-900 hover:bg-emerald-100/70",
    mediaUnavailableCardClassName: "border-amber-200 bg-amber-50 text-amber-950",
    mediaUnavailableMutedTextClassName: "text-amber-800",
    mediaRefetchButtonClassName: "border-emerald-300 text-emerald-900 hover:bg-emerald-100 disabled:opacity-70",
    transcriptStatusTone: getWhatsAppTranscriptStatusTone,
};

const whatsappInboundTheme: MessageBubbleTheme = {
    ...defaultInboundTheme,
    channel: "whatsapp",
    isWhatsApp: true,
    bubbleClassName: "bg-white text-slate-900 border border-emerald-100 rounded-tl-[4px]",
    channelHeaderClassName: "bg-emerald-50 text-emerald-800 border-emerald-100",
    channelHeaderIconClassName: "text-emerald-600",
    timestampTextClassName: "text-slate-400",
};

const smsInboundTheme: MessageBubbleTheme = {
    ...defaultInboundTheme,
    channel: "sms",
    bubbleClassName: "bg-white text-gray-800 border rounded-tl-none",
};

export function getMessageBubbleTheme(input: MessageBubbleThemeInput): MessageBubbleTheme {
    if (input.isEmail) {
        return {
            ...(input.isOutbound ? smsOutboundTheme : defaultInboundTheme),
            channel: "email",
            isWhatsApp: false,
        };
    }
    if (input.isWhatsApp) return input.isOutbound ? whatsappOutboundTheme : whatsappInboundTheme;
    if (input.isSMS) return input.isOutbound ? smsOutboundTheme : smsInboundTheme;
    return input.isOutbound ? smsOutboundTheme : defaultInboundTheme;
}

export function getConversationTimelineClassName(input: { isWhatsApp: boolean }) {
    return input.isWhatsApp
        ? "bg-[#f3f5ee]"
        : "bg-slate-50/50";
}

const conversationPaneHorizontalClassName = "px-2.5 sm:px-4 lg:px-5";

export function getConversationTimelineScrollClassName() {
    return `${conversationPaneHorizontalClassName} py-2 sm:py-3`;
}

export function getConversationComposerContentClassName() {
    return `w-full min-w-0 max-w-full ${conversationPaneHorizontalClassName} py-2`;
}

export function getConversationTimelineContentClassName() {
    return "space-y-2 sm:space-y-2.5 min-w-0 max-w-full";
}

export function getDealTimelineScrollClassName() {
    return "p-2.5 sm:p-3";
}

function getLightTranscriptStatusTone(status: TranscriptStatus): string | false {
    if (status === "completed") return "bg-emerald-100 text-emerald-700";
    if (status === "failed") return "bg-red-100 text-red-700";
    if (status === "pending" || status === "processing") return "bg-amber-100 text-amber-700";
    return false;
}

function getDarkTranscriptStatusTone(status: TranscriptStatus): string | false {
    if (status === "completed") return "bg-emerald-500/25 text-emerald-100";
    if (status === "failed") return "bg-red-500/25 text-red-100";
    if (status === "pending" || status === "processing") return "bg-amber-500/25 text-amber-100";
    return false;
}

function getWhatsAppTranscriptStatusTone(status: TranscriptStatus): string | false {
    if (status === "completed") return "bg-emerald-100 text-emerald-800";
    if (status === "failed") return "bg-red-100 text-red-700";
    if (status === "pending" || status === "processing") return "bg-amber-100 text-amber-800";
    return false;
}
