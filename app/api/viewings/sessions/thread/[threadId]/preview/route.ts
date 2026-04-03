import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { verifyUserHasAccessToLocation } from "@/lib/auth/permissions";
import db from "@/lib/db";
import { getViewingSessionThreadPreview } from "@/lib/viewings/sessions/session-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
    _req: NextRequest,
    { params }: { params: Promise<{ threadId: string }> }
) {
    const { threadId } = await params;
    const sessionThreadId = String(threadId || "").trim();
    if (!sessionThreadId) {
        return NextResponse.json({ success: false, error: "Missing session thread id." }, { status: 400 });
    }

    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const rootSession = await db.viewingSession.findFirst({
        where: { sessionThreadId },
        select: { locationId: true },
    });
    if (!rootSession?.locationId) {
        return NextResponse.json({ success: false, error: "Viewing session thread not found." }, { status: 404 });
    }

    const hasAccess = await verifyUserHasAccessToLocation(clerkUserId, rootSession.locationId);
    if (!hasAccess) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 403 });
    }

    const preview = await getViewingSessionThreadPreview({
        sessionThreadId,
        locationId: rootSession.locationId,
    });
    if (!preview) {
        return NextResponse.json({ success: false, error: "Viewing session preview not found." }, { status: 404 });
    }

    return NextResponse.json({ success: true, preview });
}
