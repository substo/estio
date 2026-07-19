/**
 * POST /api/sms-relay/gateway/pair
 *
 * Called by the Android companion app after the user scans the QR code
 * or enters the 6-character pair code.
 *
 * Body: { pair_code, device_push_token?, device_label?, phone_number? }
 * Response: { device_api_token, device_id }
 *
 * Security: no auth required on this endpoint — the pair_code IS the credential.
 * The code is single-use (pairTokenHash cleared after successful pairing).
 */

import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { hashPairCode, generateDeviceToken, hashDeviceToken } from "@/lib/sms-relay/auth";
import { validateTunnelPublicKey } from "@/lib/device-tunnel/auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const {
            pair_code,
            device_push_token,
            device_label,
            phone_number,
            tunnel_public_key,
            app_version,
            capabilities,
        } = body ?? {};

        if (!pair_code || typeof pair_code !== "string") {
            return NextResponse.json({ error: "Missing pair_code" }, { status: 400 });
        }

        const pairTokenHash = hashPairCode(pair_code);

        const tunnelPublicKey = typeof tunnel_public_key === "string" ? tunnel_public_key.trim() : "";
        if (tunnelPublicKey && !validateTunnelPublicKey(tunnelPublicKey)) {
            return NextResponse.json({ error: "Invalid tunnel public key" }, { status: 400 });
        }

        const requestedCapabilities = Array.isArray(capabilities)
            ? capabilities.map((item: unknown) => String(item || "").trim()).filter(Boolean)
            : [];
        const acceptedCapabilities = Array.from(new Set([
            "sms_relay",
            ...(tunnelPublicKey && requestedCapabilities.includes("whatsapp_egress") ? ["whatsapp_egress"] : []),
        ]));

        // Find the device awaiting pairing with this code
        const device = await (db as any).smsRelayDevice.findFirst({
            where: {
                pairTokenHash,
                paired: false,
                pairExpiresAt: { gt: new Date() },
            },
            include: { location: { select: { id: true, smsRelayEnabled: true } } },
        });

        if (!device) {
            return NextResponse.json(
                { error: "Invalid or expired pair code" },
                { status: 401 }
            );
        }

        // Issue a long-lived device JWT
        const rawToken = generateDeviceToken(device.id, device.locationId);
        const tokenHash = hashDeviceToken(rawToken);

        // Mark device as paired — clear the one-time pair code hash
        const paired = await (db as any).smsRelayDevice.updateMany({
            where: {
                id: device.id,
                paired: false,
                pairTokenHash,
                pairExpiresAt: { gt: new Date() },
            },
            data: {
                paired: true,
                pairTokenHash: null,
                pairExpiresAt: null,
                pairAttemptCount: 0,
                deviceApiTokenHash: tokenHash,
                devicePushToken: device_push_token ?? null,
                label: device_label ?? device.label,
                phoneNumber: phone_number ?? device.phoneNumber ?? null,
                capabilities: acceptedCapabilities,
                appVersion: typeof app_version === "string" ? app_version.trim().slice(0, 64) || null : null,
                tunnelPublicKey: tunnelPublicKey || null,
                tunnelRevokedAt: null,
                status: "online",
                lastSeenAt: new Date(),
            },
        });
        if (!Number(paired?.count || 0)) {
            return NextResponse.json({ error: "Pair code was already used or expired" }, { status: 409 });
        }

        console.log(
            `[SmsRelay] Device paired: ${device.id} (${device_label ?? device.label}) for location ${device.locationId}`
        );

        // Return the raw token ONCE — it is never stored in plain text again
        return NextResponse.json({
            device_api_token: rawToken,
            device_id: device.id,
            location_id: device.locationId,
            capabilities: acceptedCapabilities,
            tunnel_enabled: acceptedCapabilities.includes("whatsapp_egress"),
        });
    } catch (error: any) {
        console.error("[SmsRelay] Pair error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
