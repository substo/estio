import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import db from "@/lib/db";
import { resolveViewingSessionRequestContext } from "@/lib/viewings/sessions/auth";
import { attachViewingSessionContext, closeViewingSession } from "@/lib/viewings/sessions/session-service";
import { VIEWING_SESSION_SAVE_POLICIES } from "@/lib/viewings/sessions/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
    savePolicy: z.enum([
        VIEWING_SESSION_SAVE_POLICIES.discardOnClose,
        VIEWING_SESSION_SAVE_POLICIES.saveTranscript,
        VIEWING_SESSION_SAVE_POLICIES.saveSummaryOnly,
        VIEWING_SESSION_SAVE_POLICIES.fullSession,
    ]).optional(),
    attachToContactId: z.string().trim().optional(),
    attachToPropertyId: z.string().trim().optional(),
    viewingId: z.string().trim().optional(),
    notes: z.string().trim().max(8_000).optional(),
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

        if (
            parsed.data.attachToContactId
            || parsed.data.attachToPropertyId
            || parsed.data.viewingId
            || parsed.data.notes !== undefined
        ) {
            await attachViewingSessionContext({
                sessionId,
                actorUserId: actor?.id || null,
                contactId: parsed.data.attachToContactId,
                primaryPropertyId: parsed.data.attachToPropertyId,
                viewingId: parsed.data.viewingId,
                notes: parsed.data.notes,
            });
        }

        const result = await closeViewingSession({
            sessionId,
            actorUserId: actor?.id || null,
            savePolicy: parsed.data.savePolicy,
        });

        return NextResponse.json({ success: true, ...result });
    } catch (error: any) {
        return NextResponse.json(
            { success: false, error: String(error?.message || "Failed to close viewing session.") },
            { status: 400 }
        );
    }
}
