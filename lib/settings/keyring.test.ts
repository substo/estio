import test from "node:test";
import assert from "node:assert/strict";
import { parseSettingsEncryptionKeys } from "./keyring";

test("parseSettingsEncryptionKeys accepts canonical JSON key maps", () => {
    assert.deepEqual(
        parseSettingsEncryptionKeys('{"prod-key-1":"abc+/=="}'),
        { "prod-key-1": "abc+/==" }
    );
});

test("parseSettingsEncryptionKeys accepts unquoted dotenv key maps", () => {
    assert.deepEqual(
        parseSettingsEncryptionKeys("{prod-key-1:abc+/==}"),
        { "prod-key-1": "abc+/==" }
    );
});

test("parseSettingsEncryptionKeys rejects non-object values before keyring validation", () => {
    assert.equal(parseSettingsEncryptionKeys('"abc"'), "abc");
    assert.throws(
        () => parseSettingsEncryptionKeys("prod-key-1:abc+/=="),
        /SETTINGS_ENCRYPTION_KEYS must be valid JSON/
    );
});
