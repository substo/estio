/**
 * PATCH /api/sms-relay/gateway/heartbeat
 *
 * Sent by the Android foreground service every ~60 seconds to signal
 * that the device is still alive and reachable. Updates lastSeenAt
 * and ensures status is "online".
 *
 * Auth: Bearer <device_api_token>
 */

import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { extractDeviceFromAuthHeader, hashDeviceToken } from "@/lib/sms-relay/auth";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest) {
    const authHeader = req.headers.get("authorization");
    const devicePayload = extractDeviceFromAuthHeader(authHeader);
    if (!devicePayload) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { deviceId, locationId } = devicePayload;

    try {
        const rawToken = authHeader!.replace(/^Bearer\s+/i, "");
        const tokenHash = hashDeviceToken(rawToken);

        const updated = await (db as any).smsRelayDevice.updateMany({
            where: {
                id: deviceId,
                locationId,
                paired: true,
                deviceApiTokenHash: tokenHash,
            },
            data: {
                lastSeenAt: new Date(),
                status: "online",
            },
        });

        if (!Number(updated?.count || 0)) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        return NextResponse.json({ status: "ok", ts: new Date().toISOString() });
    } catch (error: any) {
        console.error("[SmsRelay] Heartbeat error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
