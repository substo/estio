import { NextRequest, NextResponse } from "next/server";

import db from "@/lib/db";
import { extractDeviceFromAuthHeader, hashDeviceToken } from "@/lib/sms-relay/auth";
import { processSmsRelayManualOutbound } from "@/lib/sms-relay/send";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
    const authHeader = req.headers.get("authorization");
    const devicePayload = extractDeviceFromAuthHeader(authHeader);
    if (!devicePayload) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { deviceId, locationId } = devicePayload;

    try {
        const rawToken = authHeader!.replace(/^Bearer\s+/i, "");
        const tokenHash = hashDeviceToken(rawToken);
        const device = await (db as any).smsRelayDevice.findFirst({
            where: { id: deviceId, locationId, paired: true, deviceApiTokenHash: tokenHash },
            select: { id: true },
        });
        if (!device) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const sentAt = body?.sent_at_ms ? new Date(Number(body.sent_at_ms)) : new Date();
        const result = await processSmsRelayManualOutbound({
            locationId,
            deviceId,
            to: String(body?.to || ""),
            body: String(body?.body || ""),
            sentAt,
        });

        await (db as any).smsRelayDevice.update({
            where: { id: deviceId },
            data: { lastSeenAt: new Date(), status: "online" },
        }).catch(() => {});

        if (result.status === "error") {
            return NextResponse.json({ error: result.reason }, { status: 422 });
        }

        return NextResponse.json(result);
    } catch (error: any) {
        console.error("[SmsRelayManualOutbound] error", {
            locationId,
            deviceId,
            error: error?.message || String(error),
        });
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
