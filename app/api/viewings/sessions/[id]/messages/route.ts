import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import db from "@/lib/db";
import { initViewingSessionAnalysisWorker, enqueueViewingSessionAnalysis } from "@/lib/queue/viewing-session-analysis";
import { enqueueViewingSessionSynthesis, initViewingSessionSynthesisWorker } from "@/lib/queue/viewing-session-synthesis";
import { publishViewingSessionRealtimeEvent } from "@/lib/realtime/viewing-session-events";
import { appendViewingSessionEvent } from "@/lib/viewings/sessions/events";
import { generateViewingSessionAccessToken } from "@/lib/viewings/sessions/security";
import { resolveViewingSessionRequestContext } from "@/lib/viewings/sessions/auth";
import {
    deriveViewingSessionAnalysisStatus,
    DEFAULT_VIEWING_SESSION_ACCESS_TOKEN_TTL_SECONDS,
    VIEWING_SESSION_EVENT_TYPES,
    VIEWING_SESSION_INSIGHT_PIPELINE_STATUSES,
    VIEWING_SESSION_MESSAGE_KINDS,
    VIEWING_SESSION_MESSAGE_ORIGINS,
    VIEWING_SESSION_SPEAKERS,
    VIEWING_SESSION_STATUSES,
    VIEWING_SESSION_TRANSCRIPT_STATUSES,
    VIEWING_SESSION_TRANSLATION_STATUSES,
} from "@/lib/viewings/sessions/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const messageSchema = z.object({
    speaker: z.enum([VIEWING_SESSION_SPEAKERS.client, VIEWING_SESSION_SPEAKERS.agent, VIEWING_SESSION_SPEAKERS.system]).optional(),
    originalText: z.string().trim().min(1).max(20_000),
    originalLanguage: z.string().trim().max(24).optional(),
    translatedText: z.string().trim().max(20_000).optional(),
    targetLanguage: z.string().trim().max(24).optional(),
    confidence: z.number().min(0).max(1).optional(),
    audioChunkRef: z.string().trim().max(1_000).optional(),
    timestamp: z.string().datetime().optional(),
    sourceMessageId: z.string().trim().min(1).max(140).optional(),
    messageKind: z.enum([
        VIEWING_SESSION_MESSAGE_KINDS.utterance,
        VIEWING_SESSION_MESSAGE_KINDS.systemNote,
        VIEWING_SESSION_MESSAGE_KINDS.toolResult,
    ]).optional(),
    supersedesMessageId: z.string().trim().min(1).max(120).optional(),
    origin: z.enum([
        VIEWING_SESSION_MESSAGE_ORIGINS.manualText,
        VIEWING_SESSION_MESSAGE_ORIGINS.browserStt,
        VIEWING_SESSION_MESSAGE_ORIGINS.human,
        VIEWING_SESSION_MESSAGE_ORIGINS.system,
    ]).optional(),
    provider: z.string().trim().max(120).optional(),
    model: z.string().trim().max(120).optional(),
    modelVersion: z.string().trim().max(120).optional(),
    transcriptStatus: z.enum([
        VIEWING_SESSION_TRANSCRIPT_STATUSES.provisional,
        VIEWING_SESSION_TRANSCRIPT_STATUSES.final,
    ]).optional(),
});

function resolveSpeakerByContext(role: "client" | "agent" | "admin", requested?: string) {
    if (role === "client") return VIEWING_SESSION_SPEAKERS.client;
    if (role === "agent") return VIEWING_SESSION_SPEAKERS.agent;
    if (requested === VIEWING_SESSION_SPEAKERS.client || requested === VIEWING_SESSION_SPEAKERS.system) {
        return requested;
    }
    return VIEWING_SESSION_SPEAKERS.agent;
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

    const parsed = messageSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json(
            { success: false, error: "Invalid payload.", details: parsed.error.flatten().fieldErrors },
            { status: 400 }
        );
    }

    const session = await db.viewingSession.findUnique({
        where: { id: context.sessionId },
        include: {
            nextSessions: {
                where: {
                    status: {
                        in: [VIEWING_SESSION_STATUSES.active, VIEWING_SESSION_STATUSES.paused, VIEWING_SESSION_STATUSES.scheduled],
                    },
                },
                orderBy: [{ chainIndex: "desc" }, { createdAt: "desc" }],
                take: 1,
            },
        },
    });
    if (!session) {
        return NextResponse.json({ success: false, error: "Session not found." }, { status: 404 });
    }

    let writableSession = session;
    if (
        (session.status === VIEWING_SESSION_STATUSES.completed || session.status === VIEWING_SESSION_STATUSES.expired) &&
        session.nextSessions[0]
    ) {
        writableSession = session.nextSessions[0] as any;
    }

    if (
        writableSession.status === VIEWING_SESSION_STATUSES.completed ||
        writableSession.status === VIEWING_SESSION_STATUSES.expired
    ) {
        return NextResponse.json({ success: false, error: "Session is not writable." }, { status: 409 });
    }

    const data = parsed.data;
    const speaker = resolveSpeakerByContext(context.role, data.speaker);
    const timestamp = data.timestamp ? new Date(data.timestamp) : new Date();
    const messageKind = data.messageKind || VIEWING_SESSION_MESSAGE_KINDS.utterance;
    const sourceMessageId = String(data.sourceMessageId || "").trim() || null;
    const supersedesMessageId = String(data.supersedesMessageId || "").trim() || null;
    const origin = data.origin || VIEWING_SESSION_MESSAGE_ORIGINS.manualText;
    const provider = String(data.provider || "").trim() || null;
    const model = String(data.model || "").trim() || null;
    const modelVersion = String(data.modelVersion || "").trim() || null;
    const transcriptStatus = data.transcriptStatus || VIEWING_SESSION_TRANSCRIPT_STATUSES.final;

    let writeResult: {
        message: any;
        idempotent: boolean;
        created: boolean;
    };
    try {
        writeResult = await db.$transaction(async (tx) => {
            if (sourceMessageId) {
                const existing = await tx.viewingSessionMessage.findFirst({
                    where: {
                        sessionId: writableSession.id,
                        sourceMessageId,
                    },
                });
                if (existing) {
                    return {
                        message: existing,
                        idempotent: true,
                        created: false,
                    };
                }
            }

            if (supersedesMessageId) {
                const supersedes = await tx.viewingSessionMessage.findFirst({
                    where: {
                        id: supersedesMessageId,
                        sessionId: writableSession.id,
                    },
                    select: { id: true, utteranceId: true },
                });
                if (!supersedes) {
                    throw new Error("Superseded message not found in this session.");
                }

                // Lock the session row to ensure sequence assignment is serialized per session.
                await tx.viewingSession.update({
                    where: { id: writableSession.id },
                    data: { updatedAt: new Date() },
                    select: { id: true },
                });

                const latest = await tx.viewingSessionMessage.findFirst({
                    where: { sessionId: writableSession.id },
                    orderBy: [{ sequence: "desc" }],
                    select: { sequence: true },
                });
                const nextSequence = Number(latest?.sequence || 0) + 1;
                const persistedAt = new Date();
                const translationStatus = data.translatedText
                    ? VIEWING_SESSION_TRANSLATION_STATUSES.completed
                    : VIEWING_SESSION_TRANSLATION_STATUSES.pending;
                const insightStatus = VIEWING_SESSION_INSIGHT_PIPELINE_STATUSES.pending;
                const analysisStatus = deriveViewingSessionAnalysisStatus({
                    translationStatus,
                    insightStatus,
                });
                const nextId = randomUUID();

                const created = await tx.viewingSessionMessage.create({
                    data: {
                        id: nextId,
                        sessionId: writableSession.id,
                        sequence: nextSequence,
                        utteranceId: supersedes.utteranceId,
                        sourceMessageId,
                        messageKind,
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
                        originalText: data.originalText,
                        originalLanguage: data.originalLanguage || null,
                        translatedText: data.translatedText || null,
                        targetLanguage: data.targetLanguage || null,
                        timestamp,
                        confidence: typeof data.confidence === "number" ? data.confidence : null,
                        audioChunkRef: data.audioChunkRef || null,
                        analysisStatus,
                    },
                });

                return {
                    message: created,
                    idempotent: false,
                    created: true,
                };
            }

            // Lock the session row to ensure sequence assignment is serialized per session.
            await tx.viewingSession.update({
                where: { id: writableSession.id },
                data: { updatedAt: new Date() },
                select: { id: true },
            });

            const latest = await tx.viewingSessionMessage.findFirst({
                where: { sessionId: writableSession.id },
                orderBy: [{ sequence: "desc" }],
                select: { sequence: true },
            });
            const nextSequence = Number(latest?.sequence || 0) + 1;
            const persistedAt = new Date();
            const translationStatus = data.translatedText
                ? VIEWING_SESSION_TRANSLATION_STATUSES.completed
                : VIEWING_SESSION_TRANSLATION_STATUSES.pending;
            const insightStatus = VIEWING_SESSION_INSIGHT_PIPELINE_STATUSES.pending;
            const analysisStatus = deriveViewingSessionAnalysisStatus({
                translationStatus,
                insightStatus,
            });
            const nextId = randomUUID();

            const created = await tx.viewingSessionMessage.create({
                data: {
                    id: nextId,
                    sessionId: writableSession.id,
                    sequence: nextSequence,
                    utteranceId: nextId,
                    sourceMessageId,
                    messageKind,
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
                    originalText: data.originalText,
                    originalLanguage: data.originalLanguage || null,
                    translatedText: data.translatedText || null,
                    targetLanguage: data.targetLanguage || null,
                    timestamp,
                    confidence: typeof data.confidence === "number" ? data.confidence : null,
                    audioChunkRef: data.audioChunkRef || null,
                    analysisStatus,
                },
            });

            return {
                message: created,
                idempotent: false,
                created: true,
            };
        });
    } catch (error: any) {
        return NextResponse.json(
            {
                success: false,
                error: String(error?.message || "Failed to persist message."),
            },
            { status: 400 }
        );
    }
    const created = writeResult.message;

    if (writeResult.created) {
        await publishViewingSessionRealtimeEvent({
            sessionId: writableSession.id,
            locationId: writableSession.locationId,
            type: VIEWING_SESSION_EVENT_TYPES.messageCreated,
            payload: {
                message: {
                    id: created.id,
                    sessionId: writableSession.id,
                    sequence: created.sequence,
                    utteranceId: created.utteranceId,
                    sourceMessageId: created.sourceMessageId,
                    messageKind: created.messageKind,
                    origin: created.origin,
                    provider: created.provider,
                    model: created.model,
                    modelVersion: created.modelVersion,
                    transcriptStatus: created.transcriptStatus,
                    persistedAt: created.persistedAt.toISOString(),
                    supersedesMessageId: created.supersedesMessageId,
                    speaker: created.speaker,
                    originalText: created.originalText,
                    originalLanguage: created.originalLanguage,
                    translatedText: created.translatedText,
                    targetLanguage: created.targetLanguage,
                    confidence: created.confidence,
                    audioChunkRef: created.audioChunkRef,
                    translationStatus: created.translationStatus,
                    insightStatus: created.insightStatus,
                    analysisStatus: created.analysisStatus,
                    timestamp: created.timestamp.toISOString(),
                    createdAt: created.createdAt.toISOString(),
                },
            },
        });
        await appendViewingSessionEvent({
            sessionId: writableSession.id,
            locationId: writableSession.locationId,
            type: "viewing_session.message.created",
            actorRole: context.role,
            actorUserId: context.clerkUserId,
            source: "api",
            payload: {
                messageId: created.id,
                sequence: created.sequence,
                messageKind: created.messageKind,
                sourceMessageId: created.sourceMessageId,
                supersedesMessageId: created.supersedesMessageId,
                origin: created.origin,
                },
        });
    } else {
        await appendViewingSessionEvent({
            sessionId: writableSession.id,
            locationId: writableSession.locationId,
            type: "viewing_session.message.idempotent_hit",
            actorRole: context.role,
            actorUserId: context.clerkUserId,
            source: "api",
            payload: {
                messageId: created.id,
                sourceMessageId: created.sourceMessageId,
            },
        });
    }

    let analysisQueueResult: unknown = null;
    if (
        created.translationStatus !== VIEWING_SESSION_TRANSLATION_STATUSES.completed ||
        created.insightStatus !== VIEWING_SESSION_INSIGHT_PIPELINE_STATUSES.completed
    ) {
        try {
            await initViewingSessionAnalysisWorker();
        } catch (error) {
            console.warn("[viewing-session] Failed to init analysis worker, continuing with enqueue fallback:", error);
        }
        analysisQueueResult = await enqueueViewingSessionAnalysis({
            sessionId: writableSession.id,
            messageId: created.id,
            priority: speaker === VIEWING_SESSION_SPEAKERS.client ? "high" : "normal",
            allowInlineFallback: true,
        });
    }
    let synthesisQueueResult: unknown = null;
    try {
        await initViewingSessionSynthesisWorker();
    } catch (error) {
        console.warn("[viewing-session] Failed to init synthesis worker, continuing with enqueue fallback:", error);
    }
    synthesisQueueResult = await enqueueViewingSessionSynthesis({
        sessionId: writableSession.id,
        status: "draft",
        trigger: "debounced_worker",
        allowInlineFallback: true,
    });

    const roleForToken = context.role === "client" ? "client" : "agent";
    const sessionAccessToken = writableSession.id === session.id
        ? null
        : generateViewingSessionAccessToken({
            sessionId: writableSession.id,
            locationId: writableSession.locationId,
            role: roleForToken,
            ttlSeconds: DEFAULT_VIEWING_SESSION_ACCESS_TOKEN_TTL_SECONDS,
        });

    return NextResponse.json({
        success: true,
        sessionId: writableSession.id,
        redirectedFromSessionId: writableSession.id === session.id ? null : session.id,
        sessionAccessToken,
        sessionAccessTokenExpiresInSeconds: sessionAccessToken ? DEFAULT_VIEWING_SESSION_ACCESS_TOKEN_TTL_SECONDS : null,
        message: {
            id: created.id,
            sessionId: writableSession.id,
            sequence: created.sequence,
            utteranceId: created.utteranceId,
            sourceMessageId: created.sourceMessageId,
            messageKind: created.messageKind,
            origin: created.origin,
            provider: created.provider,
            model: created.model,
            modelVersion: created.modelVersion,
            transcriptStatus: created.transcriptStatus,
            persistedAt: created.persistedAt.toISOString(),
            supersedesMessageId: created.supersedesMessageId,
            speaker: created.speaker,
            originalText: created.originalText,
            originalLanguage: created.originalLanguage,
            translatedText: created.translatedText,
            targetLanguage: created.targetLanguage,
            confidence: created.confidence,
            translationStatus: created.translationStatus,
            insightStatus: created.insightStatus,
            analysisStatus: created.analysisStatus,
            timestamp: created.timestamp.toISOString(),
            createdAt: created.createdAt.toISOString(),
        },
        idempotent: writeResult.idempotent,
        analysisQueue: analysisQueueResult,
        synthesisQueue: synthesisQueueResult,
    });
}
