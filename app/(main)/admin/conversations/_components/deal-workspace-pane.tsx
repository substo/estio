'use client';

import type { ComponentProps } from 'react';
import type { Conversation } from '@/lib/ghl/conversations';

import { UnifiedTimeline } from './unified-timeline';

type UnifiedTimelineProps = ComponentProps<typeof UnifiedTimeline>;

interface DealWorkspacePaneProps {
    activeDealId: string | null;
    activeDealTitle?: string;
    timelineEvents: any[];
    loading: boolean;
    hydrationStatus: UnifiedTimelineProps['hydrationStatus'];
    selectedDealConversation: Conversation | null;
    isMobileViewport: boolean;
    loadingDealContext: boolean;
    suggestions: string[];
    suggestedResponseQueue: UnifiedTimelineProps['suggestedResponseQueue'];
    suggestedResponseQueueLoading: boolean;
    composerInsertSeed: UnifiedTimelineProps['composerInsertSeed'];
    composerDraft: string;
    translationWriteEnabled: boolean;
    onBack: () => void;
    onOpenMissionControl: () => void;
    onInitialPaintReady: () => void;
    onSendMessage: NonNullable<UnifiedTimelineProps['onSendMessage']>;
    onComposerDraftChange: UnifiedTimelineProps['onComposerDraftChange'];
    onComposerDraftClear: UnifiedTimelineProps['onComposerDraftClear'];
    onResendMessage: UnifiedTimelineProps['onResendMessage'];
    onSendSmsFallback: UnifiedTimelineProps['onSendSmsFallback'];
    smsRelayEnabled?: boolean;
    onSendMedia: NonNullable<UnifiedTimelineProps['onSendMedia']>;
    onPreviewTranslatedReply: NonNullable<UnifiedTimelineProps['onPreviewTranslatedReply']>;
    onGenerateDraft: NonNullable<UnifiedTimelineProps['onGenerateDraft']>;
    onSetReplyLanguageOverride: NonNullable<UnifiedTimelineProps['onSetReplyLanguageOverride']>;
    onAcceptSuggestedResponse: UnifiedTimelineProps['onAcceptSuggestedResponse'];
    onRejectSuggestedResponse: UnifiedTimelineProps['onRejectSuggestedResponse'];
}

export function DealWorkspacePane({
    activeDealId,
    activeDealTitle,
    timelineEvents,
    loading,
    hydrationStatus,
    selectedDealConversation,
    isMobileViewport,
    loadingDealContext,
    suggestions,
    suggestedResponseQueue,
    suggestedResponseQueueLoading,
    composerInsertSeed,
    composerDraft,
    translationWriteEnabled,
    onBack,
    onOpenMissionControl,
    onInitialPaintReady,
    onSendMessage,
    onComposerDraftChange,
    onComposerDraftClear,
    onResendMessage,
    onSendSmsFallback,
    smsRelayEnabled,
    onSendMedia,
    onPreviewTranslatedReply,
    onGenerateDraft,
    onSetReplyLanguageOverride,
    onAcceptSuggestedResponse,
    onRejectSuggestedResponse,
}: DealWorkspacePaneProps) {
    if (!activeDealId) {
        return (
            <div className="h-full min-h-0 flex items-center justify-center text-gray-400 bg-slate-50 dark:bg-slate-950 dark:text-slate-500">
                Select a deal to view timeline
            </div>
        );
    }

    return (
        <UnifiedTimeline
            dealId={activeDealId}
            title={activeDealTitle}
            timelineEvents={timelineEvents}
            loading={loading}
            hydrationStatus={hydrationStatus}
            composerConversation={selectedDealConversation}
            onBack={isMobileViewport ? onBack : undefined}
            onOpenMissionControl={isMobileViewport ? onOpenMissionControl : undefined}
            onInitialPaintReady={onInitialPaintReady}
            onSendMessage={onSendMessage}
            composerDraft={composerDraft}
            onComposerDraftChange={onComposerDraftChange}
            onComposerDraftClear={onComposerDraftClear}
            onResendMessage={onResendMessage}
            onSendSmsFallback={onSendSmsFallback}
            smsRelayEnabled={smsRelayEnabled}
            onSendMedia={onSendMedia}
            onPreviewTranslatedReply={onPreviewTranslatedReply}
            translationWriteEnabled={translationWriteEnabled}
            onGenerateDraft={onGenerateDraft}
            onSetReplyLanguageOverride={onSetReplyLanguageOverride}
            suggestions={suggestions}
            suggestedResponseQueue={suggestedResponseQueue}
            suggestedResponseQueueLoading={suggestedResponseQueueLoading}
            onAcceptSuggestedResponse={onAcceptSuggestedResponse}
            onRejectSuggestedResponse={onRejectSuggestedResponse}
            composerInsertSeed={composerInsertSeed}
            composerDisabled={loadingDealContext || !selectedDealConversation}
            composerDisabledReason={
                loadingDealContext
                    ? "Loading recent deal timeline..."
                    : "Select a contact in AI Coordinator to reply."
            }
            replyingToLabel={selectedDealConversation?.contactName || undefined}
        />
    );
}
