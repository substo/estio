import db from "@/lib/db";
import { publishViewingSessionRealtimeEvent } from "@/lib/realtime/viewing-session-events";
import { appendViewingSessionEvent } from "@/lib/viewings/sessions/events";
import { VIEWING_SESSION_EVENT_TYPES } from "@/lib/viewings/sessions/types";

type RecordViewingSessionUsageInput = {
    sessionId: string;
    locationId: string;
    phase: "analysis" | "summary" | "live_audio" | "tooling";
    provider?: string | null;
    model?: string | null;
    transportStatus?: string | null;
    inputAudioSeconds?: number | null;
    outputAudioSeconds?: number | null;
    inputTokens?: number | null;
    outputTokens?: number | null;
    totalTokens?: number | null;
    toolCalls?: number | null;
    estimatedCostUsd?: number | null;
    actualCostUsd?: number | null;
    metadata?: Record<string, unknown> | null;
};

function asString(value: unknown): string {
    return String(value || "").trim();
}

function asNumber(value: unknown, fallback: number = 0): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return parsed;
}

export async function recordViewingSessionUsage(input: RecordViewingSessionUsageInput) {
    const sessionId = asString(input.sessionId);
    const locationId = asString(input.locationId);
    if (!sessionId || !locationId) return null;

    const inputTokens = Math.max(0, Math.floor(asNumber(input.inputTokens, 0)));
    const outputTokens = Math.max(0, Math.floor(asNumber(input.outputTokens, 0)));
    const totalTokens = Math.max(
        0,
        Math.floor(
            asNumber(
                input.totalTokens,
                inputTokens + outputTokens
            )
        )
    );
    const estimatedCostUsd = Math.max(0, asNumber(input.estimatedCostUsd, 0));
    const actualCostUsd = Math.max(0, asNumber(input.actualCostUsd, estimatedCostUsd));

    const usage = await db.viewingSessionUsage.create({
        data: {
            sessionId,
            locationId,
            phase: input.phase,
            provider: asString(input.provider) || null,
            model: asString(input.model) || null,
            transportStatus: asString(input.transportStatus) || null,
            inputAudioSeconds: Math.max(0, asNumber(input.inputAudioSeconds, 0)),
            outputAudioSeconds: Math.max(0, asNumber(input.outputAudioSeconds, 0)),
            inputTokens,
            outputTokens,
            totalTokens,
            toolCalls: Math.max(0, Math.floor(asNumber(input.toolCalls, 0))),
            estimatedCostUsd,
            actualCostUsd,
            metadata: (input.metadata as any) || undefined,
        },
    });

    const updatedSession = await db.viewingSession.update({
        where: { id: sessionId },
        data: {
            estimatedCostUsd: {
                increment: estimatedCostUsd,
            },
            actualCostUsd: {
                increment: actualCostUsd,
            },
            ...(asString(input.provider) ? { liveProvider: asString(input.provider) } : {}),
        },
        select: {
            id: true,
            locationId: true,
            estimatedCostUsd: true,
            actualCostUsd: true,
        },
    }).catch(() => null);

    await appendViewingSessionEvent({
        sessionId,
        locationId,
        type: "viewing_session.usage.recorded",
        source: "worker",
        payload: {
            usageId: usage.id,
            phase: usage.phase,
            estimatedCostUsd: usage.estimatedCostUsd,
            actualCostUsd: usage.actualCostUsd,
            totalTokens: usage.totalTokens,
        },
    });

    await publishViewingSessionRealtimeEvent({
        sessionId,
        locationId,
        type: VIEWING_SESSION_EVENT_TYPES.usageUpdated,
        payload: {
            usage: {
                id: usage.id,
                phase: usage.phase,
                provider: usage.provider,
                model: usage.model,
                inputAudioSeconds: usage.inputAudioSeconds,
                outputAudioSeconds: usage.outputAudioSeconds,
                inputTokens: usage.inputTokens,
                outputTokens: usage.outputTokens,
                totalTokens: usage.totalTokens,
                toolCalls: usage.toolCalls,
                estimatedCostUsd: usage.estimatedCostUsd,
                actualCostUsd: usage.actualCostUsd,
                recordedAt: usage.recordedAt.toISOString(),
            },
            sessionCost: updatedSession ? {
                estimatedCostUsd: updatedSession.estimatedCostUsd,
                actualCostUsd: updatedSession.actualCostUsd,
            } : null,
        },
    });

    return usage;
}

export async function getViewingSessionThreadUsageSummary(sessionThreadId: string) {
    const normalizedThreadId = asString(sessionThreadId);
    if (!normalizedThreadId) {
        return null;
    }

    const sessions = await db.viewingSession.findMany({
        where: { sessionThreadId: normalizedThreadId },
        select: { id: true },
    });
    if (sessions.length === 0) {
        return {
            sessionThreadId: normalizedThreadId,
            totalEstimatedCostUsd: 0,
            totalActualCostUsd: 0,
            usageCount: 0,
        };
    }

    const sessionIds = sessions.map((item) => item.id);
    const aggregate = await db.viewingSessionUsage.aggregate({
        where: { sessionId: { in: sessionIds } },
        _sum: {
            estimatedCostUsd: true,
            actualCostUsd: true,
        },
        _count: {
            _all: true,
        },
    });

    return {
        sessionThreadId: normalizedThreadId,
        totalEstimatedCostUsd: Number(aggregate._sum.estimatedCostUsd || 0),
        totalActualCostUsd: Number(aggregate._sum.actualCostUsd || 0),
        usageCount: Number(aggregate._count._all || 0),
    };
}
