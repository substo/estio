import crypto from "crypto";
import { KeyManagementServiceClient } from "@google-cloud/kms";

type GenerateDekResponse = {
    plaintextDek: Buffer;
    encryptedDek: string;
};

const KMS_KEY_PATH_PATTERN =
    /^projects\/([^/]{1,100})\/locations\/([a-zA-Z0-9_-]{1,63})\/keyRings\/([^/]{1,100})\/cryptoKeys\/([^/]{1,100})$/;

export function normalizeAndValidateKmsKeyPath(rawValue: string | undefined): string | null {
    const trimmed = rawValue?.trim();
    if (!trimmed) return null;

    // Guard against quoted env var values.
    const unquoted = trimmed.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
    if (!KMS_KEY_PATH_PATTERN.test(unquoted)) {
        throw new Error(
            "Invalid GCP_KMS_KEY_PATH. Expected format: projects/<project>/locations/<location>/keyRings/<ring>/cryptoKeys/<key>."
        );
    }

    return unquoted;
}

class KmsClient {
    private client: KeyManagementServiceClient;

    constructor() {
        this.client = new KeyManagementServiceClient();
    }

    private get keyPath(): string | undefined {
        // e.g., projects/my-project/locations/global/keyRings/my-keyring/cryptoKeys/my-key
        const normalized = normalizeAndValidateKmsKeyPath(process.env.GCP_KMS_KEY_PATH);
        return normalized ?? undefined;
    }

    /**
     * Generates a new Data Encryption Key (DEK) from Google Cloud KMS.
     * Retruns both the plaintext DEK (to use immediately) and the encrypted DEK (to store).
     */
    async generateDataKey(): Promise<GenerateDekResponse | null> {
        const keyName = this.keyPath;
        if (!keyName) return null;

        // Generate DEK from local CSPRNG, then wrap it with KMS master key.
        const plaintextDek = crypto.randomBytes(32);
        try {
            const [encryptResponse] = await this.client.encrypt({
                name: keyName,
                plaintext: plaintextDek,
            });

            if (!encryptResponse.ciphertext) {
                throw new Error("Google KMS encrypt response did not include ciphertext.");
            }

            // Return a copy and immediately wipe temporary source buffer.
            const dekForCaller = Buffer.from(plaintextDek);
            return {
                plaintextDek: dekForCaller,
                encryptedDek: Buffer.from(encryptResponse.ciphertext).toString("base64"),
            };
        } finally {
            plaintextDek.fill(0);
        }
    }

    /**
     * Decrypts an Encrypted DEK back to its plaintext form via Google Cloud KMS.
     */
    async decryptDataKey(encryptedDek: string): Promise<Buffer | null> {
        const keyName = this.keyPath;
        if (!keyName || !encryptedDek) return null;

        const [decryptResponse] = await this.client.decrypt({
            name: keyName,
            ciphertext: Buffer.from(encryptedDek, "base64"),
        });

        if (!decryptResponse.plaintext) {
            throw new Error("Google KMS decrypt response did not include plaintext.");
        }

        return Buffer.from(decryptResponse.plaintext);
    }
}

// Export a singleton instance
export const kmsClient = new KmsClient();
