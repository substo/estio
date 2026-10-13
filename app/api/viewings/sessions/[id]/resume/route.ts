import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { resolveViewingSessionRequestContext } from "@/lib/viewings/sessions/auth";
import { resumeQuickViewingSession } from "@/lib/viewings/sessions/resume";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const context = await resolveViewingSessionRequestContext({
        request,
        sessionId: id,
        requireAdmin: true,
        allowClientToken: false,
        allowAgentToken: false,
    });
    if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const result = await resumeQuickViewingSession({
        sessionId: id,
        locationId: context.locationId,
        actorUserId: context.clerkUserId,
    });
    if (result.kind === "not_found") return NextResponse.json({ error: "Session not found" }, { status: 404 });
    if (result.kind === "unsupported") return NextResponse.json({ error: "This session cannot be continued here." }, { status: 409 });
    if (result.kind === "conflict") return NextResponse.json({ error: "Session changed. Try again." }, { status: 409 });
    if ((result.kind === "resumed" || result.kind === "active") && result.join) {
        const location = await db.location.findUnique({
            where: { id: context.locationId },
            select: { domain: true, siteConfig: { select: { domain: true } } },
        });
        const domain = location?.siteConfig?.domain || location?.domain || null;
        return NextResponse.json({
            success: true,
            ...result,
            join: { ...result.join, url: domain ? `https://${domain}/live-assist/join/${result.join.token}` : null },
        });
    }
    return NextResponse.json({ success: true, ...result });
}
