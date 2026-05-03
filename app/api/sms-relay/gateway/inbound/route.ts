/**
 * POST /api/sms-relay/gateway/inbound
 *
 * Called by the Android companion app's BroadcastReceiver when an SMS
 * is received on the device. Forwards the message into Estio's conversation system.
 *
 * Body: { from, to, body, received_at_ms, contact_name? }
 * Auth: Bearer <device_api_token>
 * Security: HMAC-SHA256 signature verified via X-SmsRelay-Signature header
 */

import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import {
    extractDeviceFromAuthHeader,
    hashDeviceToken,
    verifyInboundSignature,
} from "@/lib/sms-relay/auth";
import { processSmsRelayInbound } from "@/lib/sms-relay/sync";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
    // 1. Authenticate device
    const authHeader = req.headers.get("authorization");
    const devicePayload = extractDeviceFromAuthHeader(authHeader);
    if (!devicePayload) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { deviceId, locationId } = devicePayload;

    try {
        // 2. Read raw body for HMAC verification
        const rawBody = await req.text();

        // 3. Verify HMAC signature (skip in dev if secret not set)
        const sigHeader = req.headers.get("x-smsrelay-signature");
        if (process.env.SMS_RELAY_WEBHOOK_SECRET) {
            if (!verifyInboundSignature(rawBody, sigHeader)) {
                console.warn(`[SmsRelay] Invalid inbound signature from device ${deviceId}`);
                return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
            }
        }

        // 4. Verify token hash against DB
        const rawToken = authHeader!.replace(/^Bearer\s+/i, "");
        const tokenHash = hashDeviceToken(rawToken);
        const device = await (db as any).smsRelayDevice.findFirst({
            where: { id: deviceId, locationId, paired: true, deviceApiTokenHash: tokenHash },
            select: { id: true, locationId: true },
        });
        if (!device) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        // 5. Parse body
        let parsed: any;
        try {
            parsed = JSON.parse(rawBody);
        } catch {
            return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
        }

        const { from, to, body: smsBody, received_at_ms, contact_name } = parsed ?? {};

        if (!from || !smsBody) {
            return NextResponse.json(
                { error: "Missing required fields: from, body" },
                { status: 400 }
            );
        }

        const receivedAt = received_at_ms
            ? new Date(Number(received_at_ms))
            : new Date();

        // 6. Process the inbound SMS
        const result = await processSmsRelayInbound({
            locationId,
            deviceId,
            from: String(from),
            to: String(to || ""),
            body: String(smsBody),
            receivedAt,
            contactName: contact_name ? String(contact_name) : null,
        });

        // 7. Update device heartbeat
        await (db as any).smsRelayDevice.update({
            where: { id: deviceId },
            data: { lastSeenAt: new Date(), status: "online" },
        }).catch(() => {});

        if (result.status === "error") {
            console.error(`[SmsRelay] Inbound processing error: ${result.reason}`);
            return NextResponse.json({ error: result.reason }, { status: 422 });
        }

        return NextResponse.json({ status: result.status, message_id: result.messageId });
    } catch (error: any) {
        console.error("[SmsRelay] Inbound error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
