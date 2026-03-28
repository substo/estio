import { KeyManagementServiceClient } from "@google-cloud/kms";

type GenerateDekResponse = {
    plaintextDek: Buffer;
    encryptedDek: string;
};

class KmsClient {
    private client: KeyManagementServiceClient;

    constructor() {
        this.client = new KeyManagementServiceClient();
    }

    private get keyPath(): string | undefined {
        // e.g., projects/my-project/locations/global/keyRings/my-keyring/cryptoKeys/my-key
        return process.env.GCP_KMS_KEY_PATH;
    }

    /**
     * Generates a new Data Encryption Key (DEK) from Google Cloud KMS.
     * Retruns both the plaintext DEK (to use immediately) and the encrypted DEK (to store).
     */
    async generateDataKey(): Promise<GenerateDekResponse | null> {
        const keyName = this.keyPath;
        if (!keyName) return null;

        const [result] = await this.client.generateRandomBytes({
            lengthBytes: 32, // AES-256 uses 32 bytes (256 bits)
            protectionLevel: "SOFTWARE",
        });

        const plaintextDek = Buffer.from(result.data!);

        // Wrap the new raw DEK using the Master Key in KMS
        const [encryptResponse] = await this.client.encrypt({
            name: keyName,
            plaintext: plaintextDek,
        });

        return {
            plaintextDek,
            encryptedDek: Buffer.from(encryptResponse.ciphertext!).toString("base64"),
        };
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

        return Buffer.from(decryptResponse.plaintext!);
    }
}

// Export a singleton instance
export const kmsClient = new KmsClient();
