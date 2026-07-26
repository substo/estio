export type StoSecureDeliveryState =
    | "ready"
    | "reconnecting"
    | "device_offline"
    | "session_restoring"
    | "unavailable";

export type StoSecureDeliveryStatus = {
    configured: boolean;
    state: StoSecureDeliveryState;
    label: string;
    detail: string;
    deviceAlias: string | null;
    networkType: string | null;
    lastConnectedAt: string | null;
    lastVerifiedAt: string | null;
    protectedSession: boolean;
};

type StoSecureDeliveryStatusInput = {
    configured: boolean;
    deviceAlias?: string | null;
    deviceStatus?: string | null;
    deviceRevoked?: boolean;
    bindingStatus?: string | null;
    bindingFresh?: boolean;
    networkType?: string | null;
    lastConnectedAt?: string | Date | null;
    lastVerifiedAt?: string | Date | null;
    workerReady?: boolean;
    workerStatus?: string | null;
    workerRestarting?: boolean;
    runtimeLeaseEnforced?: boolean;
    sessionAuthMode?: string | null;
    authDurableReady?: boolean;
    authState?: string | null;
    recoveryStatus?: string | null;
};

function iso(value: string | Date | null | undefined) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function normalize(value: unknown) {
    return String(value || "").trim().toLowerCase();
}

export function buildStoSecureDeliveryStatus(input: StoSecureDeliveryStatusInput): StoSecureDeliveryStatus {
    const base = {
        configured: input.configured,
        deviceAlias: String(input.deviceAlias || "").trim() || null,
        networkType: normalize(input.networkType) || null,
        lastConnectedAt: iso(input.lastConnectedAt),
        lastVerifiedAt: iso(input.lastVerifiedAt),
    };
    const authState = normalize(input.authState);
    const recoveryStatus = normalize(input.recoveryStatus);
    const workerStatus = normalize(input.workerStatus);
    const protectedSession = Boolean(
        input.runtimeLeaseEnforced
        && normalize(input.sessionAuthMode) === "encrypted_snapshot"
        && input.authDurableReady
        && authState === "attached"
        && recoveryStatus !== "quarantined"
        && recoveryStatus !== "relink_required"
    );

    if (!input.configured) {
        return {
            ...base,
            state: "unavailable",
            label: "STO Unavailable",
            detail: "STO Secure Delivery is not configured for this WhatsApp session.",
            protectedSession: false,
        };
    }

    if (
        input.deviceRevoked
        || ["revoked", "disabled"].includes(normalize(input.bindingStatus))
        || ["quarantined", "relink_required"].includes(authState)
        || ["quarantined", "relink_required"].includes(recoveryStatus)
    ) {
        return {
            ...base,
            state: "unavailable",
            label: "STO Unavailable",
            detail: authState === "relink_required" || recoveryStatus === "relink_required"
                ? "The protected WhatsApp session must be linked again."
                : "STO Secure Delivery needs administrator attention.",
            protectedSession: false,
        };
    }

    const deviceOnline = normalize(input.deviceStatus) === "online"
        && normalize(input.bindingStatus) === "online"
        && input.bindingFresh === true;
    if (!deviceOnline) {
        return {
            ...base,
            state: "device_offline",
            label: "STO Device Offline",
            detail: "Messages will remain queued until the connected STO device is online.",
            protectedSession,
        };
    }

    if (
        ["attaching", "detaching", "recovering"].includes(authState)
        || recoveryStatus === "restoring_previous"
    ) {
        return {
            ...base,
            state: "session_restoring",
            label: "WhatsApp Session Restoring",
            detail: "Estio is restoring and verifying the protected WhatsApp session.",
            protectedSession: false,
        };
    }

    if (!protectedSession) {
        return {
            ...base,
            state: "unavailable",
            label: "STO Unavailable",
            detail: "The encrypted session profile and exclusive runtime ownership are not both verified.",
            protectedSession: false,
        };
    }

    if (input.workerReady) {
        return {
            ...base,
            state: "ready",
            label: "STO Ready",
            detail: "WhatsApp is ready through the connected STO device and protected session.",
            protectedSession: true,
        };
    }

    if (
        input.workerRestarting
        || ["starting", "loading", "authenticated", "restarting", "reconnecting", "stale"].includes(workerStatus)
    ) {
        return {
            ...base,
            state: "reconnecting",
            label: "STO Reconnecting",
            detail: "The protected route is reconnecting. Messages will remain queued until it is ready.",
            protectedSession: true,
        };
    }

    return {
        ...base,
        state: "unavailable",
        label: "STO Unavailable",
        detail: "The protected WhatsApp route is not ready.",
        protectedSession: true,
    };
}
