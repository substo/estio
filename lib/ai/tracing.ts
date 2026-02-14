
import db from "@/lib/db";
import { v4 as uuidv4 } from "uuid";

export interface TraceContext {
    traceId: string;
    parentSpanId?: string;
    conversationId: string;
}

export interface Span {
    id: string;
    traceId: string;
    parentSpanId?: string;
    name: string;
    startTime: number;
    endTime?: number;
    status: "pending" | "success" | "error";
    metadata?: any;
}

/**
 * Start a new root trace for an agent interaction.
 */
export async function startTrace(conversationId: string, taskTitle: string): Promise<TraceContext> {
    const traceId = uuidv4();

    // Create the root span/record in AgentExecution
    // We use AgentExecution as a flattened span store for now
    await db.agentExecution.create({
        data: {
            traceId,
            spanId: traceId, // Root span has same ID as trace or new format? Plan says extended AgentExecution.
            // Let's treat AgentExecution as the "Task" level trace.
            // Sub-steps might need their own table or just simple logging for now.
            // Phase 0 doc implies extending AgentExecution to store span info.
            // For simplicity in Phase 0, we might just have the main AgentExecution as the root span.
            conversationId,
            taskTitle,
            status: "pending",
            latencyMs: 0,
        }
    });

    return { traceId, conversationId };
}

/**
 * Update the trace status and metrics on completion.
 */
export async function endTrace(
    traceId: string,
    status: "success" | "error",
    output?: string,
    toolCalls?: any[],
    cost?: number,
    tokens?: { prompt: number, completion: number, total: number }
) {
    const endTime = Date.now();

    // We need to fetch start time to calc latency, or just store completedAt
    // Simplified: update with gathered data
    await db.agentExecution.updateMany({
        where: { traceId, spanId: traceId }, // Update root span
        data: {
            status,
            draftReply: output,
            toolCalls: toolCalls ? JSON.stringify(toolCalls) : undefined,
            cost,
            promptTokens: tokens?.prompt,
            completionTokens: tokens?.completion,
            totalTokens: tokens?.total,
            // latency calculation requires fetching creation time. 
            // accepting 0 or approx for now until we change DB schema to have startTime/endTime
        }
    });
}

/**
 * Create a child span for a sub-task or tool call.
 * Note: If AgentExecution model is the only storage, we create a new row for each span.
 */
export async function startSpan(
    parentContext: TraceContext,
    name: string,
    type: "tool" | "thought" | "planning"
): Promise<TraceContext & { spanId: string, startTime: number }> {
    const spanId = uuidv4();
    const startTime = Date.now();

    await db.agentExecution.create({
        data: {
            traceId: parentContext.traceId,
            spanId,
            parentSpanId: parentContext.parentSpanId || parentContext.traceId,
            conversationId: parentContext.conversationId,
            taskTitle: name, // generic field reuse
            intent: type,
            status: "pending",
        }
    });

    return { ...parentContext, parentSpanId: spanId, spanId, startTime };
}

export async function endSpan(
    spanId: string,
    startTime: number,
    status: "success" | "error",
    metadata?: { output?: string, errorMessage?: string }
) {
    const latencyMs = Date.now() - startTime;

    await db.agentExecution.updateMany({
        where: { spanId },
        data: {
            status,
            latencyMs,
            draftReply: metadata?.output, // reusing existing field
            errorMessage: metadata?.errorMessage
        }
    });
}
