import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import db from "@/lib/db";
import { publishViewingSessionRealtimeEvent } from "@/lib/realtime/viewing-session-events";
import { resolveViewingSessionRequestContext } from "@/lib/viewings/sessions/auth";
import { VIEWING_SESSION_EVENT_TYPES, VIEWING_SESSION_INSIGHT_STATES } from "@/lib/viewings/sessions/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const stateSchema = z.object({
    action: z.enum(["pin", "dismiss", "resolve", "activate"]).optional(),
    state: z.enum([
        VIEWING_SESSION_INSIGHT_STATES.active,
        VIEWING_SESSION_INSIGHT_STATES.pinned,
        VIEWING_SESSION_INSIGHT_STATES.dismissed,
        VIEWING_SESSION_INSIGHT_STATES.resolved,
    ]).optional(),
});

function resolveInsightState(input: z.infer<typeof stateSchema>) {
    if (input.state) return input.state;
    if (input.action === "pin") return VIEWING_SESSION_INSIGHT_STATES.pinned;
    if (input.action === "dismiss") return VIEWING_SESSION_INSIGHT_STATES.dismissed;
    if (input.action === "resolve") return VIEWING_SESSION_INSIGHT_STATES.resolved;
    return VIEWING_SESSION_INSIGHT_STATES.active;
}

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string; insightId: string }> }
) {
    const { id, insightId } = await params;
    const sessionId = String(id || "").trim();
    const normalizedInsightId = String(insightId || "").trim();
    if (!sessionId || !normalizedInsightId) {
        return NextResponse.json({ success: false, error: "Missing sessionId or insightId." }, { status: 400 });
    }

    const tokenOverride = String(req.nextUrl.searchParams.get("accessToken") || "").trim() || null;
    const context = await resolveViewingSessionRequestContext({
        request: req,
        sessionId,
        allowClientToken: false,
        allowAgentToken: true,
        tokenOverride,
    });
    if (!context) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
    if (context.role === "client") {
        return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }

    const parsed = stateSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
        return NextResponse.json(
            { success: false, error: "Invalid payload.", details: parsed.error.flatten().fieldErrors },
            { status: 400 }
        );
    }

    const insight = await db.viewingSessionInsight.findFirst({
        where: {
            id: normalizedInsightId,
            sessionId: context.sessionId,
        },
        select: {
            id: true,
            sessionId: true,
            type: true,
            category: true,
            shortText: true,
            longText: true,
            state: true,
            source: true,
            confidence: true,
            metadata: true,
            createdAt: true,
            updatedAt: true,
            session: {
                select: {
                    locationId: true,
                },
            },
        },
    });
    if (!insight) {
        return NextResponse.json({ success: false, error: "Insight not found." }, { status: 404 });
    }

    const nextState = resolveInsightState(parsed.data);
    const now = new Date();
    const updated = await db.viewingSessionInsight.update({
        where: { id: insight.id },
        data: {
            state: nextState,
            pinnedAt: nextState === VIEWING_SESSION_INSIGHT_STATES.pinned ? now : null,
            dismissedAt: nextState === VIEWING_SESSION_INSIGHT_STATES.dismissed ? now : null,
            resolvedAt: nextState === VIEWING_SESSION_INSIGHT_STATES.resolved ? now : null,
        },
    });

    await publishViewingSessionRealtimeEvent({
        sessionId: updated.sessionId,
        locationId: insight.session.locationId,
        type: VIEWING_SESSION_EVENT_TYPES.insightUpserted,
        payload: {
            insights: [
                {
                    id: updated.id,
                    sessionId: updated.sessionId,
                    type: updated.type,
                    category: updated.category,
                    shortText: updated.shortText,
                    longText: updated.longText,
                    state: updated.state,
                    source: updated.source,
                    confidence: updated.confidence,
                    metadata: updated.metadata || null,
                    createdAt: updated.createdAt.toISOString(),
                    updatedAt: updated.updatedAt.toISOString(),
                },
            ],
            count: 1,
        },
    });

    return NextResponse.json({
        success: true,
        insight: {
            id: updated.id,
            state: updated.state,
            pinnedAt: updated.pinnedAt ? updated.pinnedAt.toISOString() : null,
            dismissedAt: updated.dismissedAt ? updated.dismissedAt.toISOString() : null,
            resolvedAt: updated.resolvedAt ? updated.resolvedAt.toISOString() : null,
            updatedAt: updated.updatedAt.toISOString(),
        },
    });
}
