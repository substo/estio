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
import {
    normalizeStoReconnectGeneration,
    sanitizeStoReconnectErrorCode,
    sanitizeStoRuntimeState,
    shouldRecordStoReconnectAttempt,
} from "@/lib/device-tunnel/reconnect-control";

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
        const body = await req.json().catch(() => ({}));
        const appliedGeneration = normalizeStoReconnectGeneration(body?.sto_reconnect_applied_generation);
        const diagnosticCode = sanitizeStoReconnectErrorCode(body?.sto_error_code);
        const runtimeState = sanitizeStoRuntimeState(body?.sto_state);

        const device = await (db as any).smsRelayDevice.findFirst({
            where: {
                id: deviceId,
                locationId,
                paired: true,
                deviceApiTokenHash: tokenHash,
            },
            select: {
                id: true,
                tunnelBinding: {
                    select: {
                        id: true,
                        desiredState: true,
                        reconnectGeneration: true,
                        lastReconnectRequestedAt: true,
                    },
                },
            },
        });

        if (!device) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const now = new Date();
        const binding = device.tunnelBinding;
        const recordAttempt = binding && shouldRecordStoReconnectAttempt({
            requestedGeneration: binding.reconnectGeneration,
            appliedGeneration,
        });
        await (db as any).$transaction([
            (db as any).smsRelayDevice.update({
                where: { id: device.id },
                data: {
                    lastSeenAt: now,
                    status: "online",
                    ...(typeof body?.app_version === "string"
                        ? { appVersion: body.app_version.trim().slice(0, 64) || undefined }
                        : {}),
                },
            }),
            ...(binding ? [
                (db as any).deviceTunnelBinding.update({
                    where: { id: binding.id },
                    data: {
                        ...(recordAttempt ? { lastReconnectAttemptedAt: now } : {}),
                        lastReconnectErrorCode: diagnosticCode,
                        lastDeviceRuntimeState: runtimeState,
                        ...(typeof body?.battery_optimization_ignored === "boolean"
                            ? { batteryOptimizationIgnored: body.battery_optimization_ignored }
                            : {}),
                    },
                }),
            ] : []),
        ]);

        return NextResponse.json({
            status: "ok",
            ts: now.toISOString(),
            sto_should_run: binding?.desiredState !== "disabled",
            sto_reconnect_generation: normalizeStoReconnectGeneration(binding?.reconnectGeneration),
            sto_reconnect_requested_at: binding?.lastReconnectRequestedAt?.toISOString?.() || null,
        });
    } catch (error: any) {
        console.error("[SmsRelay] Heartbeat error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
