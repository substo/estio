import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { verifyUserHasAccessToLocation } from "@/lib/auth/permissions";
import { getLocationContext } from "@/lib/auth/location-context";
import db from "@/lib/db";
import { buildViewingLiveAuthPayload } from "@/lib/viewings/sessions/gemini-live";
import { createQuickStartViewingSession, getQuickAssistUiModeConfig } from "@/lib/viewings/sessions/session-service";
import {
    VIEWING_SESSION_KINDS,
    VIEWING_SESSION_MODES,
    VIEWING_SESSION_PARTICIPANT_MODES,
    VIEWING_SESSION_QUICK_START_SOURCES,
    VIEWING_SESSION_SPEECH_MODES,
} from "@/lib/viewings/sessions/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
    locationId: z.string().trim().optional(),
    mode: z.enum([VIEWING_SESSION_MODES.assistantLiveToolHeavy, VIEWING_SESSION_MODES.assistantLiveVoicePremium]).optional(),
    sessionKind: z.enum([
        VIEWING_SESSION_KINDS.structuredViewing,
        VIEWING_SESSION_KINDS.quickTranslate,
        VIEWING_SESSION_KINDS.listenOnly,
        VIEWING_SESSION_KINDS.twoWayInterpreter,
    ]).optional(),
    participantMode: z.enum([
        VIEWING_SESSION_PARTICIPANT_MODES.agentOnly,
        VIEWING_SESSION_PARTICIPANT_MODES.sharedClient,
    ]).optional(),
    speechMode: z.enum([
        VIEWING_SESSION_SPEECH_MODES.pushToTalk,
        VIEWING_SESSION_SPEECH_MODES.continuous,
        VIEWING_SESSION_SPEECH_MODES.listenOnly,
    ]).optional(),
    quickStartSource: z.enum([
        VIEWING_SESSION_QUICK_START_SOURCES.global,
        VIEWING_SESSION_QUICK_START_SOURCES.property,
        VIEWING_SESSION_QUICK_START_SOURCES.contact,
        VIEWING_SESSION_QUICK_START_SOURCES.viewing,
    ]).optional(),
    entryPoint: z.string().trim().max(120).optional(),
    contactId: z.string().trim().optional(),
    primaryPropertyId: z.string().trim().optional(),
    viewingId: z.string().trim().optional(),
    relatedPropertyIds: z.array(z.string().trim().min(1)).max(12).optional(),
    clientLanguage: z.string().trim().max(24).optional(),
    agentLanguage: z.string().trim().max(24).optional(),
    clientName: z.string().trim().max(120).optional(),
    notes: z.string().trim().max(8_000).optional(),
});

function asString(value: unknown): string {
    return String(value || "").trim();
}

export async function POST(req: NextRequest) {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json(
            { success: false, error: "Invalid payload.", details: parsed.error.flatten().fieldErrors },
            { status: 400 }
        );
    }

    const locationContext = await getLocationContext();
    const locationId = asString(parsed.data.locationId) || asString(locationContext?.id);
    if (!locationId) {
        return NextResponse.json({ success: false, error: "No location context available." }, { status: 400 });
    }

    const hasAccess = await verifyUserHasAccessToLocation(clerkUserId, locationId);
    if (!hasAccess) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 403 });
    }

    const actor = await db.user.findUnique({
        where: { clerkId: clerkUserId },
        select: { id: true },
    });
    if (!actor?.id) {
        return NextResponse.json({ success: false, error: "Agent account not found." }, { status: 404 });
    }

    try {
        const result = await createQuickStartViewingSession({
            locationId,
            agentId: actor.id,
            actorUserId: actor.id,
            mode: parsed.data.mode,
            sessionKind: parsed.data.sessionKind,
            participantMode: parsed.data.participantMode,
            speechMode: parsed.data.speechMode,
            quickStartSource: parsed.data.quickStartSource,
            entryPoint: parsed.data.entryPoint,
            contactId: parsed.data.contactId,
            primaryPropertyId: parsed.data.primaryPropertyId,
            viewingId: parsed.data.viewingId,
            relatedPropertyIds: parsed.data.relatedPropertyIds,
            clientLanguage: parsed.data.clientLanguage,
            agentLanguage: parsed.data.agentLanguage,
            clientName: parsed.data.clientName,
            notes: parsed.data.notes,
        });

        const location = await db.location.findUnique({
            where: { id: locationId },
            select: {
                domain: true,
                siteConfig: { select: { domain: true } },
            },
        });
        const domain = asString(location?.siteConfig?.domain) || asString(location?.domain) || null;
        const liveBootstrap = await buildViewingLiveAuthPayload({
            locationId,
            mode: (result.session.mode || VIEWING_SESSION_MODES.assistantLiveToolHeavy) as any,
        }).catch(() => null);

        return NextResponse.json({
            success: true,
            sessionId: result.session.id,
            sessionThreadId: result.session.sessionThreadId,
            status: result.session.status,
            join: result.join ? {
                ...result.join,
                url: domain ? `https://${domain}/viewings/session/${result.join.token}` : null,
                domain,
            } : null,
            modelRouting: result.modelRouting,
            contextSnapshot: result.contextSnapshot,
            uiModeConfig: getQuickAssistUiModeConfig({
                sessionKind: result.session.sessionKind,
                participantMode: result.session.participantMode,
            }),
            liveBootstrap,
        });
    } catch (error: any) {
        return NextResponse.json(
            { success: false, error: String(error?.message || "Failed to quick-start session.") },
            { status: 400 }
        );
    }
}
