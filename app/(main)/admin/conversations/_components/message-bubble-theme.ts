"use client";

import type { TranscriptStatus } from "./message-bubble-transcript-actions";

export type MessageBubbleThemeInput = {
    isWhatsApp: boolean;
    isSMS: boolean;
    isEmail: boolean;
    isOutbound: boolean;
};

export type ConversationSurfaceChannel = "SMS" | "Email" | "WhatsApp" | "SMS_RELAY" | "default";

export type ConversationSurfaceTheme = {
    channel: ConversationSurfaceChannel;
    rootClassName: string;
    timelineClassName: string;
    loadingIconClassName: string;
    highlightedMessageClassName: string;
    searchActiveChipClassName: string;
    searchResultHoverClassName: string;
    composerContainerClassName: string;
    composerShellClassName: string;
    composerControlClassName: string;
    composerPrimaryButtonClassName: string;
    composerPrimaryButtonDisabledClassName: string;
    composerIconButtonClassName: string;
    suggestedQueueClassName: string;
    suggestedQueuePrimaryButtonClassName: string;
    activityDividerClassName: string;
    activityPillClassName: string;
    activityPillHoverClassName: string;
    activityContentClassName: string;
    activityManualIconClassName: string;
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
    sharedContactCardClassName: string;
    sharedContactAvatarClassName: string;
    sharedContactAvatarIconClassName: string;
    sharedContactNameClassName: string;
    sharedContactMetaClassName: string;
    sharedContactInfoLinkClassName: string;
    sharedContactHydratingClassName: string;
    sharedContactSavedClassName: string;
    sharedContactSecondaryActionClassName: string;
    sharedContactPrimaryActionClassName: string;
    sharedContactErrorClassName: string;
    sharedContactDownloadClassName: string;
    transcriptStatusTone: (status: TranscriptStatus) => string | false;
};

const defaultInboundTheme = {
    channel: "default" as const,
    isWhatsApp: false,
    bubbleClassName: "bg-white text-gray-800 border rounded-tl-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100",
    channelHeaderClassName: "bg-gray-50 text-gray-500 border-gray-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300",
    channelHeaderIconClassName: "text-gray-400 dark:text-slate-400",
    timestampTextClassName: "text-gray-400 dark:text-slate-500",
    translationPrimaryActionClassName: "text-blue-600 hover:bg-blue-50",
    translationSecondaryActionClassName: "text-slate-600 hover:bg-slate-100",
    translationMetaClassName: "text-slate-500",
    linkClassName: "text-blue-700 underline decoration-blue-300 hover:text-blue-900",
    attachmentShellClassName: "bg-black/[0.03] border-black/10 text-gray-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-200",
    attachmentDownloadClassName: "text-gray-600 hover:bg-black/10 dark:text-slate-300 dark:hover:bg-white/10",
    attachmentCardClassName: "border-black/10 bg-white/70 text-gray-700 dark:border-white/10 dark:bg-slate-800/80 dark:text-slate-200",
    attachmentNestedCardClassName: "border-black/10 bg-white text-gray-700 dark:border-white/10 dark:bg-slate-950 dark:text-slate-200",
    attachmentMutedTextClassName: "text-gray-600 dark:text-slate-400",
    attachmentPrimaryTextClassName: "text-gray-700 dark:text-slate-100",
    attachmentDangerTextClassName: "text-red-600",
    attachmentButtonClassName: "bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-70",
    mediaContactLinkClassName: "border-blue-100 bg-blue-50 text-blue-700 hover:bg-blue-100",
    mediaFileLinkClassName: "text-gray-600 hover:bg-black/5",
    mediaUnavailableCardClassName: "border-amber-200 bg-amber-50 text-amber-900",
    mediaUnavailableMutedTextClassName: "text-amber-800",
    mediaRefetchButtonClassName: "border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-70",
    sharedContactCardClassName: "border-gray-200 bg-gray-50 dark:border-slate-700 dark:bg-slate-800",
    sharedContactAvatarClassName: "bg-blue-100",
    sharedContactAvatarIconClassName: "text-blue-600",
    sharedContactNameClassName: "text-gray-900 dark:text-slate-100",
    sharedContactMetaClassName: "text-gray-500 dark:text-slate-400",
    sharedContactInfoLinkClassName: "text-gray-600 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-700",
    sharedContactHydratingClassName: "text-muted-foreground",
    sharedContactSavedClassName: "text-emerald-600",
    sharedContactSecondaryActionClassName: "bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-60",
    sharedContactPrimaryActionClassName: "bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60",
    sharedContactErrorClassName: "text-red-600",
    sharedContactDownloadClassName: "bg-blue-50 text-blue-700 hover:bg-blue-100",
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
    sharedContactCardClassName: "border-white/20 bg-white/10",
    sharedContactAvatarClassName: "bg-white/20",
    sharedContactAvatarIconClassName: "text-white",
    sharedContactNameClassName: "text-white",
    sharedContactMetaClassName: "text-blue-100",
    sharedContactInfoLinkClassName: "text-blue-100 hover:bg-white/10",
    sharedContactHydratingClassName: "text-white/70",
    sharedContactSavedClassName: "text-emerald-200",
    sharedContactSecondaryActionClassName: "bg-white/20 text-white hover:bg-white/30 disabled:opacity-60",
    sharedContactPrimaryActionClassName: "bg-white/20 text-white hover:bg-white/30 disabled:opacity-60",
    sharedContactErrorClassName: "text-red-200",
    sharedContactDownloadClassName: "bg-white/15 text-white hover:bg-white/25",
    transcriptStatusTone: getDarkTranscriptStatusTone,
};

const whatsappOutboundTheme: MessageBubbleTheme = {
    ...smsOutboundTheme,
    channel: "whatsapp",
    isWhatsApp: true,
    bubbleClassName: "bg-[#dcf8c6] text-slate-900 border border-[#b7e4a6] rounded-tr-[4px] dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-50",
    channelHeaderClassName: "bg-[#cdeeb8] text-emerald-900 border-[#b7e4a6] dark:border-emerald-800 dark:bg-emerald-900 dark:text-emerald-100",
    channelHeaderIconClassName: "text-emerald-700",
    translationPrimaryActionClassName: "text-emerald-800 hover:bg-emerald-100/70",
    translationSecondaryActionClassName: "text-slate-700 hover:bg-emerald-100/70",
    translationMetaClassName: "text-emerald-800",
    linkClassName: "text-emerald-900 underline decoration-emerald-600/60 hover:text-emerald-700",
    attachmentShellClassName: "bg-white/55 border-emerald-200 text-slate-800 dark:border-emerald-800 dark:bg-white/10 dark:text-emerald-50",
    attachmentDownloadClassName: "text-emerald-800 hover:bg-emerald-100/70",
    attachmentCardClassName: "border-emerald-200 bg-white/70 text-slate-800 dark:border-emerald-800 dark:bg-emerald-900/70 dark:text-emerald-50",
    attachmentNestedCardClassName: "border-emerald-200 bg-white/80 text-slate-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-50",
    attachmentMutedTextClassName: "text-slate-600 dark:text-emerald-200/80",
    attachmentPrimaryTextClassName: "text-slate-800 dark:text-emerald-50",
    attachmentDangerTextClassName: "text-red-700",
    attachmentButtonClassName: "bg-emerald-50 text-emerald-900 hover:bg-emerald-100 disabled:opacity-70",
    mediaContactLinkClassName: "border-emerald-200 bg-white/65 text-emerald-900 hover:bg-white/90",
    mediaFileLinkClassName: "text-emerald-900 hover:bg-emerald-100/70",
    mediaUnavailableCardClassName: "border-amber-200 bg-amber-50 text-amber-950",
    mediaUnavailableMutedTextClassName: "text-amber-800",
    mediaRefetchButtonClassName: "border-emerald-300 text-emerald-900 hover:bg-emerald-100 disabled:opacity-70",
    sharedContactCardClassName: "border-emerald-200 bg-white/65 dark:border-emerald-800 dark:bg-emerald-900/70",
    sharedContactAvatarClassName: "bg-emerald-100",
    sharedContactAvatarIconClassName: "text-emerald-700",
    sharedContactNameClassName: "text-slate-900 dark:text-emerald-50",
    sharedContactMetaClassName: "text-slate-600 dark:text-emerald-200/80",
    sharedContactInfoLinkClassName: "text-slate-700 hover:bg-emerald-100/70 dark:text-emerald-100 dark:hover:bg-emerald-800",
    sharedContactHydratingClassName: "text-slate-600",
    sharedContactSavedClassName: "text-emerald-700",
    sharedContactSecondaryActionClassName: "bg-emerald-50 text-emerald-900 hover:bg-emerald-100 disabled:opacity-60",
    sharedContactPrimaryActionClassName: "bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60",
    sharedContactErrorClassName: "text-red-700",
    sharedContactDownloadClassName: "bg-emerald-50 text-emerald-900 hover:bg-emerald-100",
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
    sharedContactCardClassName: "border-emerald-100 bg-emerald-50/45",
    sharedContactAvatarClassName: "bg-emerald-100",
    sharedContactAvatarIconClassName: "text-emerald-700",
    sharedContactSecondaryActionClassName: "bg-emerald-50 text-emerald-900 hover:bg-emerald-100 disabled:opacity-60",
    sharedContactPrimaryActionClassName: "bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60",
    sharedContactDownloadClassName: "bg-emerald-50 text-emerald-900 hover:bg-emerald-100",
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

const defaultSurfaceTheme: ConversationSurfaceTheme = {
    channel: "default",
    rootClassName: "bg-white dark:bg-slate-950",
    timelineClassName: "bg-slate-50/50 dark:bg-slate-950",
    loadingIconClassName: "text-slate-400",
    highlightedMessageClassName: "ring-2 ring-slate-300 bg-slate-100/70",
    searchActiveChipClassName: "border-slate-300 bg-slate-100 text-slate-700",
    searchResultHoverClassName: "hover:border-slate-300 hover:bg-slate-50",
    composerContainerClassName: "border-t bg-white dark:border-slate-800 dark:bg-slate-950",
    composerShellClassName: "border bg-white focus-within:ring-2 focus-within:ring-slate-400/20 focus-within:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:focus-within:border-slate-600",
    composerControlClassName: "bg-slate-50 hover:bg-slate-100 focus:ring-0 dark:bg-slate-800 dark:hover:bg-slate-700",
    composerPrimaryButtonClassName: "bg-slate-700 hover:bg-slate-800 text-white",
    composerPrimaryButtonDisabledClassName: "bg-slate-100 text-slate-400 hover:bg-slate-200",
    composerIconButtonClassName: "text-slate-500 hover:text-slate-700 hover:bg-slate-100",
    suggestedQueueClassName: "border-t border-b bg-slate-50/70 dark:border-slate-800 dark:bg-slate-900/70",
    suggestedQueuePrimaryButtonClassName: "bg-slate-700 hover:bg-slate-800 text-white",
    activityDividerClassName: "border-slate-300",
    activityPillClassName: "bg-white border-slate-200 dark:border-slate-700 dark:bg-slate-900",
    activityPillHoverClassName: "hover:bg-slate-50",
    activityContentClassName: "bg-white border-slate-200 dark:border-slate-700 dark:bg-slate-900",
    activityManualIconClassName: "text-slate-600 bg-slate-100",
};

const smsSurfaceTheme: ConversationSurfaceTheme = {
    ...defaultSurfaceTheme,
    channel: "SMS",
    timelineClassName: "bg-blue-50/35",
    loadingIconClassName: "text-blue-500/50",
    highlightedMessageClassName: "ring-2 ring-blue-300 bg-blue-50/60",
    searchActiveChipClassName: "border-blue-300 bg-blue-50 text-blue-700",
    searchResultHoverClassName: "hover:border-blue-200 hover:bg-blue-50",
    composerShellClassName: "border bg-white focus-within:ring-2 focus-within:ring-blue-500/20 focus-within:border-blue-300",
    composerPrimaryButtonClassName: "bg-blue-600 hover:bg-blue-700 text-white",
    suggestedQueuePrimaryButtonClassName: "bg-blue-600 hover:bg-blue-700 text-white",
    activityManualIconClassName: "text-blue-600 bg-blue-100",
};

const smsRelaySurfaceTheme: ConversationSurfaceTheme = {
    ...smsSurfaceTheme,
    channel: "SMS_RELAY",
    timelineClassName: "bg-cyan-50/35",
    loadingIconClassName: "text-cyan-600/50",
    highlightedMessageClassName: "ring-2 ring-cyan-300 bg-cyan-50/60",
    searchActiveChipClassName: "border-cyan-300 bg-cyan-50 text-cyan-800",
    searchResultHoverClassName: "hover:border-cyan-200 hover:bg-cyan-50",
    composerShellClassName: "border bg-white focus-within:ring-2 focus-within:ring-cyan-500/20 focus-within:border-cyan-300",
    composerPrimaryButtonClassName: "bg-cyan-700 hover:bg-cyan-800 text-white",
    suggestedQueuePrimaryButtonClassName: "bg-cyan-700 hover:bg-cyan-800 text-white",
    activityManualIconClassName: "text-cyan-700 bg-cyan-100",
};

const emailSurfaceTheme: ConversationSurfaceTheme = {
    ...defaultSurfaceTheme,
    channel: "Email",
    timelineClassName: "bg-violet-50/30",
    loadingIconClassName: "text-violet-500/50",
    highlightedMessageClassName: "ring-2 ring-violet-300 bg-violet-50/60",
    searchActiveChipClassName: "border-violet-300 bg-violet-50 text-violet-700",
    searchResultHoverClassName: "hover:border-violet-200 hover:bg-violet-50",
    composerShellClassName: "border bg-white focus-within:ring-2 focus-within:ring-violet-500/20 focus-within:border-violet-300",
    composerPrimaryButtonClassName: "bg-violet-600 hover:bg-violet-700 text-white",
    suggestedQueuePrimaryButtonClassName: "bg-violet-600 hover:bg-violet-700 text-white",
    activityManualIconClassName: "text-violet-600 bg-violet-100",
};

const whatsAppSurfaceTheme: ConversationSurfaceTheme = {
    ...defaultSurfaceTheme,
    channel: "WhatsApp",
    rootClassName: "bg-[#f3f5ee] dark:bg-slate-950",
    timelineClassName: "bg-[#f3f5ee] dark:bg-slate-950",
    loadingIconClassName: "text-emerald-600/50",
    highlightedMessageClassName: "ring-2 ring-emerald-300 bg-emerald-50/70",
    searchActiveChipClassName: "border-emerald-300 bg-emerald-50 text-emerald-800",
    searchResultHoverClassName: "hover:border-emerald-200 hover:bg-emerald-50",
    composerContainerClassName: "border-t border-emerald-100 bg-[#f7faf3] dark:border-emerald-900 dark:bg-slate-950",
    composerShellClassName: "border border-emerald-200 bg-white focus-within:ring-2 focus-within:ring-emerald-500/20 focus-within:border-emerald-300 dark:border-emerald-900 dark:bg-slate-900 dark:focus-within:border-emerald-700",
    composerControlClassName: "bg-emerald-50 hover:bg-emerald-100 focus:ring-0 dark:bg-slate-800 dark:hover:bg-slate-700",
    composerPrimaryButtonClassName: "bg-emerald-600 hover:bg-emerald-700 text-white",
    composerPrimaryButtonDisabledClassName: "bg-emerald-50 text-emerald-300 hover:bg-emerald-50",
    composerIconButtonClassName: "text-emerald-700 hover:text-emerald-900 hover:bg-emerald-100",
    suggestedQueueClassName: "border-t border-b border-emerald-100 bg-emerald-50/55 dark:border-emerald-900 dark:bg-emerald-950/30",
    suggestedQueuePrimaryButtonClassName: "bg-emerald-600 hover:bg-emerald-700 text-white",
    activityDividerClassName: "border-emerald-200",
    activityPillClassName: "bg-white/85 border-emerald-100 dark:border-emerald-900 dark:bg-slate-900",
    activityPillHoverClassName: "hover:bg-emerald-50",
    activityContentClassName: "bg-white/90 border-emerald-100 dark:border-emerald-900 dark:bg-slate-900",
    activityManualIconClassName: "text-emerald-700 bg-emerald-100",
};

export function getConversationSurfaceTheme(channel: ConversationSurfaceChannel | string | null | undefined): ConversationSurfaceTheme {
    if (channel === "WhatsApp") return whatsAppSurfaceTheme;
    if (channel === "Email") return emailSurfaceTheme;
    if (channel === "SMS_RELAY") return smsRelaySurfaceTheme;
    if (channel === "SMS") return smsSurfaceTheme;
    return defaultSurfaceTheme;
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
