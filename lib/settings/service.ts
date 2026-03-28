import { Prisma, type SettingsAuditOperation } from "@prisma/client";
import { isDeepStrictEqual } from "node:util";
import db from "@/lib/db";
import type { SettingsDomain, SettingsSecretKey } from "./constants";
import { validateSettingsPayload } from "./schemas";
import {
    decryptSettingsSecretValue,
    encryptSettingsSecretValue,
    reEncryptSettingsSecretValue,
    type SettingsScope,
} from "./crypto";
import { SettingsVersionConflictError } from "./errors";
import { getSettingsPrimaryKeyId } from "./keyring";

type TxClient = Prisma.TransactionClient;

type UpsertDocumentInput<T> = {
    scopeType: SettingsScope;
    scopeId: string;
    domain: SettingsDomain;
    payload: T;
    actorUserId?: string | null;
    expectedVersion?: number | null;
    schemaVersion?: number;
    requestId?: string | null;
    tx?: TxClient;
};

type SecretInput = {
    scopeType: SettingsScope;
    scopeId: string;
    domain: SettingsDomain;
    secretKey: SettingsSecretKey | string;
    actorUserId?: string | null;
    requestId?: string | null;
    tx?: TxClient;
};

type RotateSecretsInput = {
    scopeType?: SettingsScope;
    scopeId?: string;
    domain?: SettingsDomain;
    batchSize?: number;
    actorUserId?: string | null;
};

async function withOptionalTransaction<T>(
    tx: TxClient | undefined,
    action: (txn: TxClient) => Promise<T>
): Promise<T> {
    if (tx) {
        return action(tx);
    }
    return db.$transaction(action);
}

function ensureExpectedVersion(
    existingVersion: number | null,
    expectedVersion?: number | null
) {
    if (expectedVersion === undefined || expectedVersion === null) return;

    const actual = existingVersion ?? 0;
    if (actual !== expectedVersion) {
        throw new SettingsVersionConflictError(expectedVersion, actual);
    }
}

function secretAuditShape(secret: {
    keyId: string;
    alg: string;
    encryptedAt: Date;
}) {
    return {
        hasValue: true,
        keyId: secret.keyId,
        alg: secret.alg,
        encryptedAt: secret.encryptedAt.toISOString(),
    };
}

async function createAuditLog(
    tx: TxClient,
    input: {
        actorUserId?: string | null;
        scopeType: SettingsScope;
        scopeId: string;
        domain: SettingsDomain;
        operation: SettingsAuditOperation;
        beforeJson?: Prisma.InputJsonValue | null;
        afterJson?: Prisma.InputJsonValue | null;
        requestId?: string | null;
    }
) {
    const normalizeJsonInput = (
        value: Prisma.InputJsonValue | null | undefined
    ): Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue | undefined => {
        if (value === undefined) return undefined;
        if (value === null) return Prisma.DbNull;
        return value;
    };

    await tx.settingsAuditLog.create({
        data: {
            actorUserId: input.actorUserId ?? null,
            scopeType: input.scopeType,
            scopeId: input.scopeId,
            domain: input.domain,
            operation: input.operation,
            beforeJson: normalizeJsonInput(input.beforeJson),
            afterJson: normalizeJsonInput(input.afterJson),
            requestId: input.requestId ?? null,
        },
    });
}

export class SettingsService {
    async getDocument<T>(input: {
        scopeType: SettingsScope;
        scopeId: string;
        domain: SettingsDomain;
    }): Promise<{ payload: T; version: number; schemaVersion: number } | null> {
        const doc = await db.settingsDocument.findUnique({
            where: {
                scopeType_scopeId_domain: {
                    scopeType: input.scopeType,
                    scopeId: input.scopeId,
                    domain: input.domain,
                },
            },
        });
        if (!doc) return null;
        return {
            payload: doc.payload as T,
            version: doc.version,
            schemaVersion: doc.schemaVersion,
        };
    }

    async upsertDocument<T>(input: UpsertDocumentInput<T>) {
        return withOptionalTransaction(input.tx, async (tx) => {
            const normalizedPayload = validateSettingsPayload(input.domain, input.payload);
            const existing = await tx.settingsDocument.findUnique({
                where: {
                    scopeType_scopeId_domain: {
                        scopeType: input.scopeType,
                        scopeId: input.scopeId,
                        domain: input.domain,
                    },
                },
            });

            ensureExpectedVersion(existing?.version ?? null, input.expectedVersion);
            const nextVersion = (existing?.version ?? 0) + 1;

            const saved = await tx.settingsDocument.upsert({
                where: {
                    scopeType_scopeId_domain: {
                        scopeType: input.scopeType,
                        scopeId: input.scopeId,
                        domain: input.domain,
                    },
                },
                create: {
                    scopeType: input.scopeType,
                    scopeId: input.scopeId,
                    domain: input.domain,
                    payload: normalizedPayload as Prisma.InputJsonValue,
                    version: 1,
                    schemaVersion: input.schemaVersion ?? 1,
                },
                update: {
                    payload: normalizedPayload as Prisma.InputJsonValue,
                    version: nextVersion,
                    schemaVersion: input.schemaVersion ?? 1,
                },
            });

            await createAuditLog(tx, {
                actorUserId: input.actorUserId,
                scopeType: input.scopeType,
                scopeId: input.scopeId,
                domain: input.domain,
                operation: "UPSERT",
                beforeJson: existing?.payload as Prisma.InputJsonValue | null,
                afterJson: saved.payload as Prisma.InputJsonValue,
                requestId: input.requestId,
            });

            return saved;
        });
    }

    async deleteDocument(input: {
        scopeType: SettingsScope;
        scopeId: string;
        domain: SettingsDomain;
        actorUserId?: string | null;
        requestId?: string | null;
        tx?: TxClient;
    }) {
        return withOptionalTransaction(input.tx, async (tx) => {
            const existing = await tx.settingsDocument.findUnique({
                where: {
                    scopeType_scopeId_domain: {
                        scopeType: input.scopeType,
                        scopeId: input.scopeId,
                        domain: input.domain,
                    },
                },
            });
            if (!existing) return null;

            await tx.settingsDocument.delete({
                where: {
                    scopeType_scopeId_domain: {
                        scopeType: input.scopeType,
                        scopeId: input.scopeId,
                        domain: input.domain,
                    },
                },
            });

            await createAuditLog(tx, {
                actorUserId: input.actorUserId,
                scopeType: input.scopeType,
                scopeId: input.scopeId,
                domain: input.domain,
                operation: "DELETE",
                beforeJson: existing.payload as Prisma.InputJsonValue,
                requestId: input.requestId,
            });

            return existing;
        });
    }

    async setSecret(input: SecretInput & { plaintext: string }) {
        return withOptionalTransaction(input.tx, async (tx) => {
            const encrypted = await encryptSettingsSecretValue({
                scopeType: input.scopeType,
                scopeId: input.scopeId,
                domain: input.domain,
                secretKey: input.secretKey,
                plaintext: input.plaintext,
            });

            const existing = await tx.settingsSecret.findUnique({
                where: {
                    scopeType_scopeId_domain_secretKey: {
                        scopeType: input.scopeType,
                        scopeId: input.scopeId,
                        domain: input.domain,
                        secretKey: input.secretKey,
                    },
                },
            });

            const saved = await tx.settingsSecret.upsert({
                where: {
                    scopeType_scopeId_domain_secretKey: {
                        scopeType: input.scopeType,
                        scopeId: input.scopeId,
                        domain: input.domain,
                        secretKey: input.secretKey,
                    },
                },
                create: {
                    scopeType: input.scopeType,
                    scopeId: input.scopeId,
                    domain: input.domain,
                    secretKey: input.secretKey,
                    ciphertext: encrypted.ciphertext,
                    iv: encrypted.iv,
                    authTag: encrypted.authTag,
                    alg: encrypted.alg,
                    keyId: encrypted.keyId,
                    encryptedDek: encrypted.encryptedDek ?? null,
                    encryptedAt: encrypted.encryptedAt,
                },
                update: {
                    ciphertext: encrypted.ciphertext,
                    iv: encrypted.iv,
                    authTag: encrypted.authTag,
                    alg: encrypted.alg,
                    keyId: encrypted.keyId,
                    encryptedDek: encrypted.encryptedDek ?? null,
                    encryptedAt: encrypted.encryptedAt,
                },
            });

            await createAuditLog(tx, {
                actorUserId: input.actorUserId,
                scopeType: input.scopeType,
                scopeId: input.scopeId,
                domain: input.domain,
                operation: "UPSERT",
                beforeJson: existing ? secretAuditShape(existing) : { hasValue: false },
                afterJson: secretAuditShape(saved),
                requestId: input.requestId,
            });

            return saved;
        });
    }

    async clearSecret(input: SecretInput) {
        return withOptionalTransaction(input.tx, async (tx) => {
            const existing = await tx.settingsSecret.findUnique({
                where: {
                    scopeType_scopeId_domain_secretKey: {
                        scopeType: input.scopeType,
                        scopeId: input.scopeId,
                        domain: input.domain,
                        secretKey: input.secretKey,
                    },
                },
            });
            if (!existing) return null;

            await tx.settingsSecret.delete({
                where: {
                    scopeType_scopeId_domain_secretKey: {
                        scopeType: input.scopeType,
                        scopeId: input.scopeId,
                        domain: input.domain,
                        secretKey: input.secretKey,
                    },
                },
            });

            await createAuditLog(tx, {
                actorUserId: input.actorUserId,
                scopeType: input.scopeType,
                scopeId: input.scopeId,
                domain: input.domain,
                operation: "DELETE",
                beforeJson: secretAuditShape(existing),
                afterJson: { hasValue: false },
                requestId: input.requestId,
            });

            return existing;
        });
    }

    async getSecret(input: SecretInput): Promise<string | null> {
        const secret = await db.settingsSecret.findUnique({
            where: {
                scopeType_scopeId_domain_secretKey: {
                    scopeType: input.scopeType,
                    scopeId: input.scopeId,
                    domain: input.domain,
                    secretKey: input.secretKey,
                },
            },
        });
        if (!secret) return null;

        return await decryptSettingsSecretValue({
            scopeType: input.scopeType,
            scopeId: input.scopeId,
            domain: input.domain,
            secretKey: input.secretKey,
            ciphertext: secret.ciphertext,
            iv: secret.iv,
            authTag: secret.authTag,
            keyId: secret.keyId,
            encryptedDek: secret.encryptedDek,
        });
    }

    async hasSecret(input: SecretInput): Promise<boolean> {
        const count = await db.settingsSecret.count({
            where: {
                scopeType: input.scopeType,
                scopeId: input.scopeId,
                domain: input.domain,
                secretKey: input.secretKey,
            },
        });
        return count > 0;
    }

    async rotateSecrets(input: RotateSecretsInput = {}) {
        const primaryKeyId = getSettingsPrimaryKeyId();
        const batchSize = Math.min(Math.max(input.batchSize ?? 100, 1), 1000);
        let rotated = 0;

        while (true) {
            const rows = await db.settingsSecret.findMany({
                where: {
                    ...(input.scopeType ? { scopeType: input.scopeType } : {}),
                    ...(input.scopeId ? { scopeId: input.scopeId } : {}),
                    ...(input.domain ? { domain: input.domain } : {}),
                    keyId: { not: primaryKeyId },
                },
                take: batchSize,
                orderBy: { createdAt: "asc" },
            });

            if (rows.length === 0) break;

            await db.$transaction(async (tx) => {
                for (const row of rows) {
                    const reEncrypted = await reEncryptSettingsSecretValue({
                        scopeType: row.scopeType as SettingsScope,
                        scopeId: row.scopeId,
                        domain: row.domain as SettingsDomain,
                        secretKey: row.secretKey,
                        ciphertext: row.ciphertext,
                        iv: row.iv,
                        authTag: row.authTag,
                        keyId: row.keyId,
                        encryptedDek: row.encryptedDek,
                    });

                    await tx.settingsSecret.update({
                        where: { id: row.id },
                        data: {
                            ciphertext: reEncrypted.ciphertext,
                            iv: reEncrypted.iv,
                            authTag: reEncrypted.authTag,
                            keyId: reEncrypted.keyId,
                            encryptedDek: reEncrypted.encryptedDek ?? null,
                            encryptedAt: reEncrypted.encryptedAt,
                            rotatedAt: new Date(),
                        },
                    });

                    await createAuditLog(tx, {
                        actorUserId: input.actorUserId ?? null,
                        scopeType: row.scopeType as SettingsScope,
                        scopeId: row.scopeId,
                        domain: row.domain as SettingsDomain,
                        operation: "ROTATE",
                        beforeJson: { keyId: row.keyId },
                        afterJson: { keyId: reEncrypted.keyId },
                    });
                }
            });

            rotated += rows.length;
        }

        return { rotated };
    }

    async checkDocumentParity<T>(input: {
        scopeType: SettingsScope;
        scopeId: string;
        domain: SettingsDomain;
        legacyPayload: T;
        actorUserId?: string | null;
        requestId?: string | null;
    }): Promise<{ matched: boolean; documentExists: boolean }> {
        const doc = await this.getDocument<T>({
            scopeType: input.scopeType,
            scopeId: input.scopeId,
            domain: input.domain,
        });

        if (!doc) {
            return { matched: false, documentExists: false };
        }

        const normalizedLegacy = validateSettingsPayload(input.domain, input.legacyPayload);
        const normalizedNew = validateSettingsPayload(input.domain, doc.payload);
        const matched = isDeepStrictEqual(normalizedLegacy, normalizedNew);

        if (!matched) {
            await db.settingsAuditLog.create({
                data: {
                    actorUserId: input.actorUserId ?? null,
                    scopeType: input.scopeType,
                    scopeId: input.scopeId,
                    domain: input.domain,
                    operation: "PARITY_MISMATCH",
                    beforeJson: normalizedLegacy as Prisma.InputJsonValue,
                    afterJson: normalizedNew as Prisma.InputJsonValue,
                    requestId: input.requestId ?? null,
                },
            });
        }

        return { matched, documentExists: true };
    }
}

export const settingsService = new SettingsService();
