import test from "node:test";
import assert from "node:assert/strict";
import { normalizeAndValidateKmsKeyPath } from "./kms-client";

test("normalizeAndValidateKmsKeyPath returns null for empty values", () => {
    assert.equal(normalizeAndValidateKmsKeyPath(undefined), null);
    assert.equal(normalizeAndValidateKmsKeyPath(""), null);
    assert.equal(normalizeAndValidateKmsKeyPath("   "), null);
});

test("normalizeAndValidateKmsKeyPath accepts valid paths and strips quotes", () => {
    const raw = "\"projects/my-project/locations/global/keyRings/estio/cryptoKeys/master\"";
    const normalized = normalizeAndValidateKmsKeyPath(raw);
    assert.equal(
        normalized,
        "projects/my-project/locations/global/keyRings/estio/cryptoKeys/master"
    );
});

test("normalizeAndValidateKmsKeyPath rejects malformed resource names", () => {
    assert.throws(
        () => normalizeAndValidateKmsKeyPath("projects/my-project/keyRings/estio/cryptoKeys/master"),
        /Invalid GCP_KMS_KEY_PATH/
    );
});
