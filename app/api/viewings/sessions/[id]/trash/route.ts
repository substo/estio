import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getLocationContext } from "@/lib/auth/location-context";
import { verifyUserHasAccessToLocation } from "@/lib/auth/permissions";
import { moveViewingSessionToTrash, restoreViewingSession } from "@/lib/viewings/sessions/trash";
import { publishViewingSessionRealtimeEvent } from "@/lib/realtime/viewing-session-events";
import { appendViewingSessionEvent } from "@/lib/viewings/sessions/events";
import { VIEWING_SESSION_EVENT_TYPES } from "@/lib/viewings/sessions/types";

export const runtime = "nodejs";

async function resolveLocation() {
    const { userId } = await auth();
    const locationId = String((await getLocationContext())?.id || "").trim();
    if (!userId || !locationId || !await verifyUserHasAccessToLocation(userId, locationId)) return null;
    return { locationId, userId };
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const context = await resolveLocation();
    if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const id = (await params).id;
    const endOpen = (await request.json().catch(() => null))?.endOpen === true;
    const now = new Date();
    const result = await moveViewingSessionToTrash({ id, locationId: context.locationId, now, endOpen });
    if (result === "not_found") return NextResponse.json({ error: "Session not found" }, { status: 404 });
    if (result === "active") return NextResponse.json({ error: "End the session before moving it to Trash." }, { status: 409 });
    if (result === "ended_and_deleted") {
        await publishViewingSessionRealtimeEvent({
            sessionId: id,
            locationId: context.locationId,
            type: VIEWING_SESSION_EVENT_TYPES.statusChanged,
            payload: { sessionId: id, status: "completed", endedAt: now.toISOString(), transportStatus: "disconnected" },
        }).catch((error) => console.warn("[viewing-session-trash] Failed to publish end event:", error));
        await appendViewingSessionEvent({
            sessionId: id,
            locationId: context.locationId,
            type: "viewing_session.ended_and_trashed",
            actorRole: "admin",
            actorUserId: context.userId,
            source: "api",
            payload: { endedAt: now.toISOString() },
        });
    }
    return NextResponse.json({ success: true, result });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const context = await resolveLocation();
    if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const result = await restoreViewingSession({ id: (await params).id, locationId: context.locationId });
    if (result === "not_found") return NextResponse.json({ error: "Session not found" }, { status: 404 });
    if (result === "expired") return NextResponse.json({ error: "This session's recovery window has ended." }, { status: 409 });
    return NextResponse.json({ success: true, result });
}
