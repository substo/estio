"use server";

/**
 * app/(main)/admin/settings/integrations/sms-relay/actions.ts
 *
 * Server actions for the SIM Relay settings page.
 */

import { auth } from "@clerk/nextjs/server";
import { getLocationContext } from "@/lib/auth/location-context";
import db from "@/lib/db";
import { requireSmsRelayPhoneNumber } from "@/lib/sms-relay/phone-number";
import { verifyUserIsLocationAdmin } from "@/lib/auth/permissions";
import { unlinkSmsRelayDevice } from "@/lib/sms-relay/unlink-device";

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
    capabilities: string[];
    appVersion: string | null;
    lastSeenAt: string | null;
    createdAt: string;
};

export type SmsRelayStats = {
    sent7d: number;
    received7d: number;
    failed7d: number;
    pending: number;
};

export type DeviceActivityStats = {
    sentToday: number;
    failedToday: number;
    queuedNow: number;
    lastMessageAt: string | null;
};

async function getSmsRelayLocation({ required = false }: { required?: boolean } = {}) {
    const { userId } = await auth();
    if (!userId) throw new Error("Unauthorized");

    const location = await getLocationContext();
    if (!location && required) throw new Error("No location found");
    if (location && !await verifyUserIsLocationAdmin(userId, location.id)) {
        throw new Error("Unauthorized");
    }

    return location;
}

// ---------------------------------------------------------------------------
// List all devices for the current location
// ---------------------------------------------------------------------------

export async function getSmsRelayDevices(): Promise<SmsRelayDevice[]> {
    const location = await getSmsRelayLocation();
    if (!location) return [];

    const devices = await (db as any).smsRelayDevice.findMany({
        where: {
            locationId: location.id,
            tunnelRevokedAt: null,
            OR: [
                { paired: true },
                { paired: false, pairExpiresAt: { gt: new Date() } },
            ],
        },
        orderBy: { createdAt: "desc" },
        select: {
            id: true,
            label: true,
            phoneNumber: true,
            platform: true,
            status: true,
            paired: true,
            capabilities: true,
            appVersion: true,
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
    const location = await getSmsRelayLocation({ required: true });

    // Import auth helpers directly (no HTTP round-trip needed in server action)
    const { generatePairCode } = await import("@/lib/sms-relay/auth");
    const { pairCode, pairTokenHash } = generatePairCode();

    // Remove stale unpaired devices with same label
    await (db as any).smsRelayDevice.deleteMany({
        where: {
            locationId: location.id,
            paired: false,
            label: label.trim(),
            tunnelBinding: null,
        },
    });

    const device = await (db as any).smsRelayDevice.create({
        data: {
            locationId: location.id,
            label: label.trim() || "Android Device",
            pairTokenHash,
            pairExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
            pairAttemptCount: 0,
            paired: false,
            status: "offline",
        },
    });

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "https://estio.co";
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
    const location = await getSmsRelayLocation({ required: true });
    const normalizedPhoneNumber = typeof data.phoneNumber === "string" && data.phoneNumber.trim()
        ? requireSmsRelayPhoneNumber(data.phoneNumber)
        : null;

    await (db as any).smsRelayDevice.updateMany({
        where: { id: deviceId, locationId: location.id },
        data: {
            ...(data.label ? { label: data.label.trim() } : {}),
            ...(typeof data.phoneNumber === "string"
                ? { phoneNumber: normalizedPhoneNumber }
                : {}),
        },
    });
}

// ---------------------------------------------------------------------------
// Safely unlink a device while retaining immutable tunnel audit history
// ---------------------------------------------------------------------------

export async function unlinkDevice(deviceId: string): Promise<{ success: boolean; error?: string }> {
    try {
        const location = await getSmsRelayLocation({ required: true });
        const result = await db.$transaction((tx) => unlinkSmsRelayDevice(tx as any, {
            deviceId,
            locationId: location.id,
        }));
        return result.found
            ? { success: true }
            : { success: false, error: "Device not found" };
    } catch (error) {
        console.error("[SmsRelay] Safe unlink failed", error);
        return { success: false, error: "Unable to unlink the device safely" };
    }
}

// ---------------------------------------------------------------------------
// Aggregate stats for the settings page
// ---------------------------------------------------------------------------

export async function getSmsRelayStats(): Promise<SmsRelayStats> {
    const location = await getSmsRelayLocation();
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
                processedAt: { gte: since },
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

// ---------------------------------------------------------------------------
// Toggle SIM Relay enabled/disabled for the current location
// ---------------------------------------------------------------------------

export async function getSmsRelayToggle(): Promise<boolean> {
    const location = await getSmsRelayLocation();
    if (!location) return false;

    const loc = await db.location.findUnique({
        where: { id: location.id },
        select: { smsRelayEnabled: true },
    });

    return loc?.smsRelayEnabled ?? false;
}

export async function toggleSmsRelay(enabled: boolean): Promise<boolean> {
    const location = await getSmsRelayLocation({ required: true });

    const updated = await db.location.update({
        where: { id: location.id },
        data: { smsRelayEnabled: enabled },
        select: { smsRelayEnabled: true },
    });

    return updated.smsRelayEnabled;
}

// ---------------------------------------------------------------------------
// Per-Device Activity Stats
// ---------------------------------------------------------------------------

export async function getDeviceActivityStats(deviceId: string): Promise<DeviceActivityStats> {
    const location = await getSmsRelayLocation();
    if (!location) return { sentToday: 0, failedToday: 0, queuedNow: 0, lastMessageAt: null };

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [sentToday, failedToday, queuedNow, lastMessage] = await Promise.all([
        (db as any).smsRelayOutbox.count({
            where: { deviceId, status: "sent", processedAt: { gte: startOfDay } },
        }),
        (db as any).smsRelayOutbox.count({
            where: { deviceId, status: { in: ["failed", "dead"] }, processedAt: { gte: startOfDay } },
        }),
        (db as any).smsRelayOutbox.count({
            where: { deviceId, status: { in: ["pending", "processing"] } },
        }),
        (db as any).smsRelayOutbox.findFirst({
            where: { deviceId, status: "sent" },
            orderBy: { processedAt: "desc" },
            select: { processedAt: true },
        }),
    ]);

    return {
        sentToday,
        failedToday,
        queuedNow,
        lastMessageAt: lastMessage?.processedAt ? new Date(lastMessage.processedAt).toISOString() : null,
    };
}
