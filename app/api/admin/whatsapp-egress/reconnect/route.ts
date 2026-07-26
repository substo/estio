import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import db from "@/lib/db";
import { getLocationContext } from "@/lib/auth/location-context";
import { verifyUserIsLocationAdmin } from "@/lib/auth/permissions";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const location = await getLocationContext();
    if (!location) return NextResponse.json({ error: "No location" }, { status: 404 });
    if (!await verifyUserIsLocationAdmin(userId, location.id)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const requestId = typeof body?.requestId === "string" && /^[a-zA-Z0-9_-]{8,100}$/.test(body.requestId)
        ? body.requestId
        : randomUUID();
    const session = await (db as any).whatsAppWebBridgeSession.findUnique({
        where: { locationId: location.id },
        select: {
            egressMode: true,
            tunnelBinding: {
                select: {
                    id: true,
                    reconnectGeneration: true,
                    lastReconnectRequestId: true,
                    lastReconnectRequestedAt: true,
                },
            },
        },
    });
    const binding = session?.tunnelBinding;
    if (session?.egressMode !== "device_tunnel" || !binding) {
        return NextResponse.json({ error: "STO Secure Delivery is not configured." }, { status: 409 });
    }

    const requestedAt = new Date();
    const changed = await (db as any).deviceTunnelBinding.updateMany({
        where: {
            id: binding.id,
            OR: [
                { lastReconnectRequestId: null },
                { lastReconnectRequestId: { not: requestId } },
            ],
        },
        data: {
            reconnectGeneration: { increment: 1 },
            lastReconnectRequestId: requestId,
            lastReconnectRequestedAt: requestedAt,
            lastReconnectAttemptedAt: null,
            lastReconnectErrorCode: null,
        },
    });
    const updated = Number(changed?.count || 0) === 1
        ? await (db as any).deviceTunnelBinding.findUnique({
            where: { id: binding.id },
            select: { reconnectGeneration: true, lastReconnectRequestedAt: true },
        })
        : binding;
    return NextResponse.json({
        accepted: true,
        requestId,
        generation: updated.reconnectGeneration,
        requestedAt: updated.lastReconnectRequestedAt?.toISOString?.() || requestedAt.toISOString(),
    }, { status: Number(changed?.count || 0) === 1 ? 202 : 200 });
}
