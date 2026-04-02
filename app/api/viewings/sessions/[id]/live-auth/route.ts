import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import db from "@/lib/db";
import { buildViewingLiveAuthPayload, validateGeminiLiveCredentialsForLocation } from "@/lib/viewings/sessions/gemini-live";
import { resolveLiveModelForMode } from "@/lib/viewings/sessions/live-models";
import { ensureViewingSessionWithinLiveWindow, VIEWING_SESSION_LIVE_LIMIT_MINUTES } from "@/lib/viewings/sessions/runtime";
import { generateViewingSessionAccessToken } from "@/lib/viewings/sessions/security";
import { resolveViewingSessionRequestContext } from "@/lib/viewings/sessions/auth";
import {
    DEFAULT_VIEWING_SESSION_ACCESS_TOKEN_TTL_SECONDS,
    VIEWING_SESSION_MODES,
    VIEWING_SESSION_STATUSES,
    type ViewingSessionMode,
} from "@/lib/viewings/sessions/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const liveAuthSchema = z.object({
    mode: z.enum([VIEWING_SESSION_MODES.assistantLiveToolHeavy, VIEWING_SESSION_MODES.assistantLiveVoicePremium]).optional(),
    audioPlaybackClientEnabled: z.boolean().optional(),
    audioPlaybackAgentEnabled: z.boolean().optional(),
});

function normalizeMode(mode: string | null | undefined): ViewingSessionMode {
    if (mode === VIEWING_SESSION_MODES.assistantLiveVoicePremium) {
        return VIEWING_SESSION_MODES.assistantLiveVoicePremium;
    }
    return VIEWING_SESSION_MODES.assistantLiveToolHeavy;
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

    const parsed = liveAuthSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
        return NextResponse.json(
            { success: false, error: "Invalid payload.", details: parsed.error.flatten().fieldErrors },
            { status: 400 }
        );
    }

    let session = await db.viewingSession.findUnique({
        where: { id: context.sessionId },
        select: {
            id: true,
            locationId: true,
            mode: true,
            status: true,
            startedAt: true,
            audioPlaybackClientEnabled: true,
            audioPlaybackAgentEnabled: true,
            liveModel: true,
            chainIndex: true,
        },
    });
    if (!session) {
        return NextResponse.json({ success: false, error: "Session not found." }, { status: 404 });
    }

    const chained = await ensureViewingSessionWithinLiveWindow(session.id);
    if (chained.sessionId !== session.id) {
        session = await db.viewingSession.findUnique({
            where: { id: chained.sessionId },
            select: {
                id: true,
                locationId: true,
                mode: true,
                status: true,
                startedAt: true,
                audioPlaybackClientEnabled: true,
                audioPlaybackAgentEnabled: true,
                liveModel: true,
                chainIndex: true,
            },
        });
        if (!session) {
            return NextResponse.json({ success: false, error: "Failed to resolve chained session." }, { status: 500 });
        }
    }

    if (session.status === VIEWING_SESSION_STATUSES.completed || session.status === VIEWING_SESSION_STATUSES.expired) {
        return NextResponse.json({ success: false, error: "Session is not active." }, { status: 409 });
    }

    const desiredMode = normalizeMode(parsed.data.mode || session.mode);
    const nextAudioPlaybackClientEnabled = typeof parsed.data.audioPlaybackClientEnabled === "boolean"
        ? parsed.data.audioPlaybackClientEnabled
        : session.audioPlaybackClientEnabled;
    const nextAudioPlaybackAgentEnabled = typeof parsed.data.audioPlaybackAgentEnabled === "boolean"
        ? parsed.data.audioPlaybackAgentEnabled
        : session.audioPlaybackAgentEnabled;

    const canUpdateAgentPlayback = context.role === "admin" || context.role === "agent";
    const sessionUpdate = await db.viewingSession.update({
        where: { id: session.id },
        data: {
            mode: desiredMode,
            liveModel: resolveLiveModelForMode(desiredMode),
            audioPlaybackClientEnabled: nextAudioPlaybackClientEnabled,
            audioPlaybackAgentEnabled: canUpdateAgentPlayback
                ? nextAudioPlaybackAgentEnabled
                : session.audioPlaybackAgentEnabled,
        },
        select: {
            id: true,
            locationId: true,
            mode: true,
            status: true,
            startedAt: true,
            liveModel: true,
            audioPlaybackClientEnabled: true,
            audioPlaybackAgentEnabled: true,
            chainIndex: true,
        },
    });

    const credentialHealth = await validateGeminiLiveCredentialsForLocation(sessionUpdate.locationId);
    if (!credentialHealth.ok) {
        return NextResponse.json(
            { success: false, error: credentialHealth.error || "Live credentials unavailable." },
            { status: 503 }
        );
    }

    const liveConfig = await buildViewingLiveAuthPayload({
        locationId: sessionUpdate.locationId,
        mode: normalizeMode(sessionUpdate.mode),
    });

    const relayRole = context.role === "client" ? "client" : "agent";
    const ttlSeconds = 15 * 60;
    const relaySessionToken = generateViewingSessionAccessToken({
        sessionId: sessionUpdate.id,
        locationId: sessionUpdate.locationId,
        role: relayRole,
        ttlSeconds,
    });
    const sessionAccessToken = generateViewingSessionAccessToken({
        sessionId: sessionUpdate.id,
        locationId: sessionUpdate.locationId,
        role: relayRole,
        ttlSeconds: DEFAULT_VIEWING_SESSION_ACCESS_TOKEN_TTL_SECONDS,
    });

    return NextResponse.json({
        success: true,
        session: {
            id: sessionUpdate.id,
            status: sessionUpdate.status,
            mode: sessionUpdate.mode,
            model: sessionUpdate.liveModel,
            chainIndex: sessionUpdate.chainIndex,
            startedAt: sessionUpdate.startedAt ? sessionUpdate.startedAt.toISOString() : null,
            audioPlaybackClientEnabled: sessionUpdate.audioPlaybackClientEnabled,
            audioPlaybackAgentEnabled: sessionUpdate.audioPlaybackAgentEnabled,
        },
        chaining: {
            wasChained: chained.chained,
            previousSessionId: chained.previousSessionId,
            activeSessionId: sessionUpdate.id,
            maxAudioWindowMinutes: VIEWING_SESSION_LIVE_LIMIT_MINUTES,
        },
        sessionAccessToken,
        sessionAccessTokenExpiresInSeconds: DEFAULT_VIEWING_SESSION_ACCESS_TOKEN_TTL_SECONDS,
        liveAuth: {
            ...liveConfig,
            relay: {
                ...liveConfig.relay,
                relaySessionToken,
                relaySessionTokenExpiresInSeconds: ttlSeconds,
            },
        },
    });
}
