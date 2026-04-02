'use server';

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { verifyUserHasAccessToLocation } from "@/lib/auth/permissions";
import db from "@/lib/db";
import { runViewingSessionSynthesis } from "@/lib/queue/viewing-session-synthesis";
import { publishViewingSessionRealtimeEvent } from "@/lib/realtime/viewing-session-events";
import { appendViewingSessionEvent } from "@/lib/viewings/sessions/events";
import { isViewingSessionVoicePremiumEnabled } from "@/lib/viewings/sessions/feature-flags";
import { resolveLiveModelForMode } from "@/lib/viewings/sessions/live-models";
import { generateViewingSessionJoinSecrets } from "@/lib/viewings/sessions/security";
import {
    VIEWING_SESSION_EVENT_TYPES,
    VIEWING_SESSION_MODES,
    VIEWING_SESSION_STATUSES,
    type ViewingSessionMode,
} from "@/lib/viewings/sessions/types";

const createViewingSessionSchema = z.object({
    mode: z.enum([VIEWING_SESSION_MODES.assistantLiveToolHeavy, VIEWING_SESSION_MODES.assistantLiveVoicePremium]).optional(),
    clientName: z.string().trim().max(120).optional(),
    clientLanguage: z.string().trim().max(24).optional(),
    agentLanguage: z.string().trim().max(24).optional(),
    relatedPropertyIds: z.array(z.string().trim().min(1)).max(12).optional(),
    notes: z.string().trim().max(8_000).optional(),
    expiresInHours: z.number().int().min(1).max(72).optional(),
});

function asString(value: unknown): string {
    return String(value || "").trim();
}

function sanitizeMode(mode: string | undefined): ViewingSessionMode {
    if (mode === VIEWING_SESSION_MODES.assistantLiveVoicePremium) {
        return VIEWING_SESSION_MODES.assistantLiveVoicePremium;
    }
    return VIEWING_SESSION_MODES.assistantLiveToolHeavy;
}

function normalizeJoinUrl(input: { domain: string | null; token: string }) {
    const token = asString(input.token);
    if (!token) return null;

    const domain = asString(input.domain);
    if (!domain) return null;
    return `https://${domain}/viewings/session/${token}`;
}

async function requireAccessToViewing(viewingId: string) {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
        return { ok: false as const, error: "Unauthorized" };
    }

    const viewing = await db.viewing.findUnique({
        where: { id: viewingId },
        include: {
            contact: {
                select: {
                    id: true,
                    name: true,
                    firstName: true,
                    preferredLang: true,
                    locationId: true,
                    location: {
                        select: {
                            id: true,
                            domain: true,
                            name: true,
                        },
                    },
                },
            },
            property: {
                select: {
                    id: true,
                    title: true,
                },
            },
            user: {
                select: {
                    id: true,
                    name: true,
                },
            },
        },
    });

    if (!viewing) {
        return { ok: false as const, error: "Viewing not found" };
    }

    const hasAccess = await verifyUserHasAccessToLocation(clerkUserId, viewing.contact.locationId);
    if (!hasAccess) {
        return { ok: false as const, error: "Unauthorized" };
    }

    return {
        ok: true as const,
        viewing,
        clerkUserId,
    };
}

async function requireAccessToSession(sessionId: string) {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) return { ok: false as const, error: "Unauthorized" };

    const session = await db.viewingSession.findUnique({
        where: { id: sessionId },
        select: {
            id: true,
            locationId: true,
            contactId: true,
            status: true,
        },
    });
    if (!session) return { ok: false as const, error: "Session not found" };

    const hasAccess = await verifyUserHasAccessToLocation(clerkUserId, session.locationId);
    if (!hasAccess) return { ok: false as const, error: "Unauthorized" };

    const dbUser = await db.user.findUnique({
        where: { clerkId: clerkUserId },
        select: { id: true },
    });

    return {
        ok: true as const,
        session,
        clerkUserId,
        actorUserId: dbUser?.id || null,
    };
}

export async function createViewingSession(
    viewingId: string,
    input?: z.input<typeof createViewingSessionSchema>
) {
    const normalizedViewingId = asString(viewingId);
    if (!normalizedViewingId) {
        return { success: false, message: "Missing viewingId." };
    }

    const access = await requireAccessToViewing(normalizedViewingId);
    if (!access.ok) return { success: false, message: access.error };

    const parsed = createViewingSessionSchema.safeParse(input || {});
    if (!parsed.success) {
        return {
            success: false,
            message: "Invalid viewing session payload.",
            errors: parsed.error.flatten().fieldErrors,
        };
    }

    const data = parsed.data;
    const mode = sanitizeMode(data.mode);
    const secrets = generateViewingSessionJoinSecrets({
        expiresInHours: data.expiresInHours,
    });

    const siteConfig = await db.siteConfig.findUnique({
        where: { locationId: access.viewing.contact.locationId },
        select: {
            domain: true,
            viewingSessionRetentionDays: true,
            viewingSessionTranscriptVisibility: true,
            viewingSessionAiDisclosureRequired: true,
        },
    });
    const resolvedDomain = asString(siteConfig?.domain) || asString(access.viewing.contact.location?.domain) || null;
    const voicePremiumEnabled = isViewingSessionVoicePremiumEnabled(access.viewing.contact.locationId);
    if (mode === VIEWING_SESSION_MODES.assistantLiveVoicePremium && !voicePremiumEnabled) {
        return {
            success: false,
            message: "Premium voice mode is not enabled for this location.",
        };
    }

    const clientName = asString(data.clientName) || asString(access.viewing.contact.name) || asString(access.viewing.contact.firstName) || null;
    const clientLanguage = asString(data.clientLanguage) || asString(access.viewing.contact.preferredLang) || "en";
    const agentLanguage = asString(data.agentLanguage) || "en";
    const appliedRetentionDays = Math.min(365, Math.max(30, Number(siteConfig?.viewingSessionRetentionDays || 90)));
    const transcriptVisibility = asString(siteConfig?.viewingSessionTranscriptVisibility) || "team";
    const consentStatus = siteConfig?.viewingSessionAiDisclosureRequired === false ? "not_required" : "required";
    const relatedPropertyIds = Array.isArray(data.relatedPropertyIds)
        ? Array.from(new Set(data.relatedPropertyIds.map(asString).filter((id) => id && id !== access.viewing.propertyId))).slice(0, 12)
        : [];

    const session = await db.viewingSession.create({
        data: {
            locationId: access.viewing.contact.locationId,
            viewingId: access.viewing.id,
            contactId: access.viewing.contact.id,
            primaryPropertyId: access.viewing.property.id,
            currentActivePropertyId: access.viewing.property.id,
            relatedPropertyIds,
            agentId: access.viewing.user.id,
            clientName,
            clientLanguage,
            agentLanguage,
            mode,
            status: VIEWING_SESSION_STATUSES.scheduled,
            transportStatus: "disconnected",
            liveProvider: "google_gemini_live",
            consentStatus,
            appliedRetentionDays,
            transcriptVisibility,
            sessionLinkTokenHash: secrets.tokenHash,
            pinCodeHash: secrets.pinCodeHash,
            pinCodeSalt: secrets.pinCodeSalt,
            tokenExpiresAt: secrets.expiresAt,
            notes: asString(data.notes) || null,
            liveModel: resolveLiveModelForMode(mode),
        },
        select: {
            id: true,
            locationId: true,
            mode: true,
            status: true,
            tokenExpiresAt: true,
            createdAt: true,
        },
    });

    await publishViewingSessionRealtimeEvent({
        sessionId: session.id,
        locationId: session.locationId,
        type: VIEWING_SESSION_EVENT_TYPES.statusChanged,
        payload: {
            sessionId: session.id,
            status: session.status,
            mode: session.mode,
            createdAt: session.createdAt.toISOString(),
        },
    });
    await appendViewingSessionEvent({
        sessionId: session.id,
        locationId: session.locationId,
        type: "viewing_session.created",
        actorRole: "admin",
        actorUserId: access.clerkUserId,
        source: "api",
        payload: {
            viewingId: access.viewing.id,
            mode: session.mode,
            consentStatus,
            appliedRetentionDays,
            transcriptVisibility,
            voicePremiumEnabled,
        },
    });

    revalidatePath("/admin/contacts");
    revalidatePath(`/admin/viewings/sessions/${session.id}`);

    return {
        success: true,
        message: "Viewing session created.",
        sessionId: session.id,
        mode: session.mode,
        status: session.status,
        join: {
            token: secrets.token,
            pinCode: secrets.pinCode,
            url: normalizeJoinUrl({ domain: resolvedDomain, token: secrets.token }),
            expiresAt: session.tokenExpiresAt.toISOString(),
            domain: resolvedDomain,
        },
    };
}

export async function startViewingSession(sessionId: string) {
    const normalizedSessionId = asString(sessionId);
    if (!normalizedSessionId) return { success: false, message: "Missing sessionId." };

    const access = await requireAccessToSession(normalizedSessionId);
    if (!access.ok) return { success: false, message: access.error };

    const now = new Date();
    const updated = await db.viewingSession.update({
        where: { id: access.session.id },
        data: {
            status: VIEWING_SESSION_STATUSES.active,
            startedAt: access.session.status === VIEWING_SESSION_STATUSES.active ? undefined : now,
        },
        select: {
            id: true,
            locationId: true,
            status: true,
            startedAt: true,
        },
    });

    await publishViewingSessionRealtimeEvent({
        sessionId: updated.id,
        locationId: updated.locationId,
        type: VIEWING_SESSION_EVENT_TYPES.statusChanged,
        payload: {
            sessionId: updated.id,
            status: updated.status,
            startedAt: updated.startedAt ? updated.startedAt.toISOString() : null,
        },
    });
    await appendViewingSessionEvent({
        sessionId: updated.id,
        locationId: updated.locationId,
        type: "viewing_session.started",
        actorRole: "admin",
        actorUserId: access.clerkUserId,
        source: "api",
        payload: {
            startedAt: updated.startedAt ? updated.startedAt.toISOString() : null,
        },
    });

    revalidatePath(`/admin/viewings/sessions/${updated.id}`);
    return { success: true, status: updated.status };
}

export async function pauseViewingSession(sessionId: string) {
    const normalizedSessionId = asString(sessionId);
    if (!normalizedSessionId) return { success: false, message: "Missing sessionId." };

    const access = await requireAccessToSession(normalizedSessionId);
    if (!access.ok) return { success: false, message: access.error };

    const updated = await db.viewingSession.update({
        where: { id: access.session.id },
        data: { status: VIEWING_SESSION_STATUSES.paused },
        select: {
            id: true,
            locationId: true,
            status: true,
        },
    });

    await publishViewingSessionRealtimeEvent({
        sessionId: updated.id,
        locationId: updated.locationId,
        type: VIEWING_SESSION_EVENT_TYPES.statusChanged,
        payload: {
            sessionId: updated.id,
            status: updated.status,
        },
    });
    await appendViewingSessionEvent({
        sessionId: updated.id,
        locationId: updated.locationId,
        type: "viewing_session.paused",
        actorRole: "admin",
        actorUserId: access.clerkUserId,
        source: "api",
    });

    revalidatePath(`/admin/viewings/sessions/${updated.id}`);
    return { success: true, status: updated.status };
}

export async function completeViewingSession(sessionId: string) {
    const normalizedSessionId = asString(sessionId);
    if (!normalizedSessionId) return { success: false, message: "Missing sessionId." };

    const access = await requireAccessToSession(normalizedSessionId);
    if (!access.ok) return { success: false, message: access.error };

    const now = new Date();
    const updated = await db.viewingSession.update({
        where: { id: access.session.id },
        data: {
            status: VIEWING_SESSION_STATUSES.completed,
            endedAt: now,
        },
        select: {
            id: true,
            locationId: true,
            status: true,
            endedAt: true,
        },
    });

    const summary = await runViewingSessionSynthesis({
        sessionId: updated.id,
        actorUserId: access.actorUserId,
        status: "final",
        trigger: "completion",
    });

    await publishViewingSessionRealtimeEvent({
        sessionId: updated.id,
        locationId: updated.locationId,
        type: VIEWING_SESSION_EVENT_TYPES.statusChanged,
        payload: {
            sessionId: updated.id,
            status: updated.status,
            endedAt: updated.endedAt ? updated.endedAt.toISOString() : null,
            summaryId: summary.id,
        },
    });
    await appendViewingSessionEvent({
        sessionId: updated.id,
        locationId: updated.locationId,
        type: "viewing_session.completed",
        actorRole: "admin",
        actorUserId: access.clerkUserId,
        source: "api",
        payload: {
            endedAt: updated.endedAt ? updated.endedAt.toISOString() : null,
            summaryId: summary.id,
        },
    });

    revalidatePath("/admin/contacts");
    revalidatePath(`/admin/viewings/sessions/${updated.id}`);

    return {
        success: true,
        status: updated.status,
        summaryId: summary.id,
    };
}
