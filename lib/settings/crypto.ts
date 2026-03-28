import crypto from "crypto";
import { getSettingsKeyById, getSettingsPrimaryKey, getSettingsPrimaryKeyId } from "./keyring";
import { kmsClient } from "../crypto/kms-client";

export type SettingsScope = "LOCATION" | "USER";

export type SecretCiphertext = {
    ciphertext: string;
    iv: string;
    authTag: string;
    alg: "AES-256-GCM";
    keyId: string;
    encryptedDek?: string | null;
    encryptedAt: Date;
};

type SecretParams = {
    scopeType: SettingsScope;
    scopeId: string;
    domain: string;
    secretKey: string;
};

type EncryptSecretParams = SecretParams & {
    plaintext: string;
};

type DecryptSecretParams = SecretParams & {
    ciphertext: string;
    iv: string;
    authTag: string;
    keyId: string;
    encryptedDek?: string | null;
};

function toAad({ scopeType, scopeId, domain, secretKey }: SecretParams): Buffer {
    return Buffer.from(`${scopeType}:${scopeId}:${domain}:${secretKey}`, "utf8");
}

export async function encryptSettingsSecretValue(params: EncryptSecretParams): Promise<SecretCiphertext> {
    const keyId = getSettingsPrimaryKeyId();
    let key = getSettingsPrimaryKey();
    let encryptedDek: string | null = null;
    let isKms = false;

    if (process.env.GCP_KMS_KEY_PATH) {
        const kmsRes = await kmsClient.generateDataKey();
        if (kmsRes) {
            // Because we pass a buffer into createCipheriv, we must ensure it is duplicated 
            // from the buffer pool so we can safely overwrite it without corrupting the return.
            key = Buffer.from(kmsRes.plaintextDek);
            encryptedDek = kmsRes.encryptedDek;
            isKms = true;
        }
    }

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(toAad(params));

    const encrypted = Buffer.concat([
        cipher.update(params.plaintext, "utf8"),
        cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    // Zero out the Data Encryption Key immediately from heap before GC
    if (isKms && key) {
        key.fill(0);
    }

    return {
        ciphertext: encrypted.toString("base64"),
        iv: iv.toString("base64"),
        authTag: authTag.toString("base64"),
        alg: "AES-256-GCM",
        keyId,
        encryptedDek,
        encryptedAt: new Date(),
    };
}

export async function decryptSettingsSecretValue(params: DecryptSecretParams): Promise<string> {
    let key: Buffer;
    let isKms = false;

    if (params.encryptedDek && process.env.GCP_KMS_KEY_PATH) {
        const plainDek = await kmsClient.decryptDataKey(params.encryptedDek);
        if (plainDek) {
            key = Buffer.from(plainDek); // Copy into new buffer to safely zero
            isKms = true;
        } else {
            throw new Error("Failed to decrypt DEK via Google Cloud KMS.");
        }
    } else {
        key = getSettingsKeyById(params.keyId);
    }

    const decipher = crypto.createDecipheriv(
        "aes-256-gcm",
        key,
        Buffer.from(params.iv, "base64")
    );
    decipher.setAAD(toAad(params));
    decipher.setAuthTag(Buffer.from(params.authTag, "base64"));

    const decrypted = Buffer.concat([
        decipher.update(Buffer.from(params.ciphertext, "base64")),
        decipher.final(),
    ]);

    // Zero out the Data Encryption Key immediately 
    if (isKms && key) {
        key.fill(0);
    }

    return decrypted.toString("utf8");
}

export async function reEncryptSettingsSecretValue(
    params: DecryptSecretParams
): Promise<SecretCiphertext> {
    const plaintext = await decryptSettingsSecretValue(params);
    return await encryptSettingsSecretValue({
        scopeType: params.scopeType,
        scopeId: params.scopeId,
        domain: params.domain,
        secretKey: params.secretKey,
        plaintext,
    });
}
