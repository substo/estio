import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import db from "@/lib/db";
import { appendViewingSessionEvent } from "@/lib/viewings/sessions/events";
import { isViewingSessionVoicePremiumEnabled } from "@/lib/viewings/sessions/feature-flags";
import {
    buildViewingLiveAuthPayload,
    relayWebsocketUrlTargetsLoopback,
    validateGeminiLiveCredentialsForLocation,
    validateViewingLiveRelayAvailability,
} from "@/lib/viewings/sessions/gemini-live";
import { resolveLiveModelForMode } from "@/lib/viewings/sessions/live-models";
import {
    ensureViewingSessionWithinLiveWindow,
    setViewingSessionTransportStatus,
    ViewingSessionTransportTransitionError,
    VIEWING_SESSION_LIVE_LIMIT_MINUTES,
} from "@/lib/viewings/sessions/runtime";
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

function isClientConsentMissing(consentStatus: string | null | undefined): boolean {
    const normalized = String(consentStatus || "").trim().toLowerCase();
    return normalized === "required" || normalized === "declined";
}

function asString(value: unknown): string {
    return String(value || "").trim();
}

function resolveRequestOrigin(req: NextRequest): string | null {
    const forwardedHost = asString(req.headers.get("x-forwarded-host")).split(",")[0]?.trim();
    const host = forwardedHost || asString(req.headers.get("host")) || asString(req.nextUrl.host);
    if (!host) return null;

    const forwardedProto = asString(req.headers.get("x-forwarded-proto")).split(",")[0]?.trim().toLowerCase();
    const protocol = forwardedProto || asString(req.nextUrl.protocol).replace(/:$/, "") || "https";
    return `${protocol}://${host}`;
}

function isLocalRequestOrigin(origin: string | null): boolean {
    if (!origin) return false;
    try {
        const parsed = new URL(origin);
        const host = asString(parsed.hostname).toLowerCase();
        return host === "127.0.0.1" || host === "localhost" || host === "::1";
    } catch {
        return false;
    }
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
            sessionThreadId: true,
            sessionKind: true,
            participantMode: true,
            speechMode: true,
            savePolicy: true,
            mode: true,
            status: true,
            consentStatus: true,
            consentAcceptedAt: true,
            consentVersion: true,
            consentLocale: true,
            consentSource: true,
            startedAt: true,
            clientLanguage: true,
            audioPlaybackClientEnabled: true,
            audioPlaybackAgentEnabled: true,
            liveModel: true,
            translationModel: true,
            insightsModel: true,
            summaryModel: true,
            transportStatus: true,
            liveProvider: true,
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
                sessionThreadId: true,
                sessionKind: true,
                participantMode: true,
                speechMode: true,
                savePolicy: true,
                mode: true,
                status: true,
                consentStatus: true,
                consentAcceptedAt: true,
                consentVersion: true,
                consentLocale: true,
                consentSource: true,
                startedAt: true,
                clientLanguage: true,
                audioPlaybackClientEnabled: true,
                audioPlaybackAgentEnabled: true,
                liveModel: true,
                translationModel: true,
                insightsModel: true,
                summaryModel: true,
                transportStatus: true,
                liveProvider: true,
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
    if (context.role === "client" && isClientConsentMissing(session.consentStatus)) {
        return NextResponse.json(
            {
                success: false,
                error: "AI disclosure must be accepted before live mode can be activated.",
                code: "AI_DISCLOSURE_REQUIRED",
                consentStatus: session.consentStatus,
            },
            { status: 403 }
        );
    }

    const desiredMode = normalizeMode(parsed.data.mode || session.mode);
    const voicePremiumEnabled = isViewingSessionVoicePremiumEnabled(session.locationId);
    if (desiredMode === VIEWING_SESSION_MODES.assistantLiveVoicePremium && !voicePremiumEnabled) {
        return NextResponse.json(
            {
                success: false,
                error: "Premium voice mode is not enabled for this location.",
                voicePremiumEnabled,
            },
            { status: 403 }
        );
    }
    const nextAudioPlaybackClientEnabled = typeof parsed.data.audioPlaybackClientEnabled === "boolean"
        ? parsed.data.audioPlaybackClientEnabled
        : session.audioPlaybackClientEnabled;
    const nextAudioPlaybackAgentEnabled = typeof parsed.data.audioPlaybackAgentEnabled === "boolean"
        ? parsed.data.audioPlaybackAgentEnabled
        : session.audioPlaybackAgentEnabled;

    const canUpdateAgentPlayback = context.role === "admin" || context.role === "agent";
    let sessionUpdate = await db.viewingSession.update({
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
            sessionThreadId: true,
            sessionKind: true,
            participantMode: true,
            speechMode: true,
            savePolicy: true,
            mode: true,
            status: true,
            consentStatus: true,
            consentAcceptedAt: true,
            consentVersion: true,
            consentLocale: true,
            consentSource: true,
            startedAt: true,
            clientLanguage: true,
            liveModel: true,
            translationModel: true,
            insightsModel: true,
            summaryModel: true,
            transportStatus: true,
            liveProvider: true,
            audioPlaybackClientEnabled: true,
            audioPlaybackAgentEnabled: true,
            chainIndex: true,
        },
    });

    if (
        context.role === "client"
        && sessionUpdate.consentStatus === "accepted"
        && (
            !sessionUpdate.consentAcceptedAt
            || !sessionUpdate.consentVersion
            || !sessionUpdate.consentLocale
            || !sessionUpdate.consentSource
        )
    ) {
        const siteConfig = await db.siteConfig.findUnique({
            where: { locationId: sessionUpdate.locationId },
            select: { viewingSessionAiDisclosureVersion: true },
        });
        const acceptLanguage = String(req.headers.get("accept-language") || "").split(",")[0]?.trim() || null;
        sessionUpdate = await db.viewingSession.update({
            where: { id: sessionUpdate.id },
            data: {
                consentAcceptedAt: sessionUpdate.consentAcceptedAt || new Date(),
                consentVersion: sessionUpdate.consentVersion || String(siteConfig?.viewingSessionAiDisclosureVersion || "").trim() || "v1",
                consentLocale: sessionUpdate.consentLocale || sessionUpdate.clientLanguage || acceptLanguage,
                consentSource: sessionUpdate.consentSource || "live_auth",
            },
            select: {
                id: true,
                locationId: true,
                sessionThreadId: true,
                sessionKind: true,
                participantMode: true,
                speechMode: true,
                savePolicy: true,
                mode: true,
                status: true,
                consentStatus: true,
                consentAcceptedAt: true,
                consentVersion: true,
                consentLocale: true,
                consentSource: true,
                startedAt: true,
                clientLanguage: true,
                liveModel: true,
                translationModel: true,
                insightsModel: true,
                summaryModel: true,
                transportStatus: true,
                liveProvider: true,
                audioPlaybackClientEnabled: true,
                audioPlaybackAgentEnabled: true,
                chainIndex: true,
            },
        });
    }

    const credentialHealth = await validateGeminiLiveCredentialsForLocation(sessionUpdate.locationId);
    if (!credentialHealth.ok) {
        return NextResponse.json(
            { success: false, error: credentialHealth.error || "Live credentials unavailable." },
            { status: 503 }
        );
    }

    const requestOrigin = resolveRequestOrigin(req);
    const relayHealth = await validateViewingLiveRelayAvailability({
        requestOrigin,
    });
    if (!relayHealth.ok) {
        await appendViewingSessionEvent({
            sessionId: sessionUpdate.id,
            locationId: sessionUpdate.locationId,
            type: "viewing_session.live_auth.relay_unavailable",
            actorRole: context.role,
            actorUserId: context.clerkUserId,
            source: "api",
            payload: {
                reason: relayHealth.error || "relay_unavailable",
                requestOrigin: requestOrigin || null,
                relay: relayHealth.relay,
            },
        });
        return NextResponse.json(
            {
                success: false,
                error: relayHealth.error || "Live relay is unavailable.",
                code: "LIVE_RELAY_UNAVAILABLE",
                relay: relayHealth.relay,
            },
            { status: 503 }
        );
    }
    if (
        !isLocalRequestOrigin(requestOrigin)
        && relayWebsocketUrlTargetsLoopback(relayHealth.relay.websocketUrl)
    ) {
        await appendViewingSessionEvent({
            sessionId: sessionUpdate.id,
            locationId: sessionUpdate.locationId,
            type: "viewing_session.live_auth.relay_url_invalid",
            actorRole: context.role,
            actorUserId: context.clerkUserId,
            source: "api",
            payload: {
                requestOrigin: requestOrigin || null,
                relay: relayHealth.relay,
            },
        });
        return NextResponse.json(
            {
                success: false,
                error: "Live relay websocket URL points to a loopback host and is unreachable from browser clients.",
                code: "LIVE_RELAY_WS_URL_INVALID",
                relay: relayHealth.relay,
            },
            { status: 503 }
        );
    }

    const liveConfig = await buildViewingLiveAuthPayload({
        locationId: sessionUpdate.locationId,
        mode: normalizeMode(sessionUpdate.mode),
        requestOrigin,
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

    if (sessionUpdate.status === VIEWING_SESSION_STATUSES.active && sessionUpdate.transportStatus !== "connected") {
        try {
            await setViewingSessionTransportStatus({
                sessionId: sessionUpdate.id,
                status: "connecting",
                source: "api.live-auth",
                payload: {
                    role: context.role,
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
    }
    await appendViewingSessionEvent({
        sessionId: sessionUpdate.id,
        locationId: sessionUpdate.locationId,
        type: "viewing_session.live_auth.issued",
        actorRole: context.role,
        actorUserId: context.clerkUserId,
        source: "api",
        payload: {
            mode: sessionUpdate.mode,
            model: sessionUpdate.liveModel,
            voicePremiumEnabled,
            wasChained: chained.chained,
            sessionThreadId: sessionUpdate.sessionThreadId,
        },
    });

    const latestTransportStatus = sessionUpdate.status === VIEWING_SESSION_STATUSES.active && sessionUpdate.transportStatus !== "connected"
        ? "connecting"
        : sessionUpdate.transportStatus;
    const relayBaseWebsocketUrl = liveConfig.relay.websocketUrl.replace(/\/$/, "");
    const relayWebsocketUrl = relayBaseWebsocketUrl.includes("?")
        ? `${relayBaseWebsocketUrl}&sessionId=${encodeURIComponent(sessionUpdate.id)}`
        : `${relayBaseWebsocketUrl}?sessionId=${encodeURIComponent(sessionUpdate.id)}`;

    return NextResponse.json({
        success: true,
        session: {
            id: sessionUpdate.id,
            sessionThreadId: sessionUpdate.sessionThreadId,
            sessionKind: sessionUpdate.sessionKind,
            participantMode: sessionUpdate.participantMode,
            speechMode: sessionUpdate.speechMode,
            savePolicy: sessionUpdate.savePolicy,
            status: sessionUpdate.status,
            consentStatus: sessionUpdate.consentStatus,
            mode: sessionUpdate.mode,
            model: sessionUpdate.liveModel,
            consentAcceptedAt: sessionUpdate.consentAcceptedAt ? sessionUpdate.consentAcceptedAt.toISOString() : null,
            consentVersion: sessionUpdate.consentVersion || null,
            consentLocale: sessionUpdate.consentLocale || null,
            consentSource: sessionUpdate.consentSource || null,
            transportStatus: latestTransportStatus,
            liveProvider: sessionUpdate.liveProvider || liveConfig.provider,
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
        voicePremiumEnabled,
        modelRouting: {
            live: sessionUpdate.liveModel,
            translation: sessionUpdate.translationModel,
            insights: sessionUpdate.insightsModel,
            summary: sessionUpdate.summaryModel,
        },
        sessionAccessToken,
        sessionAccessTokenExpiresInSeconds: DEFAULT_VIEWING_SESSION_ACCESS_TOKEN_TTL_SECONDS,
        liveAuth: {
            ...liveConfig,
            relay: {
                ...liveConfig.relay,
                websocketUrl: relayWebsocketUrl,
                relaySessionToken,
                relaySessionTokenExpiresInSeconds: ttlSeconds,
                sessionThreadId: sessionUpdate.sessionThreadId,
                required: true,
                protocol: "websocket",
                connectionOwner: "backend_relay_process",
                vendorCredentialsExposed: false,
            },
        },
    });
}
