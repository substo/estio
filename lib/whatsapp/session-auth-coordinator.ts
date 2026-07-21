import { mkdir, rm } from "node:fs/promises";
import type { DeviceTunnelRuntimeOwnership } from "../device-tunnel/runtime-ownership";
import {
    createQuiescedSessionAuthArchive,
    inspectSessionAuthArchive,
    restoreSessionAuthArchiveAtomically,
} from "./session-auth-archive";
import {
    decryptSessionAuthArchive,
    encryptSessionAuthArchive,
    type EncryptedSessionAuthArchive,
    type SessionAuthKeyWrapper,
} from "./session-auth-crypto";
import { buildSessionAuthObjectKey } from "./session-auth-object-store";
import {
    ensureSessionAuthProfileQuiescent,
    getLocalAuthProfilePath,
    inspectLocalAuthProfileState,
} from "./session-auth-profile";
import { SessionAuthPlacementStore } from "./session-auth-store";
import { selectSessionAuthGenerationsForDeletion } from "./session-auth-retention";

type ObjectStore = {
    putImmutable(args: { key: string; ciphertext: Buffer; ciphertextSha256: string }): Promise<{ etag: string | null; versionId: string | null }>;
    get(args: { key: string; maxBytes?: number }): Promise<Buffer>;
    deleteRetainedObject?(key: string): Promise<void>;
};

function safeSessionAuthError(code: string, message: string) {
    return Object.assign(new Error(message), { code });
}

function encryptedArchive(generation: any, ciphertext: Buffer): EncryptedSessionAuthArchive {
    return {
        ciphertext,
        metadata: {
            encryptionAlgorithm: generation.encryptionAlgorithm,
            formatVersion: generation.formatVersion,
            kmsKeyName: generation.kmsKeyName,
            encryptedDek: generation.encryptedDek,
            iv: generation.iv,
            authTag: generation.authTag,
            ciphertextSha256: generation.ciphertextSha256,
            plaintextSha256: generation.plaintextSha256,
            encryptedSize: Number(generation.encryptedSize),
            plaintextSize: Number(generation.plaintextSize),
        },
    };
}

export class WhatsAppSessionAuthCoordinator {
    constructor(private readonly dependencies: {
        store: SessionAuthPlacementStore;
        objectStore: ObjectStore;
        keyWrapper: SessionAuthKeyWrapper;
        kmsKeyName: string;
        dataPath: string;
    }) {}

    private profilePath(bridgeSessionId: string) {
        return getLocalAuthProfilePath(this.dependencies.dataPath, bridgeSessionId);
    }

    async attach(args: { ownership: DeviceTunnelRuntimeOwnership; bridgeSessionId: string }) {
        for (let recoveryAttempt = 0; recoveryAttempt < 8; recoveryAttempt += 1) {
            const claimed = await this.dependencies.store.claimAttach(args.ownership);
            const placement = claimed.placement;
            const profilePath = this.profilePath(args.bridgeSessionId);
            let preserveInitialProfile = false;
            try {
                await ensureSessionAuthProfileQuiescent({ profilePath, terminate: true });
                if (placement.currentGeneration === 0) {
                    const localProfileState = await inspectLocalAuthProfileState(profilePath);
                    preserveInitialProfile = localProfileState !== "missing";
                    if (localProfileState === "incomplete") {
                        throw safeSessionAuthError(
                            "SESSION_AUTH_LOCAL_PROFILE_INVALID",
                            "Existing local WhatsApp session auth profile is incomplete",
                        );
                    }
                    await mkdir(this.dependencies.dataPath, { recursive: true, mode: 0o700 });
                } else {
                    const generation = await this.dependencies.store.generation(placement.id, placement.currentGeneration)
                        .catch(() => null);
                    if (!generation || generation.status !== "verified") {
                        await this.dependencies.store.failOperation(placement, "generation_fetch_failed");
                        throw safeSessionAuthError("SESSION_AUTH_GENERATION_UNAVAILABLE", "Durable WhatsApp session auth is temporarily unavailable");
                    }
                    let ciphertext: Buffer;
                    try {
                        ciphertext = await this.dependencies.objectStore.get({ key: generation.objectKey });
                    } catch (error) {
                        await this.dependencies.store.failOperation(placement, "generation_fetch_failed");
                        throw safeSessionAuthError("SESSION_AUTH_FETCH_FAILED", "Durable WhatsApp session auth could not be fetched");
                    }
                    let plaintext: Buffer;
                    try {
                        plaintext = await decryptSessionAuthArchive({
                            archive: encryptedArchive(generation, ciphertext),
                            scope: {
                                placementId: placement.id,
                                locationId: placement.locationId,
                                sessionId: placement.sessionId,
                                generation: generation.generation,
                                authEpoch: generation.authEpoch,
                            },
                            keyWrapper: this.dependencies.keyWrapper,
                        });
                        await inspectSessionAuthArchive({ archive: plaintext });
                    } catch (error: any) {
                        await ensureSessionAuthProfileQuiescent({ profilePath, terminate: true }).catch(() => null);
                        await rm(profilePath, { recursive: true, force: true }).catch(() => null);
                        const recovery = await this.dependencies.store.quarantineAndSelectPrevious(
                            placement,
                            placement.currentGeneration,
                            "generation_integrity_failed",
                        );
                        if (recovery.previousGeneration) continue;
                        throw safeSessionAuthError("SESSION_AUTH_RELINK_REQUIRED", "Durable WhatsApp session auth requires relinking");
                    }
                    await mkdir(this.dependencies.dataPath, { recursive: true, mode: 0o700 });
                    await restoreSessionAuthArchiveAtomically({
                        archive: plaintext,
                        profilePath,
                        scratchRoot: this.dependencies.dataPath,
                    });
                }
                const attached = await this.dependencies.store.completeAttach(placement, args.ownership);
                return { placement: attached, profilePath, durableReady: attached.currentGeneration > 0 };
            } catch (error: any) {
                await ensureSessionAuthProfileQuiescent({ profilePath, terminate: true }).catch(() => null);
                if (!preserveInitialProfile) {
                    await rm(profilePath, { recursive: true, force: true }).catch(() => null);
                }
                await this.dependencies.store.failOperation(
                    placement,
                    placement.currentGeneration > 0 ? "generation_restore_failed" : "initial_attach_failed",
                ).catch(() => null);
                if (String(error?.code || "").startsWith("SESSION_AUTH_")) throw error;
                throw safeSessionAuthError("SESSION_AUTH_ATTACH_FAILED", "Durable WhatsApp session auth could not be attached");
            }
        }
        throw new Error("Durable WhatsApp session auth exhausted bounded recovery attempts");
    }

    async checkpointAndDetach(args: {
        placement: any;
        ownership: DeviceTunnelRuntimeOwnership;
        bridgeSessionId: string;
        quiesce: () => Promise<void>;
    }) {
        const claimed = await this.dependencies.store.claimDetach(args.placement.id, args.ownership);
        const profilePath = this.profilePath(args.bridgeSessionId);
        let unpublishedObjectKey: string | null = null;
        let checkpointPublished = false;
        try {
            await args.quiesce();
            await ensureSessionAuthProfileQuiescent({ profilePath, terminate: true });
            const plaintext = await createQuiescedSessionAuthArchive({ profilePath });
            const generation = claimed.currentGeneration + 1;
            const archive = await encryptSessionAuthArchive({
                plaintext,
                scope: {
                    placementId: claimed.id,
                    locationId: claimed.locationId,
                    sessionId: claimed.sessionId,
                    generation,
                    authEpoch: claimed.authEpoch,
                },
                kmsKeyName: this.dependencies.kmsKeyName,
                keyWrapper: this.dependencies.keyWrapper,
            });
            const objectKey = buildSessionAuthObjectKey(claimed.id, generation);
            unpublishedObjectKey = objectKey;
            const uploaded = await this.dependencies.objectStore.putImmutable({
                key: objectKey,
                ciphertext: archive.ciphertext,
                ciphertextSha256: archive.metadata.ciphertextSha256,
            });
            const readBack = await this.dependencies.objectStore.get({ key: objectKey });
            const verifiedPlaintext = await decryptSessionAuthArchive({
                archive: { ...archive, ciphertext: readBack },
                scope: {
                    placementId: claimed.id,
                    locationId: claimed.locationId,
                    sessionId: claimed.sessionId,
                    generation,
                    authEpoch: claimed.authEpoch,
                },
                keyWrapper: this.dependencies.keyWrapper,
            });
            await inspectSessionAuthArchive({ archive: verifiedPlaintext });
            const detached = await this.dependencies.store.publishCheckpoint({
                placement: claimed,
                ownership: args.ownership,
                generation,
                objectKey,
                objectVersionId: uploaded.versionId,
                objectEtag: uploaded.etag,
                archive,
            });
            checkpointPublished = true;
            await rm(profilePath, { recursive: true, force: true });
            void this.pruneRetainedGenerations(detached.id).catch(() => null);
            return detached;
        } catch (error) {
            if (!checkpointPublished && unpublishedObjectKey && this.dependencies.objectStore.deleteRetainedObject) {
                await this.dependencies.objectStore.deleteRetainedObject(unpublishedObjectKey).catch(() => null);
            }
            await ensureSessionAuthProfileQuiescent({ profilePath, terminate: true }).catch(() => null);
            await rm(profilePath, { recursive: true, force: true }).catch(() => null);
            await this.dependencies.store.failOperation(claimed, "checkpoint_failed").catch(() => null);
            throw safeSessionAuthError("SESSION_AUTH_CHECKPOINT_FAILED", "Durable WhatsApp session auth checkpoint failed");
        }
    }

    async discardLocalProfile(bridgeSessionId: string) {
        const profilePath = this.profilePath(bridgeSessionId);
        await ensureSessionAuthProfileQuiescent({ profilePath, terminate: true });
        await rm(profilePath, { recursive: true, force: true });
    }

    async requireRelink(placementId: string, bridgeSessionId: string) {
        await this.discardLocalProfile(bridgeSessionId);
        return this.dependencies.store.requireRelink(placementId);
    }

    async abandonUndurableProfile(placement: any, bridgeSessionId: string) {
        await this.discardLocalProfile(bridgeSessionId);
        return this.dependencies.store.failOperation(placement, "initial_profile_abandoned");
    }

    async detachWithoutCheckpoint(args: {
        placement: any;
        ownership: DeviceTunnelRuntimeOwnership;
        bridgeSessionId: string;
    }) {
        await this.discardLocalProfile(args.bridgeSessionId);
        return this.dependencies.store.detachWithoutCheckpoint(
            args.placement.id,
            args.ownership,
            "unhealthy_profile_discarded",
        );
    }

    async rollbackToPrevious(placementId: string, ownership: DeviceTunnelRuntimeOwnership) {
        return this.dependencies.store.rollbackToPrevious(placementId, ownership);
    }

    async pruneRetainedGenerations(placementId: string) {
        if (!this.dependencies.objectStore.deleteRetainedObject) return 0;
        const { placement, generations } = await this.dependencies.store.retentionCandidates(placementId);
        const deletable = selectSessionAuthGenerationsForDeletion({
            generations,
            currentGeneration: placement.currentGeneration,
            lastKnownGoodGeneration: placement.lastKnownGoodGeneration,
        });
        for (const generation of deletable) {
            if (!await this.dependencies.store.claimGenerationDeletion(placementId, generation.generation)) continue;
            await this.dependencies.objectStore.deleteRetainedObject(generation.objectKey);
            await this.dependencies.store.markGenerationDeleted(placementId, generation.generation);
        }
        return deletable.length;
    }
}
