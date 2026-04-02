import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import db from "@/lib/db";
import { initViewingSessionAnalysisWorker, enqueueViewingSessionAnalysis } from "@/lib/queue/viewing-session-analysis";
import { publishViewingSessionRealtimeEvent } from "@/lib/realtime/viewing-session-events";
import { generateViewingSessionAccessToken } from "@/lib/viewings/sessions/security";
import { resolveViewingSessionRequestContext } from "@/lib/viewings/sessions/auth";
import {
    DEFAULT_VIEWING_SESSION_ACCESS_TOKEN_TTL_SECONDS,
    VIEWING_SESSION_ANALYSIS_STATUSES,
    VIEWING_SESSION_EVENT_TYPES,
    VIEWING_SESSION_SPEAKERS,
    VIEWING_SESSION_STATUSES,
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

    const created = await db.viewingSessionMessage.create({
        data: {
            sessionId: writableSession.id,
            speaker,
            originalText: data.originalText,
            originalLanguage: data.originalLanguage || null,
            translatedText: data.translatedText || null,
            targetLanguage: data.targetLanguage || null,
            timestamp,
            confidence: typeof data.confidence === "number" ? data.confidence : null,
            audioChunkRef: data.audioChunkRef || null,
            analysisStatus: data.translatedText
                ? VIEWING_SESSION_ANALYSIS_STATUSES.completed
                : VIEWING_SESSION_ANALYSIS_STATUSES.pending,
        },
    });

    await publishViewingSessionRealtimeEvent({
        sessionId: writableSession.id,
        locationId: writableSession.locationId,
        type: VIEWING_SESSION_EVENT_TYPES.messageCreated,
        payload: {
            message: {
                id: created.id,
                sessionId: writableSession.id,
                speaker: created.speaker,
                originalText: created.originalText,
                originalLanguage: created.originalLanguage,
                translatedText: created.translatedText,
                targetLanguage: created.targetLanguage,
                confidence: created.confidence,
                audioChunkRef: created.audioChunkRef,
                analysisStatus: created.analysisStatus,
                timestamp: created.timestamp.toISOString(),
                createdAt: created.createdAt.toISOString(),
            },
        },
    });

    let analysisQueueResult: unknown = null;
    if (!created.translatedText || created.analysisStatus !== VIEWING_SESSION_ANALYSIS_STATUSES.completed) {
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
            speaker: created.speaker,
            originalText: created.originalText,
            originalLanguage: created.originalLanguage,
            translatedText: created.translatedText,
            targetLanguage: created.targetLanguage,
            confidence: created.confidence,
            analysisStatus: created.analysisStatus,
            timestamp: created.timestamp.toISOString(),
            createdAt: created.createdAt.toISOString(),
        },
        analysisQueue: analysisQueueResult,
    });
}
