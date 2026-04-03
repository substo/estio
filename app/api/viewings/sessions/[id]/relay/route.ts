import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import db from "@/lib/db";
import { initViewingSessionAnalysisWorker, enqueueViewingSessionAnalysis } from "@/lib/queue/viewing-session-analysis";
import { enqueueViewingSessionSynthesis, initViewingSessionSynthesisWorker } from "@/lib/queue/viewing-session-synthesis";
import { publishViewingSessionRealtimeEvent } from "@/lib/realtime/viewing-session-events";
import { resolveViewingSessionRequestContext } from "@/lib/viewings/sessions/auth";
import { appendViewingSessionEvent } from "@/lib/viewings/sessions/events";
import {
    setViewingSessionTransportStatus,
    ViewingSessionTransportTransitionError,
} from "@/lib/viewings/sessions/runtime";
import { isViewingLiveToolAllowed } from "@/lib/viewings/sessions/tool-policy";
import { recordViewingSessionUsage } from "@/lib/viewings/sessions/usage";
import {
    deriveViewingSessionAnalysisStatus,
    VIEWING_SESSION_EVENT_TYPES,
    VIEWING_SESSION_INSIGHT_PIPELINE_STATUSES,
    VIEWING_SESSION_MESSAGE_KINDS,
    VIEWING_SESSION_MESSAGE_ORIGINS,
    VIEWING_SESSION_SPEAKERS,
    VIEWING_SESSION_TRANSCRIPT_STATUSES,
    VIEWING_SESSION_TRANSLATION_STATUSES,
    VIEWING_SESSION_TRANSPORT_STATUSES,
    type ViewingSessionMessageOrigin,
    type ViewingSessionSpeaker,
} from "@/lib/viewings/sessions/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const relaySchema = z.discriminatedUnion("eventType", [
    z.object({
        eventType: z.literal("connect"),
        transportStatus: z.enum([
            VIEWING_SESSION_TRANSPORT_STATUSES.connecting,
            VIEWING_SESSION_TRANSPORT_STATUSES.connected,
            VIEWING_SESSION_TRANSPORT_STATUSES.degraded,
            VIEWING_SESSION_TRANSPORT_STATUSES.reconnecting,
            VIEWING_SESSION_TRANSPORT_STATUSES.disconnected,
            VIEWING_SESSION_TRANSPORT_STATUSES.chained,
            VIEWING_SESSION_TRANSPORT_STATUSES.failed,
        ]).optional(),
        metadata: z.record(z.any()).optional(),
    }),
    z.object({
        eventType: z.literal("disconnect"),
        reason: z.string().trim().max(500).optional(),
        metadata: z.record(z.any()).optional(),
    }),
    z.object({
        eventType: z.literal("transcript"),
        speaker: z.enum([
            VIEWING_SESSION_SPEAKERS.client,
            VIEWING_SESSION_SPEAKERS.agent,
            VIEWING_SESSION_SPEAKERS.system,
        ]).optional(),
        sourceMessageId: z.string().trim().min(1).max(140).optional(),
        text: z.string().trim().min(1).max(20_000),
        originalLanguage: z.string().trim().max(24).optional(),
        translatedText: z.string().trim().max(20_000).optional(),
        targetLanguage: z.string().trim().max(24).optional(),
        timestamp: z.string().datetime().optional(),
        supersedesMessageId: z.string().trim().min(1).max(120).optional(),
        origin: z.enum([
            VIEWING_SESSION_MESSAGE_ORIGINS.relayLiveTranscript,
            VIEWING_SESSION_MESSAGE_ORIGINS.browserStt,
            VIEWING_SESSION_MESSAGE_ORIGINS.manualText,
        ]).optional(),
        provider: z.string().trim().max(120).optional(),
        model: z.string().trim().max(120).optional(),
        modelVersion: z.string().trim().max(120).optional(),
        transcriptStatus: z.enum([
            VIEWING_SESSION_TRANSCRIPT_STATUSES.provisional,
            VIEWING_SESSION_TRANSCRIPT_STATUSES.final,
        ]).optional(),
        metadata: z.record(z.any()).optional(),
    }),
    z.object({
        eventType: z.literal("tool_result"),
        sourceMessageId: z.string().trim().min(1).max(140).optional(),
        text: z.string().trim().min(1).max(20_000),
        provider: z.string().trim().max(120).optional(),
        model: z.string().trim().max(120).optional(),
        modelVersion: z.string().trim().max(120).optional(),
        metadata: z.record(z.any()).optional(),
    }),
    z.object({
        eventType: z.literal("usage"),
        phase: z.enum(["analysis", "summary", "live_audio", "tooling"]).default("live_audio"),
        provider: z.string().trim().max(100).optional(),
        model: z.string().trim().max(120).optional(),
        transportStatus: z.string().trim().max(32).optional(),
        inputAudioSeconds: z.number().min(0).optional(),
        outputAudioSeconds: z.number().min(0).optional(),
        inputTokens: z.number().int().min(0).optional(),
        outputTokens: z.number().int().min(0).optional(),
        totalTokens: z.number().int().min(0).optional(),
        toolCalls: z.number().int().min(0).optional(),
        estimatedCostUsd: z.number().min(0).optional(),
        actualCostUsd: z.number().min(0).optional(),
        metadata: z.record(z.any()).optional(),
    }),
]);

function resolveSpeaker(role: "client" | "agent" | "admin", requested?: ViewingSessionSpeaker): ViewingSessionSpeaker {
    if (role === "client") return VIEWING_SESSION_SPEAKERS.client;
    if (role === "agent") return requested || VIEWING_SESSION_SPEAKERS.agent;
    return requested || VIEWING_SESSION_SPEAKERS.system;
}

async function createRelayMessage(args: {
    sessionId: string;
    locationId: string;
    role: "client" | "agent" | "admin";
    speaker?: ViewingSessionSpeaker;
    sourceMessageId?: string | null;
    messageKind: "utterance" | "tool_result";
    text: string;
    originalLanguage?: string | null;
    translatedText?: string | null;
    targetLanguage?: string | null;
    timestamp?: Date | null;
    supersedesMessageId?: string | null;
    origin?: ViewingSessionMessageOrigin;
    provider?: string | null;
    model?: string | null;
    modelVersion?: string | null;
    transcriptStatus?: "provisional" | "final";
    metadata?: Record<string, unknown> | null;
}) {
    const sessionId = String(args.sessionId || "").trim();
    const sourceMessageId = String(args.sourceMessageId || "").trim() || null;
    const supersedesMessageId = String(args.supersedesMessageId || "").trim() || null;
    const speaker = resolveSpeaker(args.role, args.speaker);
    const timestamp = args.timestamp || new Date();
    const origin = args.origin || (
        args.messageKind === VIEWING_SESSION_MESSAGE_KINDS.toolResult
            ? VIEWING_SESSION_MESSAGE_ORIGINS.relayToolResult
            : VIEWING_SESSION_MESSAGE_ORIGINS.relayLiveTranscript
    );
    const provider = String(args.provider || "").trim() || null;
    const model = String(args.model || "").trim() || null;
    const modelVersion = String(args.modelVersion || "").trim() || null;
    const transcriptStatus = args.transcriptStatus || VIEWING_SESSION_TRANSCRIPT_STATUSES.final;

    const writeResult = await db.$transaction(async (tx) => {
        if (sourceMessageId) {
            const existing = await tx.viewingSessionMessage.findFirst({
                where: {
                    sessionId,
                    sourceMessageId,
                },
            });
            if (existing) {
                return {
                    message: existing,
                    idempotent: true,
                };
            }
        }

        if (supersedesMessageId) {
            const supersedes = await tx.viewingSessionMessage.findFirst({
                where: {
                    id: supersedesMessageId,
                    sessionId,
                },
                select: { id: true, utteranceId: true },
            });
            if (!supersedes) {
                throw new Error("Superseded message not found in this session.");
            }

            await tx.viewingSession.update({
                where: { id: sessionId },
                data: { updatedAt: new Date() },
                select: { id: true },
            });

            const latest = await tx.viewingSessionMessage.findFirst({
                where: { sessionId },
                orderBy: [{ sequence: "desc" }],
                select: { sequence: true },
            });
            const nextSequence = Number(latest?.sequence || 0) + 1;
            const persistedAt = new Date();

            const isToolResult = args.messageKind === VIEWING_SESSION_MESSAGE_KINDS.toolResult;
            const translationStatus = isToolResult
                ? VIEWING_SESSION_TRANSLATION_STATUSES.skipped
                : (args.translatedText ? VIEWING_SESSION_TRANSLATION_STATUSES.completed : VIEWING_SESSION_TRANSLATION_STATUSES.pending);
            const insightStatus = isToolResult
                ? VIEWING_SESSION_INSIGHT_PIPELINE_STATUSES.skipped
                : VIEWING_SESSION_INSIGHT_PIPELINE_STATUSES.pending;
            const analysisStatus = deriveViewingSessionAnalysisStatus({
                translationStatus,
                insightStatus,
            });
            const nextId = randomUUID();

            const created = await tx.viewingSessionMessage.create({
                data: {
                    id: nextId,
                    sessionId,
                    sequence: nextSequence,
                    utteranceId: supersedes.utteranceId,
                    sourceMessageId,
                    messageKind: args.messageKind,
                    origin,
                    provider,
                    model,
                    modelVersion,
                    transcriptStatus,
                    translationStatus,
                    insightStatus,
                    persistedAt,
                    supersedesMessageId,
                    speaker,
                    originalText: args.text,
                    originalLanguage: args.originalLanguage || null,
                    translatedText: args.translatedText || null,
                    targetLanguage: args.targetLanguage || null,
                    timestamp,
                    analysisStatus,
                    metadata: args.metadata ? (args.metadata as any) : undefined,
                },
            });

            return {
                message: created,
                idempotent: false,
            };
        }

        await tx.viewingSession.update({
            where: { id: sessionId },
            data: { updatedAt: new Date() },
            select: { id: true },
        });

        const latest = await tx.viewingSessionMessage.findFirst({
            where: { sessionId },
            orderBy: [{ sequence: "desc" }],
            select: { sequence: true },
        });
        const nextSequence = Number(latest?.sequence || 0) + 1;
        const persistedAt = new Date();

        const isToolResult = args.messageKind === VIEWING_SESSION_MESSAGE_KINDS.toolResult;
        const translationStatus = isToolResult
            ? VIEWING_SESSION_TRANSLATION_STATUSES.skipped
            : (args.translatedText ? VIEWING_SESSION_TRANSLATION_STATUSES.completed : VIEWING_SESSION_TRANSLATION_STATUSES.pending);
        const insightStatus = isToolResult
            ? VIEWING_SESSION_INSIGHT_PIPELINE_STATUSES.skipped
            : VIEWING_SESSION_INSIGHT_PIPELINE_STATUSES.pending;
        const analysisStatus = deriveViewingSessionAnalysisStatus({
            translationStatus,
            insightStatus,
        });
        const nextId = randomUUID();

        const created = await tx.viewingSessionMessage.create({
            data: {
                id: nextId,
                sessionId,
                sequence: nextSequence,
                utteranceId: nextId,
                sourceMessageId,
                messageKind: args.messageKind,
                origin,
                provider,
                model,
                modelVersion,
                transcriptStatus,
                translationStatus,
                insightStatus,
                persistedAt,
                supersedesMessageId,
                speaker,
                originalText: args.text,
                originalLanguage: args.originalLanguage || null,
                translatedText: args.translatedText || null,
                targetLanguage: args.targetLanguage || null,
                timestamp,
                analysisStatus,
                metadata: args.metadata ? (args.metadata as any) : undefined,
            },
        });

        return {
            message: created,
            idempotent: false,
        };
    });

    if (!writeResult.idempotent) {
        await publishViewingSessionRealtimeEvent({
            sessionId,
            locationId: args.locationId,
            type: VIEWING_SESSION_EVENT_TYPES.messageCreated,
            payload: {
                message: {
                    id: writeResult.message.id,
                    sessionId,
                    sequence: writeResult.message.sequence,
                    utteranceId: writeResult.message.utteranceId,
                    sourceMessageId: writeResult.message.sourceMessageId,
                    messageKind: writeResult.message.messageKind,
                    origin: writeResult.message.origin,
                    provider: writeResult.message.provider,
                    model: writeResult.message.model,
                    modelVersion: writeResult.message.modelVersion,
                    transcriptStatus: writeResult.message.transcriptStatus,
                    persistedAt: writeResult.message.persistedAt.toISOString(),
                    supersedesMessageId: writeResult.message.supersedesMessageId,
                    speaker: writeResult.message.speaker,
                    originalText: writeResult.message.originalText,
                    originalLanguage: writeResult.message.originalLanguage,
                    translatedText: writeResult.message.translatedText,
                    targetLanguage: writeResult.message.targetLanguage,
                    confidence: writeResult.message.confidence,
                    audioChunkRef: writeResult.message.audioChunkRef,
                    translationStatus: writeResult.message.translationStatus,
                    insightStatus: writeResult.message.insightStatus,
                    analysisStatus: writeResult.message.analysisStatus,
                    timestamp: writeResult.message.timestamp.toISOString(),
                    createdAt: writeResult.message.createdAt.toISOString(),
                },
            },
        });
    }

    await appendViewingSessionEvent({
        sessionId,
        locationId: args.locationId,
        type: writeResult.idempotent ? "viewing_session.relay.message.idempotent_hit" : "viewing_session.relay.message.created",
        source: "relay",
        actorRole: args.role,
        payload: {
            messageId: writeResult.message.id,
            sourceMessageId: writeResult.message.sourceMessageId,
            messageKind: writeResult.message.messageKind,
            origin: writeResult.message.origin,
        },
    });

    return writeResult;
}

function isClientConsentMissing(consentStatus: string | null | undefined): boolean {
    const normalized = String(consentStatus || "").trim().toLowerCase();
    return normalized === "required" || normalized === "declined";
}

export async function GET() {
    const relayWebsocketUrl = String(process.env.VIEWING_SESSION_BACKEND_RELAY_WS_URL || "ws://127.0.0.1:8788/ws").trim();
    return NextResponse.json(
        {
            success: true,
            relay: {
                websocketUpgradeSupported: true,
                ingestionMode: "dedicated_backend_relay",
                websocketUrl: relayWebsocketUrl,
                notes: "Dedicated relay process owns websocket transport. This route remains the persisted ingestion boundary.",
            },
        },
        { status: 200 }
    );
}

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const sessionId = String(id || "").trim();
    if (!sessionId) {
        return NextResponse.json({ success: false, error: "Missing session id." }, { status: 400 });
    }

    const tokenOverride = String(req.nextUrl.searchParams.get("accessToken") || "").trim() || null;
    const context = await resolveViewingSessionRequestContext({
        request: req,
        sessionId,
        allowClientToken: true,
        allowAgentToken: true,
        tokenOverride,
    });
    if (!context) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const session = await db.viewingSession.findUnique({
        where: { id: context.sessionId },
        select: {
            id: true,
            consentStatus: true,
        },
    });
    if (!session) {
        return NextResponse.json({ success: false, error: "Session not found." }, { status: 404 });
    }

    const parsed = relaySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json(
            {
                success: false,
                error: "Invalid relay payload.",
                details: parsed.error.flatten().fieldErrors,
            },
            { status: 400 }
        );
    }

    if (context.role === "client" && isClientConsentMissing(session.consentStatus)) {
        await appendViewingSessionEvent({
            sessionId: context.sessionId,
            locationId: context.locationId,
            type: "viewing_session.relay.rejected",
            source: "relay",
            actorRole: context.role,
            payload: {
                reason: "consent_missing",
                consentStatus: session.consentStatus,
                eventType: parsed.data.eventType,
            },
        });
        return NextResponse.json(
            {
                success: false,
                error: "AI disclosure must be accepted before live relay activity.",
                code: "AI_DISCLOSURE_REQUIRED",
            },
            { status: 403 }
        );
    }

    if (parsed.data.eventType === "connect") {
        const transportStatus = parsed.data.transportStatus || VIEWING_SESSION_TRANSPORT_STATUSES.connected;
        try {
            await setViewingSessionTransportStatus({
                sessionId: context.sessionId,
                status: transportStatus,
                source: "relay",
                payload: {
                    role: context.role,
                    metadata: parsed.data.metadata || null,
                },
            });
        } catch (error: any) {
            if (error instanceof ViewingSessionTransportTransitionError) {
                return NextResponse.json(
                    {
                        success: false,
                        error: error.message,
                        previousStatus: error.previousStatus,
                        requestedStatus: error.requestedStatus,
                    },
                    { status: 409 }
                );
            }
            throw error;
        }
        return NextResponse.json({ success: true, transportStatus });
    }

    if (parsed.data.eventType === "disconnect") {
        try {
            await setViewingSessionTransportStatus({
                sessionId: context.sessionId,
                status: VIEWING_SESSION_TRANSPORT_STATUSES.disconnected,
                source: "relay",
                payload: {
                    role: context.role,
                    reason: parsed.data.reason || null,
                    metadata: parsed.data.metadata || null,
                },
            });
        } catch (error: any) {
            if (error instanceof ViewingSessionTransportTransitionError) {
                return NextResponse.json(
                    {
                        success: false,
                        error: error.message,
                        previousStatus: error.previousStatus,
                        requestedStatus: error.requestedStatus,
                    },
                    { status: 409 }
                );
            }
            throw error;
        }
        return NextResponse.json({ success: true, transportStatus: "disconnected" });
    }

    if (parsed.data.eventType === "usage") {
        const usage = await recordViewingSessionUsage({
            sessionId: context.sessionId,
            locationId: context.locationId,
            phase: parsed.data.phase,
            provider: parsed.data.provider || null,
            model: parsed.data.model || null,
            transportStatus: parsed.data.transportStatus || null,
            usageAuthority: "provider_reported",
            costAuthority: "estimated",
            inputAudioSeconds: parsed.data.inputAudioSeconds || 0,
            outputAudioSeconds: parsed.data.outputAudioSeconds || 0,
            inputTokens: parsed.data.inputTokens || 0,
            outputTokens: parsed.data.outputTokens || 0,
            totalTokens: parsed.data.totalTokens || 0,
            toolCalls: parsed.data.toolCalls || 0,
            estimatedCostUsd: parsed.data.estimatedCostUsd || 0,
            actualCostUsd: parsed.data.actualCostUsd || parsed.data.estimatedCostUsd || 0,
            metadata: parsed.data.metadata || null,
        });
        return NextResponse.json({
            success: true,
            usageId: usage?.id || null,
        });
    }

    if (parsed.data.eventType === "tool_result") {
        const toolName = String(
            (parsed.data.metadata as any)?.toolName ||
            (parsed.data.metadata as any)?.tool?.name ||
            ""
        ).trim();
        if (!isViewingLiveToolAllowed(toolName)) {
            await appendViewingSessionEvent({
                sessionId: context.sessionId,
                locationId: context.locationId,
                type: "viewing_session.relay.tool.blocked",
                source: "relay",
                actorRole: context.role,
                payload: {
                    toolName: toolName || null,
                    reason: "tool_not_allowed_in_read_only_live_mode",
                },
            });
            return NextResponse.json({
                success: true,
                dropped: true,
                reason: "tool_not_allowed_in_read_only_live_mode",
            });
        }
    }

    const relayMessage = await createRelayMessage({
        sessionId: context.sessionId,
        locationId: context.locationId,
        role: context.role,
        speaker: parsed.data.eventType === "transcript" ? parsed.data.speaker : VIEWING_SESSION_SPEAKERS.system,
        sourceMessageId: parsed.data.sourceMessageId || null,
        messageKind: parsed.data.eventType === "tool_result" ? VIEWING_SESSION_MESSAGE_KINDS.toolResult : VIEWING_SESSION_MESSAGE_KINDS.utterance,
        text: parsed.data.text,
        originalLanguage: parsed.data.eventType === "transcript" ? parsed.data.originalLanguage || null : null,
        translatedText: parsed.data.eventType === "transcript" ? parsed.data.translatedText || null : null,
        targetLanguage: parsed.data.eventType === "transcript" ? parsed.data.targetLanguage || null : null,
        timestamp: parsed.data.eventType === "transcript" && parsed.data.timestamp ? new Date(parsed.data.timestamp) : new Date(),
        supersedesMessageId: parsed.data.eventType === "transcript" ? parsed.data.supersedesMessageId || null : null,
        origin: parsed.data.eventType === "transcript"
            ? (parsed.data.origin || VIEWING_SESSION_MESSAGE_ORIGINS.relayLiveTranscript)
            : VIEWING_SESSION_MESSAGE_ORIGINS.relayToolResult,
        provider: parsed.data.provider || null,
        model: parsed.data.model || null,
        modelVersion: parsed.data.modelVersion || null,
        transcriptStatus: parsed.data.eventType === "transcript"
            ? (parsed.data.transcriptStatus || VIEWING_SESSION_TRANSCRIPT_STATUSES.final)
            : VIEWING_SESSION_TRANSCRIPT_STATUSES.final,
        metadata: parsed.data.metadata || null,
    }).catch((error: any) => {
        return {
            error: String(error?.message || "Failed to persist relay message."),
        };
    });

    if ((relayMessage as any)?.error) {
        return NextResponse.json(
            {
                success: false,
                error: (relayMessage as any).error,
            },
            { status: 400 }
        );
    }

    const message = (relayMessage as any).message;
    if (
        message &&
        message.messageKind === VIEWING_SESSION_MESSAGE_KINDS.utterance &&
        (
            message.translationStatus !== VIEWING_SESSION_TRANSLATION_STATUSES.completed ||
            message.insightStatus !== VIEWING_SESSION_INSIGHT_PIPELINE_STATUSES.completed
        )
    ) {
        try {
            await initViewingSessionAnalysisWorker();
        } catch (error) {
            console.warn("[viewing-session-relay] Failed to init translation worker:", error);
        }
        await enqueueViewingSessionAnalysis({
            sessionId: context.sessionId,
            messageId: message.id,
            priority: message.speaker === VIEWING_SESSION_SPEAKERS.client ? "high" : "normal",
            allowInlineFallback: true,
        });
    }

    try {
        await initViewingSessionSynthesisWorker();
    } catch (error) {
        console.warn("[viewing-session-relay] Failed to init synthesis worker:", error);
    }
    await enqueueViewingSessionSynthesis({
        sessionId: context.sessionId,
        status: "draft",
        trigger: "debounced_worker",
        allowInlineFallback: true,
    });

    return NextResponse.json({
        success: true,
        idempotent: !!(relayMessage as any).idempotent,
        message: message ? {
            id: message.id,
            sessionId: context.sessionId,
            sequence: message.sequence,
            utteranceId: message.utteranceId,
            sourceMessageId: message.sourceMessageId,
            messageKind: message.messageKind,
            origin: message.origin,
            provider: message.provider,
            model: message.model,
            modelVersion: message.modelVersion,
            transcriptStatus: message.transcriptStatus,
            persistedAt: message.persistedAt?.toISOString?.() || null,
            supersedesMessageId: message.supersedesMessageId,
            speaker: message.speaker,
            originalText: message.originalText,
            translatedText: message.translatedText,
            translationStatus: message.translationStatus,
            insightStatus: message.insightStatus,
            analysisStatus: message.analysisStatus,
            timestamp: message.timestamp?.toISOString?.() || null,
        } : null,
    });
}
