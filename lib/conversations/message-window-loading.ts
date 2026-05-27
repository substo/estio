import type { Message } from "@/lib/ghl/conversations";
import { buildMessageCursorFromMessage } from "@/lib/conversations/thread-hydration";
import {
    fetchMessagesForResolvedConversation,
    type ResolvedLocationForMessages,
} from "@/lib/conversations/message-loading";
import type { ConversationWorkspaceCoreMetadata } from "@/lib/conversations/workspace-metadata-loading";

const DEFAULT_MESSAGE_WINDOW_TAKE = 35;
const MAX_MESSAGE_WINDOW_TAKE = 100;

type MessageWindowDependencies = {
    resolveTranscriptVisibilityAccess: (locationId: string) => Promise<{ restrictContent: boolean }>;
    parseLegacyCrmLeadNotificationEmail: (args: {
        subject?: string | null;
        emailFrom?: string | null;
        body?: string | null;
        configuredSenders?: string[] | null;
        configuredDomains?: string[] | null;
        configuredSubjectPatterns?: string[] | null;
    }) => any;
};

function resolveRequestedTake(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MESSAGE_WINDOW_TAKE;
    return Math.min(Math.max(Math.floor(parsed), 1), MAX_MESSAGE_WINDOW_TAKE);
}

export async function loadConversationMessageWindow(args: {
    traceId: string;
    location: ResolvedLocationForMessages;
    conversationId: string;
    take?: number | null;
    loadMetadata: () => Promise<ConversationWorkspaceCoreMetadata | null>;
    dependencies: MessageWindowDependencies;
}) {
    const startedAtMs = Date.now();
    const requestedTake = resolveRequestedTake(args.take);

    const headerStartedAtMs = Date.now();
    const metadata = await args.loadMetadata();
    const headerMs = Date.now() - headerStartedAtMs;

    if (!metadata) {
        console.log("[perf:conversations.message_window]", JSON.stringify({
            traceId: args.traceId,
            conversationId: args.conversationId,
            requestedTake,
            returnedMessageCount: 0,
            messages_ms: 0,
            header_ms: headerMs,
            total_ms: Date.now() - startedAtMs,
            found: false,
        }));
        return {
            success: false as const,
            traceId: args.traceId,
            error: "Conversation not found.",
        };
    }

    const messagesStartedAtMs = Date.now();
    const messages = await fetchMessagesForResolvedConversation({
        requestedConversationId: args.conversationId,
        location: args.location,
        conversation: metadata.resolvedConversation,
        options: {
            take: requestedTake,
            includeLegacyEmailMeta: false,
            metadataMode: "firstPaint",
            refreshMode: "initial_hydration",
        },
        reusedConversationContext: true,
        dependencies: args.dependencies,
    });
    const messagesMs = Date.now() - messagesStartedAtMs;

    const messageWindow = {
        oldestCursor: buildMessageCursorFromMessage((messages as Message[])[0]) || null,
        newestCursor: buildMessageCursorFromMessage((messages as Message[])[messages.length - 1]) || null,
        count: messages.length,
        requestedLimit: requestedTake,
    };

    console.log("[perf:conversations.message_window]", JSON.stringify({
        traceId: args.traceId,
        conversationId: args.conversationId,
        requestedTake,
        returnedMessageCount: messages.length,
        messages_ms: messagesMs,
        header_ms: headerMs,
        total_ms: Date.now() - startedAtMs,
        found: true,
    }));

    return {
        success: true as const,
        traceId: args.traceId,
        conversationHeader: metadata.conversationHeader,
        messages,
        freshness: metadata.freshness,
        messageWindow,
    };
}
