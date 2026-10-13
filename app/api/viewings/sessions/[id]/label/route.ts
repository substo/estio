import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import db from "@/lib/db";
import { resolveViewingSessionRequestContext } from "@/lib/viewings/sessions/auth";

export const runtime = "nodejs";

const schema = z.object({ label: z.string().trim().max(80).nullable() });

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const context = await resolveViewingSessionRequestContext({
        request,
        sessionId: id,
        requireAdmin: true,
        allowClientToken: false,
        allowAgentToken: false,
    });
    if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid label" }, { status: 400 });
    const label = parsed.data.label?.trim() || null;
    const updated = await db.viewingSession.updateMany({
        where: { id, locationId: context.locationId, deletedAt: null },
        data: { label },
    });
    if (!updated.count) return NextResponse.json({ error: "Session not found" }, { status: 404 });
    return NextResponse.json({ success: true, label });
}
