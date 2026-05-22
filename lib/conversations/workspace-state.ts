import type { Conversation, Message } from "../ghl/conversations";
import {
    THREAD_INITIAL_FALLBACK_MESSAGES,
    THREAD_TARGET_MESSAGE_COUNT,
    buildMessageCursorFromMessage,
} from "./thread-hydration";
import {
    isPendingOutboundMessage,
    mergeSnapshotWithPendingMessages,
} from "./outbound-reconciliation";

export type WorkspaceHydrationStatus = 'partial' | 'full';

export type WorkspaceHydrationState = {
    status: WorkspaceHydrationStatus;
    oldestCursor: string | null;
    newestCursor: string | null;
    initialCount: number;
    targetCount: number;
    requestedLimit: number;
};

export type WorkspaceCoreSnapshot = {
    conversationHeader: Conversation | null;
    messages: Message[];
    activityTimeline: any[];
    transcriptOnDemandEnabled: boolean;
    hydration: WorkspaceHydrationState;
};

export type WorkspaceRefreshInFlightSets = {
    initialHydration?: Set<string>;
    backfill?: Set<string>;
    activityHydration?: Set<string>;
    messageMetadata?: Set<string>;
};

type WorkspaceMessageWindowLike = {
    oldestCursor?: string | null;
    newestCursor?: string | null;
    count?: number;
    requestedLimit?: number;
} | null | undefined;

export function createWorkspaceHydrationState(args: {
    status?: WorkspaceHydrationStatus;
    messages: Message[];
    messageWindow?: WorkspaceMessageWindowLike;
    initialCount?: number;
    targetCount?: number;
    requestedLimit?: number;
}): WorkspaceHydrationState {
    const messages = Array.isArray(args.messages) ? args.messages : [];
    const messageWindow = args.messageWindow;
    const derivedInitialCount = Number(args.initialCount);
    const derivedTargetCount = Number(args.targetCount);
    const derivedRequestedLimit = Number(args.requestedLimit);
    const resolvedCount = Number(messageWindow?.count);
    const resolvedRequestedLimit = Number(messageWindow?.requestedLimit);

    return {
        status: args.status || 'full',
        oldestCursor: messageWindow?.oldestCursor || buildMessageCursorFromMessage(messages[0]) || null,
        newestCursor: messageWindow?.newestCursor || buildMessageCursorFromMessage(messages[messages.length - 1]) || null,
        initialCount: Number.isFinite(derivedInitialCount)
            ? Math.max(0, Math.floor(derivedInitialCount))
            : (Number.isFinite(resolvedCount) ? Math.max(0, Math.floor(resolvedCount)) : messages.length),
        targetCount: Number.isFinite(derivedTargetCount)
            ? Math.max(1, Math.floor(derivedTargetCount))
            : THREAD_TARGET_MESSAGE_COUNT,
        requestedLimit: Number.isFinite(derivedRequestedLimit)
            ? Math.max(1, Math.floor(derivedRequestedLimit))
            : (Number.isFinite(resolvedRequestedLimit)
                ? Math.max(1, Math.floor(resolvedRequestedLimit))
                : Math.max(messages.length || 0, THREAD_INITIAL_FALLBACK_MESSAGES)),
    };
}

export function createWorkspaceCoreSnapshot(args: {
    conversationHeader?: Conversation | null;
    messages?: Message[];
    activityTimeline?: any[];
    transcriptEligibility?: { success?: boolean; enabled?: boolean } | null;
    transcriptOnDemandEnabled?: boolean;
    hydration: WorkspaceHydrationState;
}): WorkspaceCoreSnapshot {
    return {
        conversationHeader: args.conversationHeader || null,
        messages: Array.isArray(args.messages) ? args.messages : [],
        activityTimeline: Array.isArray(args.activityTimeline) ? args.activityTimeline : [],
        transcriptOnDemandEnabled: typeof args.transcriptOnDemandEnabled === 'boolean'
            ? args.transcriptOnDemandEnabled
            : (!!args.transcriptEligibility?.success && !!args.transcriptEligibility?.enabled),
        hydration: args.hydration,
    };
}

export function isWorkspaceRefreshBusy(
    conversationId: string | null | undefined,
    inFlight: WorkspaceRefreshInFlightSets
): boolean {
    const key = String(conversationId || "").trim();
    if (!key) return false;
    return (
        !!inFlight.initialHydration?.has(key)
        || !!inFlight.backfill?.has(key)
        || !!inFlight.activityHydration?.has(key)
        || !!inFlight.messageMetadata?.has(key)
    );
}

export function getPendingMessageKey(message: Partial<Message> | null | undefined): string | null {
    if (!message) return null;
    const clientMessageId = String((message as any).clientMessageId || "").trim();
    if (clientMessageId) return `client:${clientMessageId}`;
    const id = String(message.id || "").trim();
    if (id) return `id:${id}`;
    const wamId = String((message as any).wamId || "").trim();
    if (wamId) return `wam:${wamId}`;
    return null;
}

export function collectPendingMessagesForConversation(
    conversationId: string,
    list: Message[]
): Map<string, Message> {
    const normalizedConversationId = String(conversationId || "").trim();
    const nextMap = new Map<string, Message>();
    if (!normalizedConversationId) return nextMap;

    for (const message of Array.isArray(list) ? list : []) {
        if (!isPendingOutboundMessage(message as any)) continue;

        // Prevent optimistic leaking during rapid activeId changes before messages settle.
        if ((message as any).conversationId && (message as any).conversationId !== normalizedConversationId) {
            continue;
        }

        const key = getPendingMessageKey(message);
        if (!key) continue;
        nextMap.set(key, message);
    }

    return nextMap;
}

export function mergeSnapshotPreservingPendingMessages(
    snapshotMessages: Message[],
    pendingMessages: Message[]
): Message[] {
    return Array.isArray(pendingMessages) && pendingMessages.length > 0
        ? mergeSnapshotWithPendingMessages(snapshotMessages || [], pendingMessages)
        : (Array.isArray(snapshotMessages) ? snapshotMessages : []);
}
