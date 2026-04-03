import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import db from "@/lib/db";
import { resolveViewingSessionRequestContext } from "@/lib/viewings/sessions/auth";
import { convertViewingSession } from "@/lib/viewings/sessions/session-service";
import {
    VIEWING_SESSION_KINDS,
    VIEWING_SESSION_PARTICIPANT_MODES,
    VIEWING_SESSION_SPEECH_MODES,
} from "@/lib/viewings/sessions/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
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
});

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const sessionId = String(id || "").trim();
    if (!sessionId) {
        return NextResponse.json({ success: false, error: "Missing session id." }, { status: 400 });
    }

    const context = await resolveViewingSessionRequestContext({
        request: req,
        sessionId,
        requireAdmin: true,
        allowClientToken: false,
        allowAgentToken: false,
    });
    if (!context) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json(
            { success: false, error: "Invalid payload.", details: parsed.error.flatten().fieldErrors },
            { status: 400 }
        );
    }

    try {
        const actor = context.clerkUserId
            ? await db.user.findUnique({
                where: { clerkId: context.clerkUserId },
                select: { id: true },
            })
            : null;

        const result = await convertViewingSession({
            sessionId,
            actorUserId: actor?.id || null,
            sessionKind: parsed.data.sessionKind,
            participantMode: parsed.data.participantMode,
            speechMode: parsed.data.speechMode,
        });
        let join: ({
            token: string;
            pinCode: string;
            expiresAt: string;
            url?: string | null;
            domain?: string | null;
        } | null) = result.join;
        if (join) {
            const location = await db.location.findUnique({
                where: { id: context.locationId },
                select: {
                    domain: true,
                    siteConfig: { select: { domain: true } },
                },
            });
            const domain = String(location?.siteConfig?.domain || location?.domain || "").trim() || null;
            join = {
                ...join,
                url: domain ? `https://${domain}/viewings/session/${join.token}` : null,
                domain,
            };
        }
        return NextResponse.json({ success: true, ...result, join });
    } catch (error: any) {
        return NextResponse.json(
            { success: false, error: String(error?.message || "Failed to convert viewing session.") },
            { status: 400 }
        );
    }
}
