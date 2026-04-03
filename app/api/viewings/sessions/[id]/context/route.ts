import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import db from "@/lib/db";
import { attachViewingSessionContext } from "@/lib/viewings/sessions/session-service";
import { resolveViewingSessionRequestContext } from "@/lib/viewings/sessions/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
    contactId: z.string().trim().optional(),
    primaryPropertyId: z.string().trim().optional(),
    relatedPropertyIds: z.array(z.string().trim().min(1)).max(12).optional(),
    viewingId: z.string().trim().optional(),
    notes: z.string().trim().max(8_000).optional(),
});

export async function PATCH(
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

        const result = await attachViewingSessionContext({
            sessionId,
            actorUserId: actor?.id || null,
            contactId: parsed.data.contactId,
            primaryPropertyId: parsed.data.primaryPropertyId,
            relatedPropertyIds: parsed.data.relatedPropertyIds,
            viewingId: parsed.data.viewingId,
            notes: parsed.data.notes,
        });

        return NextResponse.json({
            success: true,
            session: result.session,
            contextSnapshot: result.contextSnapshot,
        });
    } catch (error: any) {
        return NextResponse.json(
            { success: false, error: String(error?.message || "Failed to attach session context.") },
            { status: 400 }
        );
    }
}
