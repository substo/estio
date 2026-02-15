import db from "@/lib/db";

/**
 * Context Compaction
 * 
 * Long-running deals can have 200+ messages across weeks.
 * Even with 1M token context, loading everything is wasteful and slow.
 * 
 * Solution: Progressive Summarization
 * - Old messages are summarized by a cheap model
 * - Recent messages stay verbatim
 * - Summary is cached in Conversation.contextSummary
 */

interface CompactedContext {
    summary: string;
    recentMessages: { direction: string; body: string; createdAt: Date }[];
}

/**
 * Compact a conversation's context into a summary + recent messages.
 * 
 * @param conversationId - The conversation to compact
 * @param maxRecentMessages - Number of recent messages to keep verbatim (default: 20)
 * @returns Compacted context with summary and recent messages
 */
export async function compactContext(
    conversationId: string,
    maxRecentMessages: number = 20
): Promise<CompactedContext> {
    const messages = await db.message.findMany({
        where: { conversationId },
        orderBy: { createdAt: "asc" },
        select: { direction: true, body: true, createdAt: true },
    });

    // If short enough, no compaction needed
    if (messages.length <= maxRecentMessages) {
        return {
            summary: "",
            recentMessages: messages.map(m => ({
                direction: m.direction,
                body: m.body ?? "",
                createdAt: m.createdAt,
            })),
        };
    }

    // Check if we have a cached summary that's still valid
    const conversation = await db.conversation.findUnique({
        where: { id: conversationId },
        select: { contextSummary: true, lastSummarizedAt: true },
    });

    const oldMessages = messages.slice(0, -maxRecentMessages);
    const recentMessages = messages.slice(-maxRecentMessages).map(m => ({
        direction: m.direction,
        body: m.body ?? "",
        createdAt: m.createdAt,
    }));

    // If we have a recent cache (less than 1 hour old), use it
    if (
        conversation?.contextSummary &&
        conversation.lastSummarizedAt &&
        Date.now() - conversation.lastSummarizedAt.getTime() < 60 * 60 * 1000
    ) {
        return { summary: conversation.contextSummary, recentMessages };
    }

    // Generate new summary
    const summary = await summarizeConversation(oldMessages);

    // Cache the summary
    await db.conversation.update({
        where: { id: conversationId },
        data: {
            contextSummary: summary,
            lastSummarizedAt: new Date(),
        },
    });

    return { summary, recentMessages };
}

/**
 * Summarize a list of messages into a concise context summary.
 * Uses a cheap/fast model to keep costs low.
 */
async function summarizeConversation(
    messages: { direction: string; body: string | null; createdAt: Date }[]
): Promise<string> {
    const { callLLM } = await import("../llm");
    const { getModelForTask } = await import("../model-router");

    const conversationText = messages
        .map((m) => `[${m.direction}] ${m.body ?? ""}`)
        .join("\n");

    const systemPrompt = `You are a real estate CRM assistant. Summarize conversations concisely.
Focus on:
- Key requirements discussed (budget, location, property type, bedrooms)
- Properties shown or discussed (names, prices, reactions)
- Decisions made (offers, viewings scheduled, preferences confirmed)
- Outstanding questions or concerns
- Current deal stage and next expected steps

Keep the summary concise but complete. Use bullet points.`;

    const userContent = `Summarize this conversation:\n\n${conversationText}`;

    try {
        const modelId = getModelForTask("intent_classification");
        const result = await callLLM(modelId, systemPrompt, userContent, {
            temperature: 0.3,
        });
        return result ?? "";
    } catch (error) {
        console.error("[Context Compaction] Summarization failed:", error);
        return `[Auto-summary unavailable. ${messages.length} earlier messages not shown. Most recent messages follow.]`;
    }
}

/**
 * Build a full context string from compacted context.
 * Ready to inject into agent prompts.
 */
export function buildContextString(context: CompactedContext): string {
    const parts: string[] = [];

    if (context.summary) {
        parts.push(`=== CONVERSATION SUMMARY (older messages) ===\n${context.summary}\n`);
    }

    if (context.recentMessages.length > 0) {
        parts.push(
            `=== RECENT MESSAGES ===\n` +
            context.recentMessages
                .map((m) => `[${m.direction}] ${m.body}`)
                .join("\n")
        );
    }

    return parts.join("\n");
}
