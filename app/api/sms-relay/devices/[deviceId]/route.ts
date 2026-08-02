/**
 * /api/sms-relay/devices/[deviceId]
 *
 * GET    — fetch device details + recent stats
 * PATCH  — update label, phoneNumber
 * DELETE — unpair / delete device (cancels pending outbox jobs)
 *
 * Auth: standard Clerk/SSO session. Device must belong to the user's location.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import db from "@/lib/db";
import { getLocationContext } from "@/lib/auth/location-context";
import { requireSmsRelayPhoneNumber } from "@/lib/sms-relay/phone-number";
import { verifyUserIsLocationAdmin } from "@/lib/auth/permissions";
import { unlinkSmsRelayDevice } from "@/lib/sms-relay/unlink-device";
import { clearWhatsAppWebBridgeSession } from "@/lib/whatsapp/web-bridge";

export const dynamic = "force-dynamic";

type RouteParams = { params: { deviceId: string } };

// ---------------------------------------------------------------------------
// GET /api/sms-relay/devices/[deviceId]
// ---------------------------------------------------------------------------
export async function GET(_req: NextRequest, { params }: RouteParams) {
    try {
        const { userId } = await auth();
        if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const location = await getLocationContext();
        if (!location) return NextResponse.json({ error: "No location" }, { status: 404 });
        if (!await verifyUserIsLocationAdmin(userId, location.id)) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const device = await (db as any).smsRelayDevice.findFirst({
            where: { id: params.deviceId, locationId: location.id },
            select: {
                id: true,
                label: true,
                phoneNumber: true,
                platform: true,
                status: true,
                paired: true,
                lastSeenAt: true,
                createdAt: true,
                updatedAt: true,
            },
        });

        if (!device) return NextResponse.json({ error: "Device not found" }, { status: 404 });

        // Lightweight stats (last 7 days)
        const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const [sent, failed, pending] = await Promise.all([
            (db as any).smsRelayOutbox.count({
                where: { deviceId: params.deviceId, status: "sent", processedAt: { gte: since } },
            }),
            (db as any).smsRelayOutbox.count({
                where: {
                    deviceId: params.deviceId,
                    status: { in: ["dead", "failed"] },
                    updatedAt: { gte: since },
                },
            }),
            (db as any).smsRelayOutbox.count({
                where: {
                    deviceId: params.deviceId,
                    status: { in: ["pending", "processing"] },
                },
            }),
        ]);

        return NextResponse.json({
            device,
            stats: { sent, failed, pending, since: since.toISOString() },
        });
    } catch (error: any) {
        console.error("[SmsRelay] GET device error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}

// ---------------------------------------------------------------------------
// PATCH /api/sms-relay/devices/[deviceId]
// ---------------------------------------------------------------------------
export async function PATCH(req: NextRequest, { params }: RouteParams) {
    try {
        const { userId } = await auth();
        if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const location = await getLocationContext();
        if (!location) return NextResponse.json({ error: "No location" }, { status: 404 });

        const existing = await (db as any).smsRelayDevice.findFirst({
            where: { id: params.deviceId, locationId: location.id },
            select: { id: true },
        });
        if (!existing) return NextResponse.json({ error: "Device not found" }, { status: 404 });

        const body = await req.json().catch(() => ({}));
        const updateData: Record<string, any> = {};
        if (typeof body.label === "string" && body.label.trim()) {
            updateData.label = body.label.trim();
        }
        if (typeof body.phoneNumber === "string") {
            try {
                updateData.phoneNumber = body.phoneNumber.trim()
                    ? requireSmsRelayPhoneNumber(body.phoneNumber)
                    : null;
            } catch (error: any) {
                return NextResponse.json({ error: error?.message || "Invalid phone number" }, { status: 400 });
            }
        }

        const updated = await (db as any).smsRelayDevice.update({
            where: { id: params.deviceId },
            data: updateData,
            select: { id: true, label: true, phoneNumber: true },
        });

        return NextResponse.json({ device: updated });
    } catch (error: any) {
        console.error("[SmsRelay] PATCH device error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}

// ---------------------------------------------------------------------------
// DELETE /api/sms-relay/devices/[deviceId]
// ---------------------------------------------------------------------------
export async function DELETE(_req: NextRequest, { params }: RouteParams) {
    try {
        const { userId } = await auth();
        if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const location = await getLocationContext();
        if (!location) return NextResponse.json({ error: "No location" }, { status: 404 });
        if (!await verifyUserIsLocationAdmin(userId, location.id)) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const result = await db.$transaction((tx) => unlinkSmsRelayDevice(tx as any, {
            deviceId: params.deviceId,
            locationId: location.id,
        }));
        if (!result.found) return NextResponse.json({ error: "Device not found" }, { status: 404 });

        console.info("[SmsRelay] Device safely unlinked", {
            deviceId: params.deviceId,
            locationId: location.id,
            canceledJobs: result.canceledJobs,
            retainedForAudit: result.retainedForAudit,
        });
        let externalWarning: string | null = null;
        if (result.retainedForAudit) {
            try {
                const cleanup = await clearWhatsAppWebBridgeSession(location.id);
                if (!cleanup.workerCleared) {
                    externalWarning = "The device is deactivated locally; WhatsApp worker cleanup will need attention if the worker returns.";
                }
            } catch (error) {
                console.error("[SmsRelay] Post-unlink WhatsApp cleanup failed", error);
                externalWarning = "The device is deactivated locally; WhatsApp worker cleanup requires attention.";
            }
        }
        return NextResponse.json({
            success: true,
            retainedForAudit: result.retainedForAudit,
            externalWarning,
        });
    } catch (error: any) {
        console.error("[SmsRelay] DELETE device error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
