import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getLocationContext } from "@/lib/auth/location-context";
import { verifyUserHasAccessToLocation } from "@/lib/auth/permissions";
import { moveViewingSessionToTrash, restoreViewingSession } from "@/lib/viewings/sessions/trash";

export const runtime = "nodejs";

async function resolveLocation() {
    const { userId } = await auth();
    const locationId = String((await getLocationContext())?.id || "").trim();
    if (!userId || !locationId || !await verifyUserHasAccessToLocation(userId, locationId)) return null;
    return locationId;
}

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const locationId = await resolveLocation();
    if (!locationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const result = await moveViewingSessionToTrash({ id: (await params).id, locationId });
    if (result === "not_found") return NextResponse.json({ error: "Session not found" }, { status: 404 });
    if (result === "active") return NextResponse.json({ error: "End the live session before moving it to Trash." }, { status: 409 });
    return NextResponse.json({ success: true, result });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const locationId = await resolveLocation();
    if (!locationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const result = await restoreViewingSession({ id: (await params).id, locationId });
    if (result === "not_found") return NextResponse.json({ error: "Session not found" }, { status: 404 });
    if (result === "expired") return NextResponse.json({ error: "This session's recovery window has ended." }, { status: 409 });
    return NextResponse.json({ success: true, result });
}
