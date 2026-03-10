'use client';

import { useState, useRef, useEffect } from 'react';
import { fetchDealTimeline } from '../../deals/actions';
import { Conversation } from '@/lib/ghl/conversations';
import { GEMINI_FLASH_LATEST_ALIAS } from '@/lib/ai/models';

import { MessageBubble } from './message-bubble';
import { MessageSquare, Sparkles, ArrowLeft, ListTodo } from "lucide-react";
import { Button } from '@/components/ui/button';
import { ConversationComposer } from './conversation-composer';
import { ActivityLogEntry } from "./activity-log-entry";

interface UnifiedTimelineProps {
    dealId: string;
    refreshToken?: number;
    composerConversation?: Conversation | null;
    onBack?: () => void;
    onOpenMissionControl?: () => void;
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
}

export function UnifiedTimeline({
    dealId,
    refreshToken = 0,
    composerConversation = null,
    onBack,
    onOpenMissionControl,
    onSendMessage,
    onSendMedia,
    onGenerateDraft,
    onSetReplyLanguageOverride,
    suggestions = [],
    composerDisabled = false,
    composerDisabledReason,
    replyingToLabel,
}: UnifiedTimelineProps) {
    const [timelineMessages, setTimelineMessages] = useState<any[]>([]);
    const [loadingTimeline, setLoadingTimeline] = useState(true);
    const [selectedModel, setSelectedModel] = useState(GEMINI_FLASH_LATEST_ALIAS);
    const timelineRef = useRef<HTMLDivElement>(null);

    // Initial Load of Timeline
    useEffect(() => {
        setLoadingTimeline(true);
        fetchDealTimeline(dealId)
            .then(msgs => {
                setTimelineMessages(msgs);
                setLoadingTimeline(false);
            })
            .catch(err => {
                console.error("Failed to load timeline", err);
                setLoadingTimeline(false);
            });
    }, [dealId, refreshToken]);

    // Auto-scroll timeline
    useEffect(() => {
        if (timelineRef.current) {
            timelineRef.current.scrollTop = timelineRef.current.scrollHeight;
        }
    }, [timelineMessages]);

    return (
        <div className="flex-1 bg-slate-200/50 p-0 flex flex-col relative overflow-hidden h-full min-w-0 w-full">
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
                    <span className="font-semibold text-sm truncate">Unified Timeline</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="text-xs text-muted-foreground hidden sm:block">
                        {timelineMessages.length} events
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
                {loadingTimeline ? (
                    <div className="flex items-center justify-center h-full text-gray-400">
                        <Sparkles className="w-5 h-5 animate-spin mr-2" />
                        Loading timeline...
                    </div>
                ) : timelineMessages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-gray-400">
                        <MessageSquare className="w-8 h-8 mb-2 opacity-20" />
                        <p className="text-sm">No activity yet. Start a conversation!</p>
                    </div>
                ) : (
                    timelineMessages.map((event) => {
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
                            />
                        );
                    })
                )}
            </div>

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
            />
        </div>
    );
}
