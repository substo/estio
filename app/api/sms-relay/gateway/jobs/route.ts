/**
 * GET /api/sms-relay/gateway/jobs
 *
 * Polled by the Android companion app (every ~15s) to fetch pending outbound
 * SMS jobs. Returns up to `limit` queued jobs and marks them as "processing"
 * so they aren't double-served.
 *
 * Auth: Bearer <device_api_token> (JWT verified against SMS_RELAY_JWT_SECRET)
 */

import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { extractDeviceFromAuthHeader, hashDeviceToken } from "@/lib/sms-relay/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
    // 1. Authenticate device
    const authHeader = req.headers.get("authorization");
    const devicePayload = extractDeviceFromAuthHeader(authHeader);
    if (!devicePayload) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { deviceId, locationId } = devicePayload;
    const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") || 20), 50);

    try {
        // 2. Verify device token hash matches DB (prevents revoked tokens)
        const rawToken = authHeader!.replace(/^Bearer\s+/i, "");
        const tokenHash = hashDeviceToken(rawToken);

        const device = await (db as any).smsRelayDevice.findFirst({
            where: {
                id: deviceId,
                locationId,
                paired: true,
                deviceApiTokenHash: tokenHash,
            },
            select: { id: true, locationId: true },
        });

        if (!device) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        // 3. Update heartbeat
        await (db as any).smsRelayDevice.update({
            where: { id: deviceId },
            data: { lastSeenAt: new Date(), status: "online" },
        });

        // 4. Fetch pending jobs for this device
        const jobs = await (db as any).smsRelayOutbox.findMany({
            where: {
                deviceId,
                status: "processing", // locked by BullMQ worker — ready to serve
            },
            orderBy: { scheduledAt: "asc" },
            take: limit,
            select: {
                id: true,
                toNumber: true,
                body: true,
                conversationId: true,
                messageId: true,
            },
        });

        const formattedJobs = jobs.map((j: any) => ({
            job_id: j.id,
            to: j.toNumber,
            body: j.body,
            conversation_id: j.conversationId,
            message_id: j.messageId,
        }));

        return NextResponse.json(formattedJobs);
    } catch (error: any) {
        console.error("[SmsRelay] Jobs fetch error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
