import { verifySettingsEncryptionReady } from "../../lib/settings/crypto";
import { normalizeAndValidateKmsKeyPath } from "../../lib/crypto/kms-client";

async function main() {
    const keyPath = normalizeAndValidateKmsKeyPath(process.env.GCP_KMS_KEY_PATH);
    await verifySettingsEncryptionReady();
    console.log(keyPath
        ? `[settings/kms-preflight] KMS encrypt/decrypt verified for ${keyPath}.`
        : "[settings/kms-preflight] Local settings keyring verified.");
}

main().catch((error) => {
    console.error(
        "[settings/kms-preflight] Secure settings storage is unavailable:",
        error instanceof Error ? error.message : error
    );
    process.exitCode = 1;
});
