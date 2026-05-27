import type { Message } from "@/lib/ghl/conversations";
import { assembleTimelineEvents } from "@/lib/conversations/timeline-events";
import { buildMessageCursorFromMessage } from "@/lib/conversations/thread-hydration";
import {
    fetchMessagesForResolvedConversation,
    type ResolvedConversationForMessages,
    type ResolvedLocationForMessages,
} from "@/lib/conversations/message-loading";

export type ConversationWorkspaceCoreMetadataForLoading = {
    conversationHeader: any;
    resolvedConversation: ResolvedConversationForMessages;
    freshness: {
        generatedAt: string;
        conversationUpdatedAt: string | null;
        latestMessageAt: string | null;
        latestMessageUpdatedAt: string | null;
        latestActivityAt: string | null;
        threadStale: boolean;
    };
};

type ConversationWorkspaceMessageWindow = {
    oldestCursor: string | null;
    newestCursor: string | null;
    count: number;
    requestedLimit: number;
};

type TranscriptEligibilityResult = {
    success: boolean;
    enabled: boolean;
    reason?: string | null;
    [key: string]: any;
};

type WorkspaceCoreLoadingDependencies = {
    resolveTranscriptVisibilityAccess: (locationId: string) => Promise<{ restrictContent: boolean }>;
    parseLegacyCrmLeadNotificationEmail: (args: {
        subject?: string | null;
        emailFrom?: string | null;
        body?: string | null;
        configuredSenders?: string[] | null;
        configuredDomains?: string[] | null;
        configuredSubjectPatterns?: string[] | null;
    }) => any;
    getTranscriptEligibility: (conversationId: string) => Promise<TranscriptEligibilityResult>;
};

export async function loadConversationWorkspaceCore(args: {
    traceId: string;
    location: ResolvedLocationForMessages;
    conversationId: string;
    metadata: ConversationWorkspaceCoreMetadataForLoading;
    includeMessages: boolean;
    includeActivity: boolean;
    messageLimit: number;
    activityLimit: number;
    activityBeforeCursor?: string | null;
    refreshMode: "initial_hydration" | "active_refresh" | "deferred_activity" | "prefetch" | "default";
    messageMetadataMode: "full" | "firstPaint";
    dependencies: WorkspaceCoreLoadingDependencies;
}) {
    const startedAtMs = Date.now();
    const activityRefreshMode = args.includeActivity
        ? (args.includeMessages ? "with_messages" : "activity_only")
        : "skipped";
    const transcriptEligibilityDeferred = (
        args.refreshMode === "initial_hydration"
        || args.refreshMode === "prefetch"
    )
        && args.messageMetadataMode === "firstPaint"
        && !args.includeActivity;

    const timed = async <T>(work: Promise<T>, onElapsed: (elapsedMs: number) => void): Promise<T> => {
        const bucketStartedAtMs = Date.now();
        try {
            return await work;
        } finally {
            onElapsed(Date.now() - bucketStartedAtMs);
        }
    };

    let messagesMs = 0;
    let activityMs = 0;
    let transcriptEligibilityMs = 0;

    const [messages, activityTimeline, transcriptEligibility] = await Promise.all([
        args.includeMessages
            ? timed(fetchMessagesForResolvedConversation({
                requestedConversationId: args.conversationId,
                location: args.location,
                conversation: args.metadata.resolvedConversation,
                options: {
                    take: args.messageLimit,
                    includeLegacyEmailMeta: args.includeActivity,
                    metadataMode: args.messageMetadataMode,
                    refreshMode: args.refreshMode,
                },
                reusedConversationContext: true,
                dependencies: {
                    resolveTranscriptVisibilityAccess: args.dependencies.resolveTranscriptVisibilityAccess,
                    parseLegacyCrmLeadNotificationEmail: args.dependencies.parseLegacyCrmLeadNotificationEmail,
                },
            }), (elapsedMs) => { messagesMs = elapsedMs; })
            : timed(Promise.resolve([] as Message[]), (elapsedMs) => { messagesMs = elapsedMs; }),
        args.includeActivity
            ? timed(assembleTimelineEvents({
                mode: "chat",
                locationId: args.location.id,
                conversationId: args.conversationId,
                includeMessages: false,
                includeActivities: true,
                take: args.activityLimit,
                beforeCursor: args.activityBeforeCursor || null,
            }).then((timeline) => {
                const activityEvents = timeline.events.filter((event) => event.kind === "activity");
                return activityEvents.map((entry) => ({
                    id: entry.id,
                    type: "activity",
                    createdAt: entry.createdAt,
                    action: entry.action,
                    changes: entry.changes,
                    user: entry.user || null,
                }));
            }), (elapsedMs) => { activityMs = elapsedMs; })
            : timed(Promise.resolve([] as any[]), (elapsedMs) => { activityMs = elapsedMs; }),
        transcriptEligibilityDeferred
            ? timed(Promise.resolve({
                success: true as const,
                enabled: false as const,
                reason: "Deferred until workspace enrichment.",
            }), (elapsedMs) => { transcriptEligibilityMs = elapsedMs; })
            : timed(args.dependencies.getTranscriptEligibility(args.conversationId)
                .catch(() => ({
                    success: false as const,
                    enabled: false as const,
                    reason: "Failed to resolve eligibility.",
                })), (elapsedMs) => { transcriptEligibilityMs = elapsedMs; }),
    ]);

    const messageWindow: ConversationWorkspaceMessageWindow = {
        oldestCursor: args.includeMessages ? (buildMessageCursorFromMessage(messages[0]) || null) : null,
        newestCursor: args.includeMessages ? (buildMessageCursorFromMessage(messages[messages.length - 1]) || null) : null,
        count: args.includeMessages ? messages.length : 0,
        requestedLimit: args.messageLimit,
    };

    console.log("[perf:conversations.workspace_core_window]", JSON.stringify({
        traceId: args.traceId,
        conversationId: args.conversationId,
        includeMessages: args.includeMessages,
        includeActivity: args.includeActivity,
        messageLimit: args.messageLimit,
        activeRefreshMessageLimit: args.refreshMode === "active_refresh" ? args.messageLimit : undefined,
        activityLimit: args.activityLimit,
        activityRefreshMode,
        refreshMode: args.refreshMode,
        messageMetadataMode: args.messageMetadataMode,
        reusedConversationContext: args.includeMessages,
        message_count: messageWindow.count,
        returnedMessageCount: messageWindow.count,
        activity_count: Array.isArray(activityTimeline) ? activityTimeline.length : 0,
        messages_ms: messagesMs,
        activity_ms: activityMs,
        transcript_eligibility_ms: transcriptEligibilityMs,
        total_ms: Date.now() - startedAtMs,
        transcriptEligibilityDeferred,
    }));

    return {
        success: true as const,
        traceId: args.traceId,
        conversationHeader: args.metadata.conversationHeader,
        messages,
        activityTimeline,
        transcriptEligibility,
        transcriptEligibilityDeferred,
        freshness: args.metadata.freshness,
        messageWindow,
    };
}
