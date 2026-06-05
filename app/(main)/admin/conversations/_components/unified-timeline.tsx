'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Conversation } from '@/lib/ghl/conversations';

import { MessageBubble } from './message-bubble';
import { MessageSquare, Sparkles, ArrowLeft, ListTodo } from "lucide-react";
import { Button } from '@/components/ui/button';
import { ConversationComposer } from './conversation-composer';
import { ActivityLogEntry } from "./activity-log-entry";
import { SuggestedResponseQueue, type SuggestedResponseQueueItem } from "./suggested-response-queue";
import { useUnifiedTimelineScroll } from './use-unified-timeline-scroll';
import {
    getConversationSurfaceTheme,
    getConversationTimelineContentClassName,
    getDealTimelineScrollClassName,
    type ConversationSurfaceChannel,
} from './message-bubble-theme';
import { cn } from '@/lib/utils';
import type { ComposerChannel } from './use-conversation-composer-translation-preview';
import { getConversationChannelInfo } from './conversation-channel-info';
import { MessageImageGroup } from "./message-image-group";
import { groupAdjacentWhatsAppImageMessages } from "./message-image-grouping";

interface UnifiedTimelineProps {
    dealId: string;
    title?: string;
    timelineEvents: any[];
    loading: boolean;
    hydrationStatus?: 'partial' | 'full';
    composerConversation?: Conversation | null;
    onBack?: () => void;
    onOpenMissionControl?: () => void;
    onInitialPaintReady?: () => void;
    onSendMessage?: (
        text: string,
        type: ComposerChannel,
        options?: {
            translationSourceText?: string | null;
            translationTargetLanguage?: string | null;
            translationDetectedSourceLanguage?: string | null;
        }
    ) => void | Promise<void>;
    onSendMedia?: (file: File, caption: string) => void | Promise<void>;
    onGenerateDraft?: (
        instruction?: string,
        model?: string,
        draftLanguage?: string | null,
        baseDraft?: string | null,
        onChunk?: (chunk: string) => void
    ) => Promise<string | null>;
    onSetReplyLanguageOverride?: (replyLanguage: string | null) => Promise<{ success: boolean; error?: string; replyLanguageOverride?: string | null }>;
    onPreviewTranslatedReply?: (
        sourceText: string,
        channel: ComposerChannel,
        targetLanguage?: string | null
    ) => Promise<{
        success: boolean;
        error?: string;
        targetLanguage?: string;
        sourceText?: string;
        translatedText?: string;
        detectedSourceLanguage?: string | null;
    }>;
    translationWriteEnabled?: boolean;
    suggestions?: string[];
    composerDisabled?: boolean;
    composerDisabledReason?: string;
    replyingToLabel?: string;
    suggestedResponseQueue?: SuggestedResponseQueueItem[];
    suggestedResponseQueueLoading?: boolean;
    onAcceptSuggestedResponse?: (id: string, mode: "insertOnly" | "sendNow") => Promise<void>;
    onRejectSuggestedResponse?: (id: string, reason?: string | null) => Promise<void>;
    composerDraft: string;
    onComposerDraftChange: (draft: string) => void;
    onComposerDraftClear: () => void;
    composerInsertSeed?: { key: string; body: string } | null;
    onResendMessage?: (messageId: string) => void | Promise<void>;
    onSendSmsFallback?: (messageId: string) => void | Promise<void>;
    smsRelayEnabled?: boolean;
}

function getInitialSurfaceChannel(conversation: Conversation | null): ConversationSurfaceChannel {
    if (!conversation) return "default";
    const channel = getConversationChannelInfo(conversation).channel;
    if (channel === "WhatsApp" || channel === "Email" || channel === "SMS" || channel === "SMS_RELAY") {
        return channel;
    }
    return "default";
}

export function UnifiedTimeline({
    dealId,
    title,
    timelineEvents,
    loading,
    hydrationStatus = 'full',
    composerConversation = null,
    onBack,
    onOpenMissionControl,
    onInitialPaintReady,
    onSendMessage,
    onSendMedia,
    onGenerateDraft,
    onSetReplyLanguageOverride,
    onPreviewTranslatedReply,
    translationWriteEnabled = false,
    suggestions = [],
    composerDisabled = false,
    composerDisabledReason,
    replyingToLabel,
    suggestedResponseQueue = [],
    suggestedResponseQueueLoading = false,
    onAcceptSuggestedResponse,
    onRejectSuggestedResponse,
    composerDraft,
    onComposerDraftChange,
    onComposerDraftClear,
    composerInsertSeed,
    onResendMessage,
    onSendSmsFallback,
    smsRelayEnabled,
}: UnifiedTimelineProps) {
    const [selectedModel, setSelectedModel] = useState("");
    const [activeSurfaceChannel, setActiveSurfaceChannel] = useState<ConversationSurfaceChannel>(() => getInitialSurfaceChannel(composerConversation));
    const lastTimelineCountLogRef = useRef<string | null>(null);
    const events = useMemo(() => (Array.isArray(timelineEvents) ? timelineEvents : []), [timelineEvents]);
    const groupedEvents = useMemo(() => {
        const normalizedEvents = events.map((event) => {
            if (event?.kind === "activity") return { kind: "activity" as const, activity: event };
            return { kind: "message" as const, message: event?.kind === "message" ? event.message : event };
        });
        return groupAdjacentWhatsAppImageMessages(normalizedEvents);
    }, [events]);
    const surfaceTheme = getConversationSurfaceTheme(activeSurfaceChannel);
    const {
        timelineRef,
        timelineContentRef,
        isTimelineReady,
    } = useUnifiedTimelineScroll({
        dealId,
        timelineEvents: events,
        loading,
        onInitialPaintReady,
    });

    useEffect(() => {
        setActiveSurfaceChannel(getInitialSurfaceChannel(composerConversation));
    }, [composerConversation?.id]);

    useEffect(() => {
        if (process.env.NODE_ENV === "production") return;
        const mountedMessageCount = events.filter((event) => event?.kind !== "activity").length;
        const mountedActivityCount = events.length - mountedMessageCount;
        const logKey = [
            dealId,
            events.length,
            mountedMessageCount,
            mountedActivityCount,
            loading ? "loading" : "ready",
            isTimelineReady ? "painted" : "hidden",
        ].join(":");
        if (lastTimelineCountLogRef.current === logKey) return;
        lastTimelineCountLogRef.current = logKey;
        console.debug("[perf:conversations.deal_timeline_mount_count]", {
            dealId,
            mountedItemCount: events.length,
            mountedMessageCount,
            mountedActivityCount,
            loading,
            hydrationStatus,
            initialPaintReady: isTimelineReady,
        });
    }, [dealId, events, hydrationStatus, isTimelineReady, loading]);

    return (
        <div
            data-deal-active-id={dealId}
            data-deal-hydration-status={hydrationStatus}
            data-deal-initial-paint-ready={isTimelineReady ? "true" : "false"}
            data-deal-mounted-timeline-items={events.length}
            className={cn("flex-1 min-h-0 p-0 flex flex-col relative overflow-hidden h-full min-w-0 w-full", surfaceTheme.timelineClassName)}
        >
            <div className="h-14 border-b bg-white flex items-center px-3 sm:px-4 justify-between shrink-0 gap-2">
                <div className="flex items-center gap-2 text-gray-700 min-w-0">
                    {onBack && (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0"
                            onClick={onBack}
                            title="Back to deals"
                        >
                            <ArrowLeft className="h-4 w-4 text-gray-500" />
                        </Button>
                    )}
                    <MessageSquare className="w-4 h-4 shrink-0" />
                    <span className="font-semibold text-sm truncate">{String(title || "Deal").trim() || "Deal"}</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="text-xs text-muted-foreground hidden sm:block">
                        {events.length} events
                    </div>
                    {onOpenMissionControl && (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={onOpenMissionControl}
                            title="Open AI Coordinator"
                        >
                            <ListTodo className="h-4 w-4 text-gray-500" />
                        </Button>
                    )}
                </div>
            </div>

            <div className={cn("flex-1 min-h-0 overflow-y-auto", getDealTimelineScrollClassName())} ref={timelineRef}>
                {loading && events.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-gray-400">
                        <Sparkles className="w-5 h-5 animate-spin mr-2" />
                        Loading timeline...
                    </div>
                ) : events.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-gray-400">
                        <MessageSquare className="w-8 h-8 mb-2 opacity-20" />
                        <p className="text-sm">No activity yet. Start a conversation!</p>
                    </div>
                ) : (
                    <div
                        ref={timelineContentRef}
                        className={cn(
                            getConversationTimelineContentClassName(),
                            !loading && events.length > 0 && !isTimelineReady && "opacity-0"
                        )}
                    >
                        {groupedEvents.map((event) => {
                            if (event.kind === "activity") {
                                return (
                                    <ActivityLogEntry
                                        key={event.activity.id}
                                        item={{
                                            id: event.activity.id,
                                            createdAt: event.activity.createdAt,
                                            action: event.activity.action,
                                            changes: event.activity.changes,
                                            user: event.activity.user || null,
                                        }}
                                        contactName={event.activity.contactName || undefined}
                                        surfaceTheme={surfaceTheme}
                                    />
                                );
                            }

                            if (event.kind === "image-group") {
                                return (
                                    <MessageImageGroup
                                        key={event.group.id}
                                        group={event.group}
                                        contactName={event.group.messages[0]?.contactName}
                                    />
                                );
                            }

                            const message = event.message;
                            return (
                                <MessageBubble
                                    key={message?.id}
                                    message={message}
                                    contactName={message?.senderName || message?.contactName}
                                    contactEmail={message?.senderEmail || message?.contactEmail}
                                    aiModel={selectedModel}
                                    onResendMessage={onResendMessage}
                                    onSendSmsFallback={onSendSmsFallback}
                                    smsRelayEnabled={smsRelayEnabled}
                                />
                            );
                        })}
                    </div>
                )}
            </div>

            <SuggestedResponseQueue
                items={suggestedResponseQueue}
                loading={suggestedResponseQueueLoading}
                onAccept={async (id, mode) => {
                    if (!onAcceptSuggestedResponse) return;
                    await onAcceptSuggestedResponse(id, mode);
                }}
                onReject={async (id, reason) => {
                    if (!onRejectSuggestedResponse) return;
                    await onRejectSuggestedResponse(id, reason);
                }}
                allowSendNow={true}
                surfaceTheme={surfaceTheme}
            />

            <ConversationComposer
                conversation={composerConversation}
                draft={composerDraft}
                onDraftChange={onComposerDraftChange}
                onDraftClear={onComposerDraftClear}
                onSendMessage={(text, type, options) => Promise.resolve(onSendMessage?.(text, type, options))}
                onSendMedia={onSendMedia}
                onGenerateDraft={onGenerateDraft}
                onSetReplyLanguageOverride={onSetReplyLanguageOverride}
                onPreviewTranslatedReply={onPreviewTranslatedReply}
                translationWriteEnabled={translationWriteEnabled}
                suggestions={suggestions}
                disabled={composerDisabled || !composerConversation}
                disabledReason={composerDisabledReason}
                replyingToLabel={replyingToLabel}
                onModelChange={setSelectedModel}
                insertDraftSeed={composerInsertSeed}
                smsRelayEnabled={smsRelayEnabled}
                surfaceTheme={surfaceTheme}
                onSelectedChannelChange={(channel) => setActiveSurfaceChannel(channel)}
            />
        </div>
    );
}
