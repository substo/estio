import test from "node:test";
import assert from "node:assert/strict";
import {
    classifyGoogleOAuthError,
    isSettingsSecureStorageError,
} from "./oauth-errors";

test("classifies Google Cloud KMS permission failures as secure storage failures", () => {
    const error = Object.assign(
        new Error(
            "7 PERMISSION_DENIED: Permission 'cloudkms.cryptoKeyVersions.useToEncrypt' denied"
        ),
        { code: 7 }
    );

    assert.equal(isSettingsSecureStorageError(error), true);
    assert.equal(classifyGoogleOAuthError(error), "secure_storage_unavailable");
});

test("classifies missing or invalid settings encryption configuration", () => {
    assert.equal(
        classifyGoogleOAuthError(
            new Error("GCP_KMS_KEY_PATH is invalid for settings encryption")
        ),
        "secure_storage_unavailable"
    );
});

test("keeps unrelated callback failures generic", () => {
    assert.equal(
        classifyGoogleOAuthError(new Error("OAuth token exchange failed")),
        "internal_error"
    );
});
