import { randomUUID } from "node:crypto";
import type { DeviceTunnelRuntimeOwnership } from "../device-tunnel/runtime-ownership";
import { validateDeviceTunnelRuntimeOwnership } from "../device-tunnel/runtime-ownership";
import {
    beginSessionAuthAttach,
    beginSessionAuthDetach,
    completeSessionAuthAttach,
    completeSessionAuthDetach,
    type SessionAuthPlacementRecord,
} from "./session-auth-placement";
import type { EncryptedSessionAuthArchive } from "./session-auth-crypto";

type DbLike = any;

function record(value: any): SessionAuthPlacementRecord {
    if (!value) throw new Error("Session-auth placement does not exist");
    return value as SessionAuthPlacementRecord;
}

function auditData(placement: SessionAuthPlacementRecord, eventType: string, outcome: string, generation?: number, errorCode?: string) {
    return {
        placementId: placement.id,
        locationId: placement.locationId,
        sessionId: placement.sessionId,
        bindingId: placement.bindingId,
        eventType,
        outcome,
        gatewayNodeId: placement.gatewayNodeId,
        assignmentEpoch: placement.assignmentEpoch,
        leaseEpoch: placement.leaseEpoch,
        authEpoch: placement.authEpoch,
        operationId: placement.operationId,
        generation: generation || null,
        errorCode: errorCode ? errorCode.slice(0, 64) : null,
    };
}

export class SessionAuthPlacementStore {
    constructor(private readonly db: DbLike) {}

    private transaction<T>(callback: (tx: DbLike) => Promise<T>) {
        return this.db.$transaction(callback, { isolationLevel: "Serializable" });
    }

    async claimAttach(ownership: DeviceTunnelRuntimeOwnership) {
        return this.transaction(async (tx) => {
            if (!await validateDeviceTunnelRuntimeOwnership({ db: tx, ownership })) {
                throw new Error("Session-auth attach runtime ownership is not authoritative");
            }
            let placement = record(await tx.whatsAppSessionAuthPlacement.upsert({
                where: { sessionId: ownership.sessionId },
                create: {
                    locationId: ownership.locationId,
                    sessionId: ownership.sessionId,
                    bindingId: ownership.bindingId,
                },
                update: {},
            }));
            if (placement.locationId !== ownership.locationId || placement.bindingId !== ownership.bindingId) {
                throw new Error("Session-auth placement scope conflicts with authoritative ownership");
            }
            if (placement.state !== "detached") {
                if (placement.state === "relink_required") {
                    placement = record(await tx.whatsAppSessionAuthPlacement.update({
                        where: { id: placement.id },
                        data: { state: "detached", currentGeneration: 0, lastKnownGoodGeneration: 0 },
                    }));
                } else {
                    const priorOwnership = placement.gatewayNodeId && placement.ownerInstanceId && placement.leaseEpoch > 0
                        ? {
                            locationId: placement.locationId, sessionId: placement.sessionId, bindingId: placement.bindingId,
                            gatewayNodeId: placement.gatewayNodeId, assignmentEpoch: placement.assignmentEpoch,
                            ownerInstanceId: placement.ownerInstanceId, leaseEpoch: placement.leaseEpoch,
                        }
                        : null;
                    if (priorOwnership && await validateDeviceTunnelRuntimeOwnership({ db: tx, ownership: priorOwnership })) {
                        throw new Error("Session-auth placement is still owned by an authoritative runtime lease");
                    }
                    const canRestore = placement.currentGeneration > 0;
                    placement = record(await tx.whatsAppSessionAuthPlacement.update({
                        where: { id: placement.id },
                        data: {
                            state: canRestore ? "detached" : "relink_required",
                            gatewayNodeId: null, ownerInstanceId: null, leaseEpoch: 0,
                            authEpoch: placement.authEpoch + 1,
                            operationId: null, operationStartedAt: null, operationDeadlineAt: null,
                            recoveryStatus: canRestore ? "restoring_previous" : "relink_required",
                            lastErrorCode: "stale_owner_fenced",
                        },
                    }));
                    await tx.whatsAppSessionAuthAuditEvent.create({
                        data: auditData(placement, "stale_owner_fenced", canRestore ? "fallback" : "relink_required", undefined, "stale_owner_fenced"),
                    });
                    if (!canRestore) {
                        placement = record(await tx.whatsAppSessionAuthPlacement.update({
                            where: { id: placement.id }, data: { state: "detached" },
                        }));
                    }
                }
            }
            const transition = beginSessionAuthAttach({ placement, ownership });
            const changed = await tx.whatsAppSessionAuthPlacement.updateMany({
                where: { id: placement.id, state: "detached", authEpoch: placement.authEpoch, currentGeneration: placement.currentGeneration },
                data: transition,
            });
            if (changed.count !== 1) throw new Error("Session-auth attach lost the single-writer race");
            placement = record(await tx.whatsAppSessionAuthPlacement.findUnique({ where: { id: placement.id } }));
            await tx.whatsAppSessionAuthAuditEvent.create({ data: auditData(placement, "attach_claimed", "success") });
            return { placement, alreadyAttached: false };
        });
    }

    async completeAttach(placement: SessionAuthPlacementRecord, ownership: DeviceTunnelRuntimeOwnership) {
        return this.transaction(async (tx) => {
            const current = record(await tx.whatsAppSessionAuthPlacement.findUnique({ where: { id: placement.id } }));
            const transition = completeSessionAuthAttach({
                placement: current,
                ownership,
                authEpoch: placement.authEpoch,
                operationId: String(placement.operationId),
            });
            const changed = await tx.whatsAppSessionAuthPlacement.updateMany({
                where: { id: current.id, state: "attaching", authEpoch: placement.authEpoch, operationId: placement.operationId },
                data: transition,
            });
            if (changed.count !== 1) throw new Error("Session-auth attach completion was fenced");
            const completed = record({ ...current, ...transition });
            await tx.whatsAppSessionAuthAuditEvent.create({ data: auditData(completed, "attach_completed", "success", completed.currentGeneration || undefined) });
            return completed;
        });
    }

    async claimDetach(placementId: string, ownership: DeviceTunnelRuntimeOwnership) {
        return this.transaction(async (tx) => {
            if (!await validateDeviceTunnelRuntimeOwnership({ db: tx, ownership })) {
                throw new Error("Session-auth detach runtime ownership is not authoritative");
            }
            const placement = record(await tx.whatsAppSessionAuthPlacement.findUnique({ where: { id: placementId } }));
            const transition = beginSessionAuthDetach({ placement, ownership });
            const changed = await tx.whatsAppSessionAuthPlacement.updateMany({
                where: {
                    id: placement.id, state: "attached", gatewayNodeId: ownership.gatewayNodeId,
                    assignmentEpoch: ownership.assignmentEpoch, ownerInstanceId: ownership.ownerInstanceId,
                    leaseEpoch: ownership.leaseEpoch, authEpoch: placement.authEpoch,
                },
                data: transition,
            });
            if (changed.count !== 1) throw new Error("Session-auth detach lost the single-writer race");
            const claimed = record({ ...placement, ...transition });
            await tx.whatsAppSessionAuthAuditEvent.create({ data: auditData(claimed, "detach_claimed", "success") });
            return claimed;
        });
    }

    async publishCheckpoint(args: {
        placement: SessionAuthPlacementRecord;
        ownership: DeviceTunnelRuntimeOwnership;
        generation: number;
        objectKey: string;
        objectVersionId: string | null;
        objectEtag: string | null;
        archive: EncryptedSessionAuthArchive;
    }) {
        return this.transaction(async (tx) => {
            const current = record(await tx.whatsAppSessionAuthPlacement.findUnique({ where: { id: args.placement.id } }));
            const transition = completeSessionAuthDetach({
                placement: current,
                ownership: args.ownership,
                authEpoch: args.placement.authEpoch,
                operationId: String(args.placement.operationId),
                generation: args.generation,
            });
            if (current.lastKnownGoodGeneration > 0) {
                await tx.whatsAppSessionAuthGeneration.updateMany({
                    where: { placementId: current.id, generation: current.lastKnownGoodGeneration, status: "verified" },
                    data: { status: "retired", retentionUntil: new Date(Date.now() + 30 * 86_400_000) },
                });
            }
            await tx.whatsAppSessionAuthGeneration.create({ data: {
                placementId: current.id,
                sessionId: current.sessionId,
                generation: args.generation,
                authEpoch: current.authEpoch,
                status: "verified",
                objectKey: args.objectKey,
                objectVersionId: args.objectVersionId,
                objectEtag: args.objectEtag,
                encryptedSize: BigInt(args.archive.metadata.encryptedSize),
                plaintextSize: BigInt(args.archive.metadata.plaintextSize),
                ciphertextSha256: args.archive.metadata.ciphertextSha256,
                plaintextSha256: args.archive.metadata.plaintextSha256,
                encryptionAlgorithm: args.archive.metadata.encryptionAlgorithm,
                kmsKeyName: args.archive.metadata.kmsKeyName,
                encryptedDek: args.archive.metadata.encryptedDek,
                iv: args.archive.metadata.iv,
                authTag: args.archive.metadata.authTag,
                formatVersion: args.archive.metadata.formatVersion,
                verifiedAt: new Date(),
            }});
            const changed = await tx.whatsAppSessionAuthPlacement.updateMany({
                where: { id: current.id, state: "detaching", authEpoch: current.authEpoch, operationId: current.operationId },
                data: transition,
            });
            if (changed.count !== 1) throw new Error("Session-auth checkpoint publication was fenced");
            const completed = record({ ...current, ...transition });
            await tx.whatsAppSessionAuthAuditEvent.create({ data: auditData(completed, "checkpoint_published", "success", args.generation) });
            return completed;
        });
    }

    async generation(placementId: string, generation: number) {
        return this.db.whatsAppSessionAuthGeneration.findUnique({
            where: { placementId_generation: { placementId, generation } },
        });
    }

    async quarantineAndSelectPrevious(placement: SessionAuthPlacementRecord, generation: number, errorCode: string) {
        return this.transaction(async (tx) => {
            const current = record(await tx.whatsAppSessionAuthPlacement.findUnique({ where: { id: placement.id } }));
            if (current.authEpoch !== placement.authEpoch || current.state !== "attaching") {
                throw new Error("Session-auth corruption recovery was fenced");
            }
            await tx.whatsAppSessionAuthGeneration.updateMany({
                where: { placementId: current.id, generation, status: "verified" },
                data: { status: "quarantined", quarantinedAt: new Date(), errorCode: errorCode.slice(0, 64) },
            });
            const previous = await tx.whatsAppSessionAuthGeneration.findFirst({
                where: { placementId: current.id, status: { in: ["verified", "retired"] }, generation: { lt: generation } },
                orderBy: { generation: "desc" },
            });
            if (previous) {
                await tx.whatsAppSessionAuthGeneration.update({
                    where: { id: previous.id }, data: { status: "verified", errorCode: null },
                });
            }
            const authEpoch = current.authEpoch + 1;
            const state = previous ? "detached" : "relink_required";
            const updated = record(await tx.whatsAppSessionAuthPlacement.update({
                where: { id: current.id },
                data: {
                    state, gatewayNodeId: null, ownerInstanceId: null, leaseEpoch: 0, authEpoch,
                    operationId: null, operationStartedAt: null, operationDeadlineAt: null,
                    currentGeneration: previous?.generation || 0,
                    lastKnownGoodGeneration: previous?.generation || 0,
                    recoveryStatus: previous ? "restoring_previous" : "relink_required",
                    lastErrorCode: errorCode.slice(0, 64),
                },
            }));
            await tx.whatsAppSessionAuthAuditEvent.create({ data: auditData(updated, "generation_quarantined", previous ? "fallback" : "relink_required", generation, errorCode) });
            return { placement: updated, previousGeneration: previous?.generation || null };
        });
    }

    async failOperation(placement: SessionAuthPlacementRecord, errorCode: string) {
        return this.transaction(async (tx) => {
            const current = record(await tx.whatsAppSessionAuthPlacement.findUnique({ where: { id: placement.id } }));
            if (current.authEpoch !== placement.authEpoch || current.operationId !== placement.operationId) return current;
            const canRestore = current.currentGeneration > 0;
            const updated = record(await tx.whatsAppSessionAuthPlacement.update({
                where: { id: current.id },
                data: {
                    state: canRestore ? "detached" : "relink_required",
                    gatewayNodeId: null, ownerInstanceId: null, leaseEpoch: 0,
                    authEpoch: current.authEpoch + 1,
                    operationId: null, operationStartedAt: null, operationDeadlineAt: null,
                    recoveryStatus: canRestore ? "restoring_previous" : "relink_required",
                    lastErrorCode: errorCode.slice(0, 64),
                },
            }));
            await tx.whatsAppSessionAuthAuditEvent.create({ data: auditData(updated, "operation_failed", "fenced", undefined, errorCode) });
            return updated;
        });
    }

    async detachWithoutCheckpoint(
        placementId: string,
        ownership: DeviceTunnelRuntimeOwnership,
        errorCode = "unhealthy_profile_discarded",
    ) {
        return this.transaction(async (tx) => {
            if (!await validateDeviceTunnelRuntimeOwnership({ db: tx, ownership })) {
                throw new Error("Session-auth discard runtime ownership is not authoritative");
            }
            const current = record(await tx.whatsAppSessionAuthPlacement.findUnique({ where: { id: placementId } }));
            if (
                current.state !== "attached"
                || current.locationId !== ownership.locationId
                || current.sessionId !== ownership.sessionId
                || current.bindingId !== ownership.bindingId
                || current.gatewayNodeId !== ownership.gatewayNodeId
                || current.assignmentEpoch !== ownership.assignmentEpoch
                || current.ownerInstanceId !== ownership.ownerInstanceId
                || current.leaseEpoch !== ownership.leaseEpoch
            ) throw new Error("Session-auth discard requires an exactly scoped attached placement");
            const safeErrorCode = errorCode.slice(0, 64);
            const updated = record(await tx.whatsAppSessionAuthPlacement.update({
                where: { id: current.id },
                data: {
                    state: current.currentGeneration > 0 ? "detached" : "relink_required",
                    gatewayNodeId: null,
                    ownerInstanceId: null,
                    leaseEpoch: 0,
                    authEpoch: current.authEpoch + 1,
                    operationId: null,
                    operationStartedAt: null,
                    operationDeadlineAt: null,
                    recoveryStatus: current.currentGeneration > 0 ? "restoring_previous" : "relink_required",
                    lastErrorCode: safeErrorCode,
                },
            }));
            await tx.whatsAppSessionAuthAuditEvent.create({
                data: auditData(updated, "checkpoint_skipped", "fenced", undefined, safeErrorCode),
            });
            return updated;
        });
    }

    async requireRelink(placementId: string, errorCode = "operator_clear") {
        return this.transaction(async (tx) => {
            const current = record(await tx.whatsAppSessionAuthPlacement.findUnique({ where: { id: placementId } }));
            const updated = record(await tx.whatsAppSessionAuthPlacement.update({
                where: { id: current.id },
                data: {
                    state: "relink_required", gatewayNodeId: null, ownerInstanceId: null, leaseEpoch: 0,
                    authEpoch: current.authEpoch + 1, operationId: null, operationStartedAt: null,
                    operationDeadlineAt: null, currentGeneration: 0, lastKnownGoodGeneration: 0,
                    recoveryStatus: "relink_required", lastErrorCode: errorCode,
                },
            }));
            await tx.whatsAppSessionAuthAuditEvent.create({ data: auditData(updated, "relink_required", "success", undefined, errorCode) });
            return updated;
        });
    }

    async rollbackToPrevious(placementId: string, ownership: DeviceTunnelRuntimeOwnership) {
        return this.transaction(async (tx) => {
            if (!await validateDeviceTunnelRuntimeOwnership({ db: tx, ownership })) {
                throw new Error("Session-auth rollback runtime ownership is not authoritative");
            }
            const current = record(await tx.whatsAppSessionAuthPlacement.findUnique({ where: { id: placementId } }));
            if (
                current.state !== "detached"
                || current.locationId !== ownership.locationId
                || current.sessionId !== ownership.sessionId
                || current.bindingId !== ownership.bindingId
            ) throw new Error("Session-auth rollback requires an exactly scoped detached placement");
            const previous = await tx.whatsAppSessionAuthGeneration.findFirst({
                where: {
                    placementId,
                    generation: { lt: current.currentGeneration },
                    status: { in: ["verified", "retired"] },
                },
                orderBy: { generation: "desc" },
            });
            if (!previous) throw new Error("No older verified session-auth generation is available");
            await tx.whatsAppSessionAuthGeneration.updateMany({
                where: { placementId, generation: current.currentGeneration, status: "verified" },
                data: { status: "retired", retentionUntil: new Date(Date.now() + 30 * 86_400_000) },
            });
            await tx.whatsAppSessionAuthGeneration.update({
                where: { id: previous.id }, data: { status: "verified", errorCode: null },
            });
            const updated = record(await tx.whatsAppSessionAuthPlacement.update({
                where: { id: placementId },
                data: {
                    currentGeneration: previous.generation,
                    lastKnownGoodGeneration: previous.generation,
                    authEpoch: current.authEpoch + 1,
                    recoveryStatus: "restoring_previous",
                    lastErrorCode: "operator_rollback",
                },
            }));
            await tx.whatsAppSessionAuthAuditEvent.create({
                data: auditData(updated, "operator_rollback", "success", previous.generation, "operator_rollback"),
            });
            return updated;
        });
    }

    async retentionCandidates(placementId: string) {
        const placement = record(await this.db.whatsAppSessionAuthPlacement.findUnique({ where: { id: placementId } }));
        const generations = await this.db.whatsAppSessionAuthGeneration.findMany({
            where: { placementId, status: { not: "deleted" } }, orderBy: { generation: "desc" },
        });
        return { placement, generations };
    }

    async claimGenerationDeletion(placementId: string, generation: number) {
        return this.transaction(async (tx) => {
            const placement = record(await tx.whatsAppSessionAuthPlacement.findUnique({ where: { id: placementId } }));
            if (placement.currentGeneration === generation || placement.lastKnownGoodGeneration === generation) return false;
            const changed = await tx.whatsAppSessionAuthGeneration.updateMany({
                where: { placementId, generation, status: { in: ["verified", "retired", "quarantined"] } },
                data: { status: "retired" },
            });
            return changed.count === 1;
        });
    }

    async markGenerationDeleted(placementId: string, generation: number) {
        const changed = await this.db.whatsAppSessionAuthGeneration.updateMany({
            where: { placementId, generation, status: "retired" }, data: { status: "deleted" },
        });
        if (changed.count !== 1) throw new Error("Session-auth generation deletion bookkeeping was fenced");
    }
}
