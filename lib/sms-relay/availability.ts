import db from "@/lib/db";

export type SmsRelayAvailabilityReason =
    | "missing_phone"
    | "masked_phone"
    | "invalid_phone"
    | "sms_relay_disabled"
    | "sms_relay_not_paired"
    | "sms_relay_offline";

export type SmsRelayAvailability = {
    available: boolean;
    reason: SmsRelayAvailabilityReason | null;
    label: string | null;
    deviceId: string | null;
};

export function deriveSmsRelayAvailability(input: {
    smsRelayEnabled?: boolean | null;
    contactPhone?: string | null;
    device?: {
        id?: string | null;
        paired?: boolean | null;
        status?: string | null;
    } | null;
}): SmsRelayAvailability {
    const phone = String(input.contactPhone || "").trim();
    const digits = phone.replace(/\D/g, "");
    if (!phone) {
        return {
            available: false,
            reason: "missing_phone",
            label: "Contact does not have a phone number.",
            deviceId: null,
        };
    }
    if (phone.includes("*")) {
        return {
            available: false,
            reason: "masked_phone",
            label: "Contact phone number is masked.",
            deviceId: null,
        };
    }
    if (digits.length < 7) {
        return {
            available: false,
            reason: "invalid_phone",
            label: "Contact phone number is invalid or too short.",
            deviceId: null,
        };
    }
    if (!input.smsRelayEnabled) {
        return {
            available: false,
            reason: "sms_relay_disabled",
            label: "Android SMS is disabled for this location.",
            deviceId: null,
        };
    }

    const device = input.device || null;
    if (!device?.paired) {
        return {
            available: false,
            reason: "sms_relay_not_paired",
            label: "No paired Android SMS device is available.",
            deviceId: null,
        };
    }
    if (String(device.status || "").toLowerCase() !== "online") {
        return {
            available: false,
            reason: "sms_relay_offline",
            label: "Android SMS device is offline.",
            deviceId: device.id || null,
        };
    }

    return {
        available: true,
        reason: null,
        label: null,
        deviceId: device.id || null,
    };
}

export async function resolveSmsRelayAvailabilityForLocation(input: {
    locationId: string;
    smsRelayEnabled?: boolean | null;
    contactPhone?: string | null;
}): Promise<SmsRelayAvailability> {
    const device = await (db as any).smsRelayDevice.findFirst({
        where: { locationId: input.locationId, paired: true },
        orderBy: { lastSeenAt: "desc" },
        select: { id: true, status: true, paired: true },
    });

    return deriveSmsRelayAvailability({
        smsRelayEnabled: input.smsRelayEnabled,
        contactPhone: input.contactPhone,
        device,
    });
}
