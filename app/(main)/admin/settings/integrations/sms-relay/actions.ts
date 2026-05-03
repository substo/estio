"use server";

/**
 * app/(main)/admin/settings/integrations/sms-relay/actions.ts
 *
 * Server actions for the SIM Relay settings page.
 */

import { auth } from "@clerk/nextjs/server";
import { getLocationContext } from "@/lib/auth/location-context";
import db from "@/lib/db";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SmsRelayDevice = {
    id: string;
    label: string;
    phoneNumber: string | null;
    platform: string;
    status: string;
    paired: boolean;
    lastSeenAt: string | null;
    createdAt: string;
};

export type SmsRelayStats = {
    sent7d: number;
    received7d: number;
    failed7d: number;
    pending: number;
};

// ---------------------------------------------------------------------------
// List all devices for the current location
// ---------------------------------------------------------------------------

export async function getSmsRelayDevices(): Promise<SmsRelayDevice[]> {
    const { userId } = await auth();
    if (!userId) throw new Error("Unauthorized");

    const location = await getLocationContext();
    if (!location) return [];

    const devices = await (db as any).smsRelayDevice.findMany({
        where: { locationId: location.id },
        orderBy: { createdAt: "desc" },
        select: {
            id: true,
            label: true,
            phoneNumber: true,
            platform: true,
            status: true,
            paired: true,
            lastSeenAt: true,
            createdAt: true,
        },
    });

    return devices.map((d: any) => ({
        ...d,
        lastSeenAt: d.lastSeenAt ? new Date(d.lastSeenAt).toISOString() : null,
        createdAt: new Date(d.createdAt).toISOString(),
    }));
}

// ---------------------------------------------------------------------------
// Initiate pairing (delegates to API route internally via fetch)
// ---------------------------------------------------------------------------

export async function initiatePairing(
    label: string
): Promise<{ pairCode: string; qrPayload: string; deviceId: string; expiresInSeconds: number }> {
    const { userId } = await auth();
    if (!userId) throw new Error("Unauthorized");

    const location = await getLocationContext();
    if (!location) throw new Error("No location found");

    // Import auth helpers directly (no HTTP round-trip needed in server action)
    const { generatePairCode } = await import("@/lib/sms-relay/auth");
    const { pairCode, pairTokenHash } = generatePairCode();

    // Remove stale unpaired devices with same label
    await (db as any).smsRelayDevice.deleteMany({
        where: { locationId: location.id, paired: false, label: label.trim() },
    });

    const device = await (db as any).smsRelayDevice.create({
        data: {
            locationId: location.id,
            label: label.trim() || "Android Device",
            pairTokenHash,
            paired: false,
            status: "offline",
        },
    });

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "";
    const qrPayload = JSON.stringify({
        baseUrl,
        pairCode,
        deviceId: device.id,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });

    return { pairCode, qrPayload, deviceId: device.id, expiresInSeconds: 600 };
}

// ---------------------------------------------------------------------------
// Update device label / phone number
// ---------------------------------------------------------------------------

export async function updateDevice(
    deviceId: string,
    data: { label?: string; phoneNumber?: string }
): Promise<void> {
    const { userId } = await auth();
    if (!userId) throw new Error("Unauthorized");

    const location = await getLocationContext();
    if (!location) throw new Error("No location found");

    await (db as any).smsRelayDevice.updateMany({
        where: { id: deviceId, locationId: location.id },
        data: {
            ...(data.label ? { label: data.label.trim() } : {}),
            ...(typeof data.phoneNumber === "string"
                ? { phoneNumber: data.phoneNumber.trim() || null }
                : {}),
        },
    });
}

// ---------------------------------------------------------------------------
// Unlink / delete a device
// ---------------------------------------------------------------------------

export async function unlinkDevice(deviceId: string): Promise<void> {
    const { userId } = await auth();
    if (!userId) throw new Error("Unauthorized");

    const location = await getLocationContext();
    if (!location) throw new Error("No location found");

    const device = await (db as any).smsRelayDevice.findFirst({
        where: { id: deviceId, locationId: location.id },
        select: { id: true },
    });
    if (!device) return;

    // Cancel pending jobs first
    await (db as any).smsRelayOutbox.updateMany({
        where: {
            deviceId,
            status: { in: ["pending", "processing", "failed"] },
        },
        data: { status: "cancelled", lastError: "Device was unlinked by user." },
    });

    await (db as any).smsRelayDevice.delete({ where: { id: deviceId } });
}

// ---------------------------------------------------------------------------
// Aggregate stats for the settings page
// ---------------------------------------------------------------------------

export async function getSmsRelayStats(): Promise<SmsRelayStats> {
    const { userId } = await auth();
    if (!userId) throw new Error("Unauthorized");

    const location = await getLocationContext();
    if (!location) return { sent7d: 0, received7d: 0, failed7d: 0, pending: 0 };

    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [sent7d, received7d, failed7d, pending] = await Promise.all([
        (db as any).smsRelayOutbox.count({
            where: { locationId: location.id, status: "sent", processedAt: { gte: since } },
        }),
        db.message.count({
            where: {
                conversation: { locationId: location.id },
                type: "SMS_RELAY",
                direction: "inbound",
                createdAt: { gte: since },
            },
        }),
        (db as any).smsRelayOutbox.count({
            where: {
                locationId: location.id,
                status: { in: ["dead", "failed"] },
                updatedAt: { gte: since },
            },
        }),
        (db as any).smsRelayOutbox.count({
            where: {
                locationId: location.id,
                status: { in: ["pending", "processing"] },
            },
        }),
    ]);

    return { sent7d, received7d, failed7d, pending };
}
