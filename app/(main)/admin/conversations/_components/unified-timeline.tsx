'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Conversation } from '@/lib/ghl/conversations';
import { calculatePrependScrollTop } from '@/lib/conversations/thread-hydration';

import { MessageBubble } from './message-bubble';
import { MessageSquare, Sparkles, ArrowLeft, ListTodo } from "lucide-react";
import { Button } from '@/components/ui/button';
import { ConversationComposer } from './conversation-composer';
import { ActivityLogEntry } from "./activity-log-entry";
import { SuggestedResponseQueue, type SuggestedResponseQueueItem } from "./suggested-response-queue";

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
    onSendMessage?: (text: string, type: 'SMS' | 'Email' | 'WhatsApp') => void | Promise<void>;
    onSendMedia?: (file: File, caption: string) => void | Promise<void>;
    onGenerateDraft?: (
        instruction?: string,
        model?: string,
        replyLanguage?: string | null,
        onChunk?: (chunk: string) => void
    ) => Promise<string | null>;
    onSetReplyLanguageOverride?: (replyLanguage: string | null) => Promise<{ success: boolean; error?: string; replyLanguageOverride?: string | null }>;
    suggestions?: string[];
    composerDisabled?: boolean;
    composerDisabledReason?: string;
    replyingToLabel?: string;
    suggestedResponseQueue?: SuggestedResponseQueueItem[];
    suggestedResponseQueueLoading?: boolean;
    onAcceptSuggestedResponse?: (id: string, mode: "insertOnly" | "sendNow") => Promise<void>;
    onRejectSuggestedResponse?: (id: string, reason?: string | null) => Promise<void>;
    composerInsertSeed?: { key: string; body: string } | null;
    onResendMessage?: (messageId: string) => void | Promise<void>;
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
    suggestions = [],
    composerDisabled = false,
    composerDisabledReason,
    replyingToLabel,
    suggestedResponseQueue = [],
    suggestedResponseQueueLoading = false,
    onAcceptSuggestedResponse,
    onRejectSuggestedResponse,
    composerInsertSeed,
    onResendMessage,
}: UnifiedTimelineProps) {
    const [selectedModel, setSelectedModel] = useState("");
    const [isTimelineReady, setIsTimelineReady] = useState(false);
    const timelineRef = useRef<HTMLDivElement>(null);
    const timelineContentRef = useRef<HTMLDivElement>(null);
    const shouldStickToBottomRef = useRef(true);
    const hasForcedInitialBottomSnapRef = useRef(false);
    const hasReportedInitialPaintRef = useRef(false);
    const previousEventIdsRef = useRef<string[]>([]);
    const previousScrollHeightRef = useRef(0);
    const previousScrollTopRef = useRef(0);

    const snapToBottom = useCallback(() => {
        const container = timelineRef.current;
        if (!container) return;
        container.scrollTop = container.scrollHeight;
        previousScrollTopRef.current = container.scrollTop;
        previousScrollHeightRef.current = container.scrollHeight;
    }, []);

    useEffect(() => {
        shouldStickToBottomRef.current = true;
        hasForcedInitialBottomSnapRef.current = false;
        hasReportedInitialPaintRef.current = false;
        previousEventIdsRef.current = [];
        previousScrollHeightRef.current = 0;
        previousScrollTopRef.current = 0;
        setIsTimelineReady(false);
    }, [dealId]);

    useEffect(() => {
        const container = timelineRef.current;
        if (!container) return;

        const handleScroll = () => {
            const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
            shouldStickToBottomRef.current = distanceFromBottom <= 80;
            previousScrollTopRef.current = container.scrollTop;
            previousScrollHeightRef.current = container.scrollHeight;
        };

        handleScroll();
        container.addEventListener("scroll", handleScroll, { passive: true });
        return () => container.removeEventListener("scroll", handleScroll);
    }, [dealId]);

    useLayoutEffect(() => {
        const container = timelineRef.current;
        if (!container) return;

        const previousIds = previousEventIdsRef.current;
        const nextIds = (timelineEvents || []).map((event) => String(event?.id || ""));
        const previousFirstId = previousIds[0] || null;
        const previousLastId = previousIds[previousIds.length - 1] || null;
        const nextFirstId = nextIds[0] || null;
        const nextLastId = nextIds[nextIds.length - 1] || null;

        const didPrependOlderEvents = (
            previousIds.length > 0
            && nextIds.length > previousIds.length
            && !!previousFirstId
            && !!previousLastId
            && nextLastId === previousLastId
            && nextFirstId !== previousFirstId
        );

        if (didPrependOlderEvents) {
            const compensatedTop = calculatePrependScrollTop(
                previousScrollTopRef.current,
                previousScrollHeightRef.current,
                container.scrollHeight
            );
            container.scrollTop = compensatedTop;
            previousScrollTopRef.current = compensatedTop;
        }

        previousEventIdsRef.current = nextIds;
        previousScrollHeightRef.current = container.scrollHeight;
        previousScrollTopRef.current = container.scrollTop;
    }, [dealId, timelineEvents]);

    useLayoutEffect(() => {
        if (loading) return;
        if ((timelineEvents || []).length === 0) return;
        if (hasForcedInitialBottomSnapRef.current) return;

        hasForcedInitialBottomSnapRef.current = true;
        shouldStickToBottomRef.current = true;
        snapToBottom();
        requestAnimationFrame(() => {
            if (shouldStickToBottomRef.current) {
                snapToBottom();
            }
            setIsTimelineReady(true);
            if (!hasReportedInitialPaintRef.current) {
                hasReportedInitialPaintRef.current = true;
                onInitialPaintReady?.();
            }
        });
    }, [dealId, loading, onInitialPaintReady, snapToBottom, timelineEvents]);

    useEffect(() => {
        if (!loading && (timelineEvents || []).length === 0) {
            setIsTimelineReady(true);
            if (!hasReportedInitialPaintRef.current) {
                hasReportedInitialPaintRef.current = true;
                onInitialPaintReady?.();
            }
        }
    }, [loading, onInitialPaintReady, timelineEvents]);

    useLayoutEffect(() => {
        if (loading) return;
        if (!(timelineEvents || []).length) return;
        if (!shouldStickToBottomRef.current) return;
        snapToBottom();
    }, [dealId, loading, snapToBottom, timelineEvents]);

    useEffect(() => {
        const container = timelineRef.current;
        const content = timelineContentRef.current;
        if (!container || !content) return;
        if (typeof ResizeObserver === "undefined") return;

        let rafId: number | null = null;
        const scheduleSnap = () => {
            if (!shouldStickToBottomRef.current) return;
            if (rafId !== null) cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(() => {
                if (!shouldStickToBottomRef.current) return;
                snapToBottom();
            });
        };

        const observer = new ResizeObserver(() => scheduleSnap());
        observer.observe(content);
        observer.observe(container);
        scheduleSnap();

        return () => {
            if (rafId !== null) cancelAnimationFrame(rafId);
            observer.disconnect();
        };
    }, [dealId, snapToBottom]);

    return (
        <div
            data-deal-active-id={dealId}
            data-deal-hydration-status={hydrationStatus}
            data-deal-initial-paint-ready={isTimelineReady ? "true" : "false"}
            className="flex-1 bg-slate-200/50 p-0 flex flex-col relative overflow-hidden h-full min-w-0 w-full"
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
                        {(timelineEvents || []).length} events
                    </div>
                    {onOpenMissionControl && (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={onOpenMissionControl}
                            title="Open Mission Control"
                        >
                            <ListTodo className="h-4 w-4 text-gray-500" />
                        </Button>
                    )}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4" ref={timelineRef}>
                {loading && (!timelineEvents || timelineEvents.length === 0) ? (
                    <div className="flex items-center justify-center h-full text-gray-400">
                        <Sparkles className="w-5 h-5 animate-spin mr-2" />
                        Loading timeline...
                    </div>
                ) : !timelineEvents || timelineEvents.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-gray-400">
                        <MessageSquare className="w-8 h-8 mb-2 opacity-20" />
                        <p className="text-sm">No activity yet. Start a conversation!</p>
                    </div>
                ) : (
                    <div
                        ref={timelineContentRef}
                        className={!loading && timelineEvents.length > 0 && !isTimelineReady ? "opacity-0" : ""}
                    >
                        {timelineEvents.map((event) => {
                            if (event?.kind === "activity") {
                                return (
                                    <ActivityLogEntry
                                        key={event.id}
                                        item={{
                                            id: event.id,
                                            createdAt: event.createdAt,
                                            action: event.action,
                                            changes: event.changes,
                                            user: event.user || null,
                                        }}
                                        contactName={event.contactName || undefined}
                                    />
                                );
                            }

                            const message = event?.kind === "message" ? event.message : event;
                            return (
                                <MessageBubble
                                    key={event?.id || message?.id}
                                    message={message}
                                    contactName={message?.senderName || message?.contactName}
                                    contactEmail={message?.senderEmail || message?.contactEmail}
                                    aiModel={selectedModel}
                                    onResendMessage={onResendMessage}
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
            />

            <ConversationComposer
                conversation={composerConversation}
                onSendMessage={(text, type) => Promise.resolve(onSendMessage?.(text, type))}
                onSendMedia={onSendMedia}
                onGenerateDraft={onGenerateDraft}
                onSetReplyLanguageOverride={onSetReplyLanguageOverride}
                suggestions={suggestions}
                disabled={composerDisabled || !composerConversation}
                disabledReason={composerDisabledReason}
                replyingToLabel={replyingToLabel}
                onModelChange={setSelectedModel}
                insertDraftSeed={composerInsertSeed}
            />
        </div>
    );
}
