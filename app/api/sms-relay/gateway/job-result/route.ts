/**
 * POST /api/sms-relay/gateway/job-result
 *
 * Called by the Android app after attempting to send an SMS.
 * Updates the SmsRelayOutbox row and the linked Message status.
 * Fires a realtime SSE event so the browser UI updates instantly.
 *
 * Body: { job_id, result: "sent" | "failed" | "cancelled", error_message? }
 * Auth: Bearer <device_api_token>
 */

import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { extractDeviceFromAuthHeader, hashDeviceToken } from "@/lib/sms-relay/auth";
import { markSmsRelayOutboxResult } from "@/lib/sms-relay/outbox";
import { publishConversationRealtimeEvent } from "@/lib/realtime/conversation-events";

export const dynamic = "force-dynamic";

const VALID_RESULTS = ["sent", "failed", "cancelled"] as const;
type JobResult = (typeof VALID_RESULTS)[number];

export async function POST(req: NextRequest) {
    const authHeader = req.headers.get("authorization");
    const devicePayload = extractDeviceFromAuthHeader(authHeader);
    if (!devicePayload) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { deviceId, locationId } = devicePayload;

    try {
        // Verify token hash
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
        const { job_id, result, error_message } = body ?? {};

        if (!job_id || typeof job_id !== "string") {
            return NextResponse.json({ error: "Missing job_id" }, { status: 400 });
        }
        if (!result || !VALID_RESULTS.includes(result as JobResult)) {
            return NextResponse.json(
                { error: `result must be one of: ${VALID_RESULTS.join(", ")}` },
                { status: 400 }
            );
        }

        // Mark result in outbox + update message
        const outboxResult = await markSmsRelayOutboxResult({
            outboxId: job_id,
            deviceId,
            result: result as JobResult,
            errorMessage: error_message ?? null,
        });

        if (!outboxResult) {
            return NextResponse.json(
                { error: "Job not found or not owned by this device" },
                { status: 404 }
            );
        }

        // Fetch the outbox row to get conversationId for SSE
        const outboxRow = await (db as any).smsRelayOutbox.findUnique({
            where: { id: job_id },
            select: { conversationId: true, messageId: true },
        });

        if (outboxRow?.conversationId) {
            void publishConversationRealtimeEvent({
                locationId,
                conversationId: outboxRow.conversationId,
                type: "message.status",
                payload: {
                    channel: "sms_relay",
                    messageId: outboxRow.messageId,
                    status: result === "sent" ? "sent" : "failed",
                    deviceId,
                    outboxStatus: outboxResult.status,
                },
            }).catch((err: any) =>
                console.warn("[SmsRelay] Failed to publish job-result SSE:", err)
            );
        }

        // Update device heartbeat
        await (db as any).smsRelayDevice.update({
            where: { id: deviceId },
            data: { lastSeenAt: new Date(), status: "online" },
        }).catch(() => {});

        return NextResponse.json({ status: "ok", outboxStatus: outboxResult.status });
    } catch (error: any) {
        console.error("[SmsRelay] Job result error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
