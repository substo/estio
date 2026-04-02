import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isSystemDomain } from "@/lib/app-config";
import db from "@/lib/db";
import { appendViewingSessionEvent } from "@/lib/viewings/sessions/events";
import { appendJoinAuditEntry, VIEWING_SESSION_JOIN_LOCK_MINUTES, VIEWING_SESSION_JOIN_MAX_ATTEMPTS } from "@/lib/viewings/sessions/runtime";
import {
    DEFAULT_VIEWING_SESSION_ACCESS_TOKEN_TTL_SECONDS,
    VIEWING_SESSION_STATUSES,
} from "@/lib/viewings/sessions/types";
import {
    generateViewingSessionAccessToken,
    hashViewingSessionToken,
    verifyPinCode,
} from "@/lib/viewings/sessions/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const joinSchema = z.object({
    token: z.string().trim().min(10),
    pin: z.string().trim().min(4).max(8),
    preferredLanguage: z.string().trim().max(24).optional(),
    aiDisclosureAccepted: z.boolean().optional(),
});

function normalizeHost(input: string | null): string {
    return String(input || "").trim().toLowerCase().replace(/:\d+$/, "").replace(/^www\./, "");
}

function isValidSessionStatus(status: string) {
    return status !== VIEWING_SESSION_STATUSES.completed && status !== VIEWING_SESSION_STATUSES.expired;
}

export async function POST(req: NextRequest) {
    const body = await req.json().catch(() => null);
    const parsed = joinSchema.safeParse(body || {});
    if (!parsed.success) {
        return NextResponse.json(
            { success: false, error: "Invalid request payload.", details: parsed.error.flatten().fieldErrors },
            { status: 400 }
        );
    }

    const tokenHash = hashViewingSessionToken(parsed.data.token);
    const now = new Date();

    const session = await db.viewingSession.findUnique({
        where: { sessionLinkTokenHash: tokenHash },
        include: {
            location: {
                select: {
                    id: true,
                    domain: true,
                    siteConfig: {
                        select: {
                            domain: true,
                            viewingSessionAiDisclosureRequired: true,
                        },
                    },
                },
            },
            primaryProperty: {
                select: {
                    id: true,
                    title: true,
                    reference: true,
                },
            },
            agent: {
                select: {
                    id: true,
                    name: true,
                    firstName: true,
                    lastName: true,
                },
            },
        },
    });

    if (!session) {
        return NextResponse.json({ success: false, error: "Invalid session token or PIN." }, { status: 401 });
    }

    const host = normalizeHost(req.headers.get("x-forwarded-host") || req.headers.get("host"));
    const expectedDomain = normalizeHost(session.location.siteConfig?.domain || session.location.domain || null);
    if (expectedDomain && host && !isSystemDomain(host) && host !== expectedDomain) {
        return NextResponse.json(
            { success: false, error: "Session link domain mismatch." },
            { status: 403 }
        );
    }

    if (!isValidSessionStatus(session.status)) {
        await appendViewingSessionEvent({
            sessionId: session.id,
            locationId: session.locationId,
            type: "viewing_session.join.rejected",
            actorRole: "client",
            source: "api",
            payload: {
                reason: "invalid_status",
                status: session.status,
            },
        });
        return NextResponse.json({ success: false, error: "This session is no longer available." }, { status: 410 });
    }

    if (session.tokenExpiresAt.getTime() <= now.getTime()) {
        await db.viewingSession.update({
            where: { id: session.id },
            data: {
                status: VIEWING_SESSION_STATUSES.expired,
            },
        });
        await appendViewingSessionEvent({
            sessionId: session.id,
            locationId: session.locationId,
            type: "viewing_session.join.rejected",
            actorRole: "client",
            source: "api",
            payload: {
                reason: "expired",
            },
        });
        return NextResponse.json({ success: false, error: "Session link has expired." }, { status: 410 });
    }

    if (session.joinLockUntil && session.joinLockUntil.getTime() > now.getTime()) {
        await appendViewingSessionEvent({
            sessionId: session.id,
            locationId: session.locationId,
            type: "viewing_session.join.rejected",
            actorRole: "client",
            source: "api",
            payload: {
                reason: "locked",
                lockedUntil: session.joinLockUntil.toISOString(),
            },
        });
        return NextResponse.json(
            {
                success: false,
                error: "Too many failed attempts. Please try again later.",
                lockedUntil: session.joinLockUntil.toISOString(),
            },
            { status: 429 }
        );
    }

    const pinOk = verifyPinCode(parsed.data.pin, session.pinCodeHash, session.pinCodeSalt);
    if (!pinOk) {
        const nextAttemptCount = Number(session.failedJoinAttempts || 0) + 1;
        const shouldLock = nextAttemptCount >= VIEWING_SESSION_JOIN_MAX_ATTEMPTS;
        const lockUntil = shouldLock
            ? new Date(now.getTime() + VIEWING_SESSION_JOIN_LOCK_MINUTES * 60 * 1000)
            : null;

        await db.viewingSession.update({
            where: { id: session.id },
            data: {
                failedJoinAttempts: nextAttemptCount,
                joinLockUntil: lockUntil,
                lastJoinAttemptAt: now,
                joinAudit: appendJoinAuditEntry(session.joinAudit, {
                    at: now.toISOString(),
                    success: false,
                    reason: "invalid_pin",
                    ip: req.headers.get("x-forwarded-for") || null,
                }) as any,
            },
        });
        await appendViewingSessionEvent({
            sessionId: session.id,
            locationId: session.locationId,
            type: "viewing_session.join.failed",
            actorRole: "client",
            source: "api",
            payload: {
                reason: "invalid_pin",
                failedJoinAttempts: nextAttemptCount,
                lockedUntil: lockUntil ? lockUntil.toISOString() : null,
            },
        });

        return NextResponse.json(
            {
                success: false,
                error: shouldLock
                    ? "Too many failed attempts. Session temporarily locked."
                    : "Invalid session token or PIN.",
                attemptsRemaining: shouldLock ? 0 : Math.max(0, VIEWING_SESSION_JOIN_MAX_ATTEMPTS - nextAttemptCount),
                lockedUntil: lockUntil ? lockUntil.toISOString() : null,
            },
            { status: shouldLock ? 429 : 401 }
        );
    }

    const disclosureRequired = session.location.siteConfig?.viewingSessionAiDisclosureRequired !== false;
    if (disclosureRequired && parsed.data.aiDisclosureAccepted !== true) {
        await db.viewingSession.update({
            where: { id: session.id },
            data: {
                consentStatus: "declined",
                joinAudit: appendJoinAuditEntry(session.joinAudit, {
                    at: now.toISOString(),
                    success: false,
                    reason: "ai_disclosure_not_accepted",
                    ip: req.headers.get("x-forwarded-for") || null,
                }) as any,
            },
        });
        await appendViewingSessionEvent({
            sessionId: session.id,
            locationId: session.locationId,
            type: "viewing_session.join.rejected",
            actorRole: "client",
            source: "api",
            payload: {
                reason: "ai_disclosure_not_accepted",
            },
        });
        return NextResponse.json(
            {
                success: false,
                error: "AI assistance disclosure must be accepted before joining this session.",
                code: "AI_DISCLOSURE_REQUIRED",
            },
            { status: 400 }
        );
    }

    const role = "client" as const;
    const ttlSeconds = DEFAULT_VIEWING_SESSION_ACCESS_TOKEN_TTL_SECONDS;
    const accessToken = generateViewingSessionAccessToken({
        sessionId: session.id,
        locationId: session.locationId,
        role,
        ttlSeconds,
    });

    await db.viewingSession.update({
        where: { id: session.id },
        data: {
            failedJoinAttempts: 0,
            joinLockUntil: null,
            lastJoinAttemptAt: now,
            lastJoinedAt: now,
            consentStatus: disclosureRequired ? "accepted" : "not_required",
            clientLanguage: parsed.data.preferredLanguage || session.clientLanguage || undefined,
            joinAudit: appendJoinAuditEntry(session.joinAudit, {
                at: now.toISOString(),
                success: true,
                role,
                ip: req.headers.get("x-forwarded-for") || null,
            }) as any,
        },
    });
    await appendViewingSessionEvent({
        sessionId: session.id,
        locationId: session.locationId,
        type: "viewing_session.join.succeeded",
        actorRole: "client",
        source: "api",
        payload: {
            role,
            disclosureRequired,
        },
    });

    return NextResponse.json({
        success: true,
        sessionId: session.id,
        locationId: session.locationId,
        role,
        accessToken,
        expiresInSeconds: ttlSeconds,
        expiresAt: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
        session: {
            id: session.id,
            mode: session.mode,
            status: session.status,
            transportStatus: session.transportStatus,
            liveProvider: session.liveProvider,
            clientName: session.clientName,
            clientLanguage: parsed.data.preferredLanguage || session.clientLanguage || null,
            agentLanguage: session.agentLanguage || null,
            property: {
                id: session.primaryProperty.id,
                title: session.primaryProperty.title,
                reference: session.primaryProperty.reference,
            },
            agent: {
                id: session.agent.id,
                name: session.agent.name || [session.agent.firstName, session.agent.lastName].filter(Boolean).join(" ") || "Agent",
            },
        },
    });
}
