import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import db from "@/lib/db";
import { getLocationContext } from "@/lib/auth/location-context";
import {
    createScheduledMessage,
    listScheduledMessagesForConversation,
} from "@/lib/conversations/scheduled-messages";

async function getActorUserId() {
    const { userId } = await auth();
    if (!userId) return null;
    const user = await db.user.findUnique({
        where: { clerkId: userId },
        select: { id: true },
    });
    return user?.id || null;
}

export async function GET(request: Request) {
    const location = await getLocationContext();
    if (!location?.id) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const conversationId = String(url.searchParams.get("conversationId") || "").trim();
    if (!conversationId) {
        return NextResponse.json({ success: false, error: "Missing conversationId." }, { status: 400 });
    }

    const items = await listScheduledMessagesForConversation({
        locationId: location.id,
        conversationId,
        includeTerminal: url.searchParams.get("includeTerminal") === "true",
        limit: Number(url.searchParams.get("limit") || 30),
    });

    return NextResponse.json({ success: true, items });
}

export async function POST(request: Request) {
    const location = await getLocationContext();
    if (!location?.id) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const result = await createScheduledMessage({
        locationId: location.id,
        conversationId: body?.conversationId,
        contactId: body?.contactId,
        channel: body?.channel,
        body: body?.body,
        scheduledFor: body?.scheduledFor,
        scheduledTimeZone: body?.scheduledTimeZone,
        scheduledLocal: body?.scheduledLocal,
        source: body?.source || "composer",
        metadata: body?.metadata || null,
        actorUserId: await getActorUserId(),
    });

    return NextResponse.json(result, { status: result.success ? 200 : 400 });
}
