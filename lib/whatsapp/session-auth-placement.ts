import { randomUUID } from "node:crypto";
import { isDeviceTunnelRuntimeLeaseEnforcementActive, type DeviceTunnelRuntimeOwnership } from "../device-tunnel/runtime-ownership";

export const WHATSAPP_SESSION_AUTH_MODE_FLAG = "WHATSAPP_SESSION_AUTH_MODE";
export const ENCRYPTED_SESSION_AUTH_MODE = "encrypted_snapshot";
export const LOCAL_SESSION_AUTH_MODE = "local";
export const DEFAULT_SESSION_AUTH_ATTACH_TIMEOUT_MS = 120_000;
export const DEFAULT_SESSION_AUTH_DETACH_TIMEOUT_MS = 180_000;

export type SessionAuthPlacementState =
    | "detached"
    | "attaching"
    | "attached"
    | "detaching"
    | "recovering"
    | "quarantined"
    | "relink_required";

export type SessionAuthPlacementRecord = {
    id: string;
    locationId: string;
    sessionId: string;
    bindingId: string;
    provider: string;
    state: SessionAuthPlacementState;
    gatewayNodeId: string | null;
    assignmentEpoch: number;
    ownerInstanceId: string | null;
    leaseEpoch: number;
    authEpoch: number;
    operationId: string | null;
    operationStartedAt: Date | null;
    operationDeadlineAt: Date | null;
    currentGeneration: number;
    lastKnownGoodGeneration: number;
    recoveryStatus: string;
    lastErrorCode: string | null;
};

function positiveSafeInteger(value: number, label: string) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive safe integer`);
}

function nonNegativeSafeInteger(value: number, label: string) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative safe integer`);
}

function boundedDeadline(now: Date, timeoutMs: number) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 15 * 60_000) {
        throw new Error("Session-auth operation timeout is outside the allowed bounds");
    }
    return new Date(now.getTime() + timeoutMs);
}

function validateOwnershipForPlacement(placement: SessionAuthPlacementRecord, ownership: DeviceTunnelRuntimeOwnership) {
    if (
        placement.locationId !== ownership.locationId
        || placement.sessionId !== ownership.sessionId
        || placement.bindingId !== ownership.bindingId
    ) {
        throw new Error("Session-auth placement tenant, session, or binding scope does not match runtime ownership");
    }
    positiveSafeInteger(ownership.assignmentEpoch, "Assignment epoch");
    positiveSafeInteger(ownership.leaseEpoch, "Lease epoch");
    if (!ownership.bindingId || !ownership.gatewayNodeId || !ownership.ownerInstanceId) {
        throw new Error("Session-auth runtime ownership scope is incomplete");
    }
}

function assertOperationOwnership(args: {
    placement: SessionAuthPlacementRecord;
    ownership: DeviceTunnelRuntimeOwnership;
    authEpoch: number;
    operationId: string;
    state: SessionAuthPlacementState;
}) {
    const { placement, ownership } = args;
    validateOwnershipForPlacement(placement, ownership);
    if (
        placement.state !== args.state
        || placement.gatewayNodeId !== ownership.gatewayNodeId
        || placement.assignmentEpoch !== ownership.assignmentEpoch
        || placement.ownerInstanceId !== ownership.ownerInstanceId
        || placement.leaseEpoch !== ownership.leaseEpoch
        || placement.authEpoch !== args.authEpoch
        || placement.operationId !== args.operationId
    ) {
        throw new Error("Session-auth operation was fenced by newer placement ownership");
    }
}

export function getWhatsAppSessionAuthMode(env: NodeJS.ProcessEnv = process.env) {
    const mode = String(env[WHATSAPP_SESSION_AUTH_MODE_FLAG] || LOCAL_SESSION_AUTH_MODE).trim().toLowerCase();
    if (mode !== LOCAL_SESSION_AUTH_MODE && mode !== ENCRYPTED_SESSION_AUTH_MODE) {
        throw new Error(`${WHATSAPP_SESSION_AUTH_MODE_FLAG} must be local or encrypted_snapshot`);
    }
    return mode;
}

export function isEncryptedWhatsAppSessionAuthActive(env: NodeJS.ProcessEnv = process.env) {
    return getWhatsAppSessionAuthMode(env) === ENCRYPTED_SESSION_AUTH_MODE
        && isDeviceTunnelRuntimeLeaseEnforcementActive(env);
}

export function validateEncryptedWhatsAppSessionAuthConfiguration(env: NodeJS.ProcessEnv = process.env) {
    const mode = getWhatsAppSessionAuthMode(env);
    if (mode === LOCAL_SESSION_AUTH_MODE) return { mode, active: false } as const;
    if (!isDeviceTunnelRuntimeLeaseEnforcementActive(env)) {
        throw new Error("Encrypted WhatsApp session auth requires distributed placement and runtime lease enforcement");
    }
    const kmsKeyPath = String(env.WHATSAPP_SESSION_AUTH_KMS_KEY_PATH || "").trim();
    const bucket = String(env.WHATSAPP_SESSION_AUTH_R2_BUCKET || "").trim();
    if (!/^projects\/[^/]+\/locations\/[a-zA-Z0-9_-]+\/keyRings\/[^/]+\/cryptoKeys\/[^/]+$/.test(kmsKeyPath)) {
        throw new Error("WHATSAPP_SESSION_AUTH_KMS_KEY_PATH is missing or invalid");
    }
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{1,126}[a-zA-Z0-9]$/.test(bucket)) {
        throw new Error("WHATSAPP_SESSION_AUTH_R2_BUCKET is missing or invalid");
    }
    return { mode, active: true, kmsKeyPath, bucket } as const;
}

export function beginSessionAuthAttach(args: {
    placement: SessionAuthPlacementRecord;
    ownership: DeviceTunnelRuntimeOwnership;
    now?: Date;
    timeoutMs?: number;
    operationId?: string;
}) {
    const { placement, ownership } = args;
    validateOwnershipForPlacement(placement, ownership);
    if (placement.provider !== "r2_encrypted_snapshot") throw new Error("Unsupported session-auth placement provider");
    if (placement.state !== "detached") throw new Error("Session-auth placement is not detached");
    nonNegativeSafeInteger(placement.authEpoch, "Auth epoch");
    const authEpoch = Math.max(placement.authEpoch + 1, ownership.assignmentEpoch, ownership.leaseEpoch);
    if (!Number.isSafeInteger(authEpoch)) throw new Error("Session-auth epoch is exhausted");
    const now = args.now || new Date();
    return {
        state: "attaching" as const,
        gatewayNodeId: ownership.gatewayNodeId,
        assignmentEpoch: ownership.assignmentEpoch,
        ownerInstanceId: ownership.ownerInstanceId,
        leaseEpoch: ownership.leaseEpoch,
        authEpoch,
        operationId: args.operationId || randomUUID(),
        operationStartedAt: now,
        operationDeadlineAt: boundedDeadline(now, args.timeoutMs ?? DEFAULT_SESSION_AUTH_ATTACH_TIMEOUT_MS),
        recoveryStatus: "healthy",
        lastErrorCode: null,
    };
}

export function completeSessionAuthAttach(args: {
    placement: SessionAuthPlacementRecord;
    ownership: DeviceTunnelRuntimeOwnership;
    authEpoch: number;
    operationId: string;
    now?: Date;
}) {
    assertOperationOwnership({ ...args, state: "attaching" });
    const now = args.now || new Date();
    if (!args.placement.operationDeadlineAt || args.placement.operationDeadlineAt <= now) {
        throw new Error("Session-auth attach deadline expired");
    }
    return {
        state: "attached" as const,
        operationId: null,
        operationStartedAt: null,
        operationDeadlineAt: null,
        lastAttachedAt: now,
        lastVerifiedAt: now,
        recoveryStatus: "healthy",
        lastErrorCode: null,
    };
}

export function beginSessionAuthDetach(args: {
    placement: SessionAuthPlacementRecord;
    ownership: DeviceTunnelRuntimeOwnership;
    now?: Date;
    timeoutMs?: number;
    operationId?: string;
}) {
    const { placement, ownership } = args;
    validateOwnershipForPlacement(placement, ownership);
    if (
        placement.state !== "attached"
        || placement.gatewayNodeId !== ownership.gatewayNodeId
        || placement.assignmentEpoch !== ownership.assignmentEpoch
        || placement.ownerInstanceId !== ownership.ownerInstanceId
        || placement.leaseEpoch !== ownership.leaseEpoch
    ) {
        throw new Error("Session-auth detach was fenced by newer placement ownership");
    }
    const now = args.now || new Date();
    return {
        state: "detaching" as const,
        operationId: args.operationId || randomUUID(),
        operationStartedAt: now,
        operationDeadlineAt: boundedDeadline(now, args.timeoutMs ?? DEFAULT_SESSION_AUTH_DETACH_TIMEOUT_MS),
    };
}

export function completeSessionAuthDetach(args: {
    placement: SessionAuthPlacementRecord;
    ownership: DeviceTunnelRuntimeOwnership;
    authEpoch: number;
    operationId: string;
    generation: number;
    now?: Date;
}) {
    assertOperationOwnership({ ...args, state: "detaching" });
    positiveSafeInteger(args.generation, "Session-auth generation");
    if (args.generation <= args.placement.currentGeneration) {
        throw new Error("Session-auth generation must increase monotonically");
    }
    const now = args.now || new Date();
    if (!args.placement.operationDeadlineAt || args.placement.operationDeadlineAt <= now) {
        throw new Error("Session-auth detach deadline expired");
    }
    return {
        state: "detached" as const,
        gatewayNodeId: null,
        ownerInstanceId: null,
        leaseEpoch: 0,
        operationId: null,
        operationStartedAt: null,
        operationDeadlineAt: null,
        currentGeneration: args.generation,
        lastKnownGoodGeneration: args.generation,
        lastDetachedAt: now,
        lastVerifiedAt: now,
        recoveryStatus: "healthy",
        lastErrorCode: null,
    };
}

export function fenceExpiredSessionAuthOperation(args: {
    placement: SessionAuthPlacementRecord;
    now?: Date;
    errorCode?: string;
}) {
    const { placement } = args;
    const now = args.now || new Date();
    if (!placement.operationId || !placement.operationDeadlineAt || placement.operationDeadlineAt > now) {
        throw new Error("Session-auth operation has not expired");
    }
    const authEpoch = placement.authEpoch + 1;
    positiveSafeInteger(authEpoch, "Auth epoch");
    return {
        state: "quarantined" as const,
        gatewayNodeId: null,
        ownerInstanceId: null,
        leaseEpoch: 0,
        authEpoch,
        operationId: null,
        operationStartedAt: null,
        operationDeadlineAt: null,
        recoveryStatus: "quarantined",
        lastErrorCode: String(args.errorCode || "operation_timeout").slice(0, 64),
    };
}
