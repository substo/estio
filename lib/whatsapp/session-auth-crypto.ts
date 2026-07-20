import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export const SESSION_AUTH_ENCRYPTION_ALGORITHM = "AES-256-GCM" as const;
export const SESSION_AUTH_FORMAT_VERSION = 1;
export const DEFAULT_SESSION_AUTH_MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;

export type SessionAuthCryptoScope = {
    placementId: string;
    locationId: string;
    sessionId: string;
    generation: number;
    authEpoch: number;
};

export type SessionAuthKeyWrapper = {
    generateDataKey(kmsKeyName: string): Promise<{ plaintextKey: Buffer; encryptedKey: string }>;
    decryptDataKey(kmsKeyName: string, encryptedKey: string): Promise<Buffer>;
};

export type EncryptedSessionAuthArchive = {
    ciphertext: Buffer;
    metadata: {
        encryptionAlgorithm: typeof SESSION_AUTH_ENCRYPTION_ALGORITHM;
        formatVersion: typeof SESSION_AUTH_FORMAT_VERSION;
        kmsKeyName: string;
        encryptedDek: string;
        iv: string;
        authTag: string;
        ciphertextSha256: string;
        plaintextSha256: string;
        encryptedSize: number;
        plaintextSize: number;
    };
};

function validateScope(scope: SessionAuthCryptoScope) {
    if (!scope.placementId || !scope.locationId || !scope.sessionId) throw new Error("Session-auth crypto scope is incomplete");
    if (!Number.isSafeInteger(scope.generation) || scope.generation < 1) throw new Error("Session-auth generation is invalid");
    if (!Number.isSafeInteger(scope.authEpoch) || scope.authEpoch < 1) throw new Error("Session-auth epoch is invalid");
}

function aad(scope: SessionAuthCryptoScope) {
    validateScope(scope);
    return Buffer.from(JSON.stringify({
        formatVersion: SESSION_AUTH_FORMAT_VERSION,
        placementId: scope.placementId,
        locationId: scope.locationId,
        sessionId: scope.sessionId,
        generation: scope.generation,
        authEpoch: scope.authEpoch,
    }), "utf8");
}

function sha256(value: Buffer) {
    return createHash("sha256").update(value).digest("hex");
}

function validateArchiveSize(size: number, maxArchiveBytes: number) {
    if (!Number.isSafeInteger(maxArchiveBytes) || maxArchiveBytes < 1024 || maxArchiveBytes > 2 * 1024 * 1024 * 1024) {
        throw new Error("Session-auth archive size limit is invalid");
    }
    if (!Number.isSafeInteger(size) || size < 1 || size > maxArchiveBytes) {
        throw new Error("Session-auth archive is empty or exceeds the configured size limit");
    }
}

export async function encryptSessionAuthArchive(args: {
    plaintext: Buffer;
    scope: SessionAuthCryptoScope;
    kmsKeyName: string;
    keyWrapper: SessionAuthKeyWrapper;
    maxArchiveBytes?: number;
}): Promise<EncryptedSessionAuthArchive> {
    const maxArchiveBytes = args.maxArchiveBytes ?? DEFAULT_SESSION_AUTH_MAX_ARCHIVE_BYTES;
    validateArchiveSize(args.plaintext.length, maxArchiveBytes);
    if (!args.kmsKeyName) throw new Error("Session-auth KMS key name is required");
    const generated = await args.keyWrapper.generateDataKey(args.kmsKeyName);
    const key = Buffer.from(generated.plaintextKey);
    generated.plaintextKey.fill(0);
    if (key.length !== 32 || !generated.encryptedKey) {
        key.fill(0);
        throw new Error("Session-auth KMS data key is invalid");
    }
    const iv = randomBytes(12);
    try {
        const cipher = createCipheriv("aes-256-gcm", key, iv);
        cipher.setAAD(aad(args.scope));
        const ciphertext = Buffer.concat([cipher.update(args.plaintext), cipher.final()]);
        const authTag = cipher.getAuthTag();
        return {
            ciphertext,
            metadata: {
                encryptionAlgorithm: SESSION_AUTH_ENCRYPTION_ALGORITHM,
                formatVersion: SESSION_AUTH_FORMAT_VERSION,
                kmsKeyName: args.kmsKeyName,
                encryptedDek: generated.encryptedKey,
                iv: iv.toString("base64"),
                authTag: authTag.toString("base64"),
                ciphertextSha256: sha256(ciphertext),
                plaintextSha256: sha256(args.plaintext),
                encryptedSize: ciphertext.length,
                plaintextSize: args.plaintext.length,
            },
        };
    } finally {
        key.fill(0);
    }
}

export async function decryptSessionAuthArchive(args: {
    archive: EncryptedSessionAuthArchive;
    scope: SessionAuthCryptoScope;
    keyWrapper: SessionAuthKeyWrapper;
    maxArchiveBytes?: number;
}) {
    const { archive } = args;
    const maxArchiveBytes = args.maxArchiveBytes ?? DEFAULT_SESSION_AUTH_MAX_ARCHIVE_BYTES;
    validateArchiveSize(archive.ciphertext.length, maxArchiveBytes);
    if (
        archive.metadata.encryptionAlgorithm !== SESSION_AUTH_ENCRYPTION_ALGORITHM
        || archive.metadata.formatVersion !== SESSION_AUTH_FORMAT_VERSION
        || archive.metadata.encryptedSize !== archive.ciphertext.length
        || archive.metadata.ciphertextSha256 !== sha256(archive.ciphertext)
    ) {
        throw new Error("Session-auth encrypted archive integrity validation failed");
    }
    const decryptedKey = await args.keyWrapper.decryptDataKey(
        archive.metadata.kmsKeyName,
        archive.metadata.encryptedDek,
    );
    const key = Buffer.from(decryptedKey);
    decryptedKey.fill(0);
    if (key.length !== 32) {
        key.fill(0);
        throw new Error("Session-auth decrypted data key is invalid");
    }
    try {
        const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(archive.metadata.iv, "base64"));
        decipher.setAAD(aad(args.scope));
        decipher.setAuthTag(Buffer.from(archive.metadata.authTag, "base64"));
        const plaintext = Buffer.concat([decipher.update(archive.ciphertext), decipher.final()]);
        validateArchiveSize(plaintext.length, maxArchiveBytes);
        if (
            archive.metadata.plaintextSize !== plaintext.length
            || archive.metadata.plaintextSha256 !== sha256(plaintext)
        ) {
            throw new Error("Session-auth plaintext archive integrity validation failed");
        }
        return plaintext;
    } finally {
        key.fill(0);
    }
}
