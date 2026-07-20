import db from "@/lib/db";
import {
    isDeviceTunnelRuntimeLeaseEnforcementActive,
    validateDeviceTunnelRuntimeOwnership,
} from "@/lib/device-tunnel/runtime-ownership";

export const DEVICE_EGRESS_OFFLINE_CODE = "DEVICE_EGRESS_OFFLINE";
const TUNNEL_FRESHNESS_MS = Math.max(Number(process.env.DEVICE_TUNNEL_FRESHNESS_MS || 45_000), 10_000);

export type WhatsAppDeviceEgressStatus = {
    required: boolean;
    available: boolean;
    reason: string | null;
    sessionPhone: string | null;
};

export async function getWhatsAppDeviceEgressStatus(locationId: string): Promise<WhatsAppDeviceEgressStatus> {
    const session = await (db as any).whatsAppWebBridgeSession.findUnique({
        where: { locationId },
        include: { tunnelBinding: { include: { sessionLease: true } } },
    }).catch(() => null);
    if (session?.egressMode !== "device_tunnel") {
        return { required: false, available: true, reason: null, sessionPhone: session?.phone || null };
    }
    const binding = session.tunnelBinding;
    if (!binding) {
        return { required: true, available: false, reason: "No Android egress device is assigned.", sessionPhone: session.phone || null };
    }
    const fresh = Boolean(binding.lastSeenAt && Date.now() - new Date(binding.lastSeenAt).getTime() <= TUNNEL_FRESHNESS_MS);
    let runtimeOwned = true;
    if (isDeviceTunnelRuntimeLeaseEnforcementActive()) {
        const lease = binding.sessionLease;
        runtimeOwned = Boolean(
            lease
            && binding.gatewayNodeId
            && await validateDeviceTunnelRuntimeOwnership({
                db: db as any,
                ownership: {
                    locationId,
                    sessionId: session.id,
                    bindingId: binding.id,
                    gatewayNodeId: binding.gatewayNodeId,
                    assignmentEpoch: binding.assignmentEpoch,
                    ownerInstanceId: lease.ownerInstanceId,
                    leaseEpoch: lease.epoch,
                },
            })
        );
    }
    const available = binding.status === "online" && fresh && runtimeOwned;
    return {
        required: true,
        available,
        reason: available
            ? null
            : !runtimeOwned
                ? "The assigned Android egress runtime does not hold an active ownership lease."
                : binding.lastError || "The assigned Android network relay is offline.",
        sessionPhone: session.phone || null,
    };
}

export function createDeviceEgressOfflineError(reason?: string | null) {
    const error: any = new Error(reason || "The assigned Android WhatsApp network relay is offline.");
    error.code = DEVICE_EGRESS_OFFLINE_CODE;
    error.providerClassification = { retryable: true, reason: "device_egress_offline" };
    return error;
}

export function isDeviceEgressOfflineError(error: unknown) {
    return String((error as any)?.code || "") === DEVICE_EGRESS_OFFLINE_CODE;
}
