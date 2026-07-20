import type { DeviceTunnelSessionLeaseRecord } from "./session-lease";
import { isDistributedDeviceTunnelPlacementEnabled } from "./distributed-placement";

export const DEVICE_TUNNEL_RUNTIME_LEASE_ENFORCEMENT_FLAG = "DEVICE_TUNNEL_RUNTIME_LEASE_ENFORCEMENT";

export type DeviceTunnelRuntimeOwnership = {
    locationId: string;
    sessionId: string;
    bindingId: string;
    gatewayNodeId: string;
    assignmentEpoch: number;
    ownerInstanceId: string;
    leaseEpoch: number;
};

export type DeviceTunnelRuntimeOwnershipRecord = DeviceTunnelSessionLeaseRecord & {
    session: { locationId: string };
    binding: {
        id: string;
        locationId: string;
        sessionId: string;
        gatewayNodeId: string | null;
        assignmentEpoch: number;
        desiredState: string;
    };
    gatewayNode: { id: string; status: string };
};

type RuntimeOwnershipDb = {
    deviceTunnelSessionLease: {
        findUnique(args: unknown): Promise<DeviceTunnelRuntimeOwnershipRecord | null>;
    };
};

export function isDeviceTunnelRuntimeLeaseEnforcementEnabled(env: NodeJS.ProcessEnv = process.env) {
    return String(env[DEVICE_TUNNEL_RUNTIME_LEASE_ENFORCEMENT_FLAG] || "").trim().toLowerCase() === "true";
}

export function isDeviceTunnelRuntimeLeaseEnforcementActive(env: NodeJS.ProcessEnv = process.env) {
    return isDistributedDeviceTunnelPlacementEnabled(env) && isDeviceTunnelRuntimeLeaseEnforcementEnabled(env);
}

export function validateDeviceTunnelRuntimeOwnershipDescriptor(value: unknown): DeviceTunnelRuntimeOwnership {
    const ownership = value as Partial<DeviceTunnelRuntimeOwnership> | null;
    if (
        !ownership
        || !ownership.locationId
        || !ownership.sessionId
        || !ownership.bindingId
        || !ownership.gatewayNodeId
        || !ownership.ownerInstanceId
        || !Number.isSafeInteger(ownership.assignmentEpoch)
        || Number(ownership.assignmentEpoch) < 1
        || !Number.isSafeInteger(ownership.leaseEpoch)
        || Number(ownership.leaseEpoch) < 1
    ) {
        throw new Error("Device tunnel runtime ownership scope is incomplete");
    }
    return ownership as DeviceTunnelRuntimeOwnership;
}

export function sameDeviceTunnelRuntimeOwnership(
    left: DeviceTunnelRuntimeOwnership | null | undefined,
    right: DeviceTunnelRuntimeOwnership | null | undefined,
) {
    return Boolean(
        left
        && right
        && left.locationId === right.locationId
        && left.sessionId === right.sessionId
        && left.bindingId === right.bindingId
        && left.gatewayNodeId === right.gatewayNodeId
        && left.assignmentEpoch === right.assignmentEpoch
        && left.ownerInstanceId === right.ownerInstanceId
        && left.leaseEpoch === right.leaseEpoch
    );
}

export function isDeviceTunnelRuntimeOwnershipRecordValid(args: {
    ownership: DeviceTunnelRuntimeOwnership;
    record: DeviceTunnelRuntimeOwnershipRecord | null;
    now?: Date;
}) {
    const { ownership, record } = args;
    const now = args.now || new Date();
    return Boolean(
        record
        && record.sessionId === ownership.sessionId
        && record.bindingId === ownership.bindingId
        && record.gatewayNodeId === ownership.gatewayNodeId
        && record.ownerInstanceId === ownership.ownerInstanceId
        && record.epoch === ownership.leaseEpoch
        && record.state === "active"
        && record.expiresAt > now
        && record.session.locationId === ownership.locationId
        && record.binding.id === ownership.bindingId
        && record.binding.locationId === ownership.locationId
        && record.binding.sessionId === ownership.sessionId
        && record.binding.gatewayNodeId === ownership.gatewayNodeId
        && record.binding.assignmentEpoch === ownership.assignmentEpoch
        && record.binding.desiredState === "active"
        && record.gatewayNode.id === ownership.gatewayNodeId
        && record.gatewayNode.status === "online"
    );
}

export async function validateDeviceTunnelRuntimeOwnership(args: {
    db: RuntimeOwnershipDb;
    ownership: DeviceTunnelRuntimeOwnership;
    now?: Date;
}) {
    const ownership = validateDeviceTunnelRuntimeOwnershipDescriptor(args.ownership);
    const record = await args.db.deviceTunnelSessionLease.findUnique({
        where: { sessionId: ownership.sessionId },
        include: {
            session: { select: { locationId: true } },
            binding: {
                select: {
                    id: true,
                    locationId: true,
                    sessionId: true,
                    gatewayNodeId: true,
                    assignmentEpoch: true,
                    desiredState: true,
                },
            },
            gatewayNode: { select: { id: true, status: true } },
        },
    });
    return isDeviceTunnelRuntimeOwnershipRecordValid({ ownership, record, now: args.now });
}

export class RuntimeLeaseRenewalFence {
    private missedRenewals = 0;
    private acceptingWork = true;

    constructor(
        private readonly maximumMissedRenewals = 2,
        private readonly onMissedRenewalFence?: () => void,
    ) {
        if (!Number.isSafeInteger(maximumMissedRenewals) || maximumMissedRenewals < 1) {
            throw new Error("Runtime lease missed-renewal limit must be a positive integer");
        }
    }

    recordSuccess() {
        if (!this.acceptingWork) return false;
        this.missedRenewals = 0;
        return true;
    }

    recordFailure() {
        if (!this.acceptingWork) return false;
        this.missedRenewals += 1;
        if (this.missedRenewals >= this.maximumMissedRenewals) {
            this.acceptingWork = false;
            this.onMissedRenewalFence?.();
        }
        return this.acceptingWork;
    }

    fence() {
        this.acceptingWork = false;
    }

    get canAcceptWork() {
        return this.acceptingWork;
    }

    get consecutiveMissedRenewals() {
        return this.missedRenewals;
    }
}
