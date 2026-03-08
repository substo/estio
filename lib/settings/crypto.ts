import crypto from "crypto";
import { getSettingsKeyById, getSettingsPrimaryKey, getSettingsPrimaryKeyId } from "./keyring";

export type SettingsScope = "LOCATION" | "USER";

export type SecretCiphertext = {
    ciphertext: string;
    iv: string;
    authTag: string;
    alg: "AES-256-GCM";
    keyId: string;
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
};

function toAad({ scopeType, scopeId, domain, secretKey }: SecretParams): Buffer {
    return Buffer.from(`${scopeType}:${scopeId}:${domain}:${secretKey}`, "utf8");
}

export function encryptSettingsSecretValue(params: EncryptSecretParams): SecretCiphertext {
    const keyId = getSettingsPrimaryKeyId();
    const key = getSettingsPrimaryKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(toAad(params));

    const encrypted = Buffer.concat([
        cipher.update(params.plaintext, "utf8"),
        cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return {
        ciphertext: encrypted.toString("base64"),
        iv: iv.toString("base64"),
        authTag: authTag.toString("base64"),
        alg: "AES-256-GCM",
        keyId,
        encryptedAt: new Date(),
    };
}

export function decryptSettingsSecretValue(params: DecryptSecretParams): string {
    const key = getSettingsKeyById(params.keyId);
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

    return decrypted.toString("utf8");
}

export function reEncryptSettingsSecretValue(
    params: DecryptSecretParams
): SecretCiphertext {
    const plaintext = decryptSettingsSecretValue(params);
    return encryptSettingsSecretValue({
        scopeType: params.scopeType,
        scopeId: params.scopeId,
        domain: params.domain,
        secretKey: params.secretKey,
        plaintext,
    });
}
