import { randomBytes } from "node:crypto";
import { KeyManagementServiceClient } from "@google-cloud/kms";
import type { SessionAuthKeyWrapper } from "./session-auth-crypto";

const KMS_KEY_PATH_PATTERN =
    /^projects\/[^/]{1,100}\/locations\/[a-zA-Z0-9_-]{1,63}\/keyRings\/[^/]{1,100}\/cryptoKeys\/[^/]{1,100}$/;

export function validateSessionAuthKmsKeyName(rawValue: string | undefined) {
    const keyName = String(rawValue || "").trim().replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
    if (!KMS_KEY_PATH_PATTERN.test(keyName)) throw new Error("WhatsApp session-auth KMS key name is invalid");
    return keyName;
}

type KmsClientLike = Pick<KeyManagementServiceClient, "encrypt" | "decrypt">;

export class GoogleSessionAuthKeyWrapper implements SessionAuthKeyWrapper {
    private readonly keyName: string;

    constructor(
        configuredKeyName = process.env.WHATSAPP_SESSION_AUTH_KMS_KEY_PATH,
        private readonly client: KmsClientLike = new KeyManagementServiceClient(),
    ) {
        this.keyName = validateSessionAuthKmsKeyName(configuredKeyName);
    }

    private assertKeyName(keyName: string) {
        if (keyName !== this.keyName) throw new Error("WhatsApp session-auth KMS key does not match the configured key");
    }

    async generateDataKey(kmsKeyName: string) {
        this.assertKeyName(kmsKeyName);
        const plaintextKey = randomBytes(32);
        try {
            const [response] = await this.client.encrypt({ name: this.keyName, plaintext: plaintextKey });
            if (!response.ciphertext) throw new Error("WhatsApp session-auth KMS wrap returned no ciphertext");
            return {
                plaintextKey: Buffer.from(plaintextKey),
                encryptedKey: Buffer.from(response.ciphertext).toString("base64"),
            };
        } finally {
            plaintextKey.fill(0);
        }
    }

    async decryptDataKey(kmsKeyName: string, encryptedKey: string) {
        this.assertKeyName(kmsKeyName);
        if (!encryptedKey || encryptedKey.length > 16 * 1024) throw new Error("WhatsApp session-auth wrapped key is invalid");
        const [response] = await this.client.decrypt({
            name: this.keyName,
            ciphertext: Buffer.from(encryptedKey, "base64"),
        });
        if (!response.plaintext) throw new Error("WhatsApp session-auth KMS unwrap returned no plaintext");
        return Buffer.from(response.plaintext);
    }
}
