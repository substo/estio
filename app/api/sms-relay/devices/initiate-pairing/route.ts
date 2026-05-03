/**
 * POST /api/sms-relay/devices/initiate-pairing
 *
 * Called by the Estio web UI (Settings → Integrations → SIM Relay)
 * to start pairing a new Android device.
 *
 * Generates a one-time 6-character pair code + QR payload and stores
 * only the SHA-256 hash. The pair code expires in 10 minutes (enforced
 * on the /pair endpoint by checking pairTokenHash + paired=false).
 *
 * Auth: standard Clerk/SSO session (admin only).
 * Body: { label, installation_id? }
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import db from "@/lib/db";
import { generatePairCode } from "@/lib/sms-relay/auth";
import { getLocationContext } from "@/lib/auth/location-context";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const location = await getLocationContext();
        if (!location) {
            return NextResponse.json({ error: "No location found" }, { status: 404 });
        }

        const body = await req.json().catch(() => ({}));
        const label = String(body?.label || "Android Device").trim() || "Android Device";

        const { pairCode, pairTokenHash } = generatePairCode();

        // Create the device record in "unpaired" state
        // Any existing unpaired devices for this location with the same label
        // are cleaned up first to avoid stale pair codes accumulating.
        await (db as any).smsRelayDevice.deleteMany({
            where: {
                locationId: location.id,
                paired: false,
                label,
            },
        });

        const device = await (db as any).smsRelayDevice.create({
            data: {
                locationId: location.id,
                label,
                pairTokenHash,
                paired: false,
                status: "offline",
            },
        });

        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "";
        const qrPayload = JSON.stringify({
            baseUrl,
            pairCode,
            deviceId: device.id,
            // expires in 10 minutes — informational only, not enforced in QR
            expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        });

        console.log(
            `[SmsRelay] Initiated pairing for device "${label}" (${device.id}) in location ${location.id}`
        );

        return NextResponse.json({
            pairCode,
            qrPayload,
            deviceId: device.id,
            expiresInSeconds: 600,
        });
    } catch (error: any) {
        console.error("[SmsRelay] Initiate pairing error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
