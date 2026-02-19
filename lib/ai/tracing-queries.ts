
import db from "@/lib/db";

export interface TraceNode {
    spanId: string;
    name: string;
    type: string;
    status: string;
    latency: number;
    startTime: Date;
    metadata: any;
    children: TraceNode[];
}

/**
 * Reconstruct the full execution tree for a given trace ID.
 */
export async function getTrace(traceId: string): Promise<TraceNode | null> {
    const spans = await db.agentExecution.findMany({
        where: { traceId },
        orderBy: { createdAt: "asc" }
    });

    if (spans.length === 0) return null;

    const parseJsonField = (value: any, fallback: any) => {
        if (value == null) return fallback;
        if (typeof value === "string") {
            try {
                return JSON.parse(value);
            } catch {
                return fallback;
            }
        }
        return value;
    };

    // Map to nodes
    const nodeMap = new Map<string, TraceNode>();
    let root: TraceNode | null = null;

    spans.forEach(span => {
        const spanId = span.spanId ?? span.id; // Fallback to primary key if spanId is null
        const node: TraceNode = {
            spanId,
            name: span.taskTitle || "Unknown Task",
            type: span.intent || "unknown",
            status: span.status,
            latency: span.latencyMs,
            startTime: span.createdAt,
            metadata: {
                output: span.draftReply,
                error: span.errorMessage,
                toolCalls: parseJsonField(span.toolCalls, []),
                model: span.model,
                cost: span.cost,
                tokens: span.totalTokens,
                thoughtSummary: span.thoughtSummary
            },
            children: []
        };
        nodeMap.set(spanId, node);
    });

    // Build tree
    spans.forEach(span => {
        const spanId = span.spanId ?? span.id;
        const node = nodeMap.get(spanId)!;
        if (span.parentSpanId && nodeMap.has(span.parentSpanId)) {
            nodeMap.get(span.parentSpanId)!.children.push(node);
        } else {
            // If no parent or parent not found, it's a root (or detached)
            // Ideally there is only one root per traceId
            if (!root || span.spanId === span.traceId) {
                root = node;
            }
        }
    });

    return root;
}

/**
 * Get recent traces for a conversation
 */
export async function getConversationTraces(conversationId: string, limit: number = 10) {
    // We only want root spans
    return db.agentExecution.findMany({
        where: {
            conversationId,
            parentSpanId: null // or where spanId == traceId if we set it that way
        },
        orderBy: { createdAt: "desc" },
        take: limit
    });
}
