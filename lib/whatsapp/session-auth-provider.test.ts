import assert from "node:assert/strict";
import test from "node:test";
import { GoogleSessionAuthKeyWrapper, validateSessionAuthKmsKeyName } from "./session-auth-kms";
import { buildSessionAuthObjectKey, getSessionAuthObjectStoreConfig, R2SessionAuthObjectStore } from "./session-auth-object-store";

test("session-auth KMS wrapper accepts only the dedicated configured key", async () => {
    const keyName = "projects/project/locations/global/keyRings/auth/cryptoKeys/whatsapp";
    assert.equal(validateSessionAuthKmsKeyName(keyName), keyName);
    assert.throws(() => validateSessionAuthKmsKeyName("https://example.test/key"));
    const wrapped = Buffer.from("wrapped-key");
    const callOptions: unknown[] = [];
    const client = {
        async encrypt(_request: unknown, options: unknown) { callOptions.push(options); return [{ ciphertext: wrapped }]; },
        async decrypt(_request: unknown, options: unknown) { callOptions.push(options); return [{ plaintext: Buffer.alloc(32, 7) }]; },
    } as any;
    const wrapper = new GoogleSessionAuthKeyWrapper(keyName, client);
    const generated = await wrapper.generateDataKey(keyName);
    assert.equal(generated.plaintextKey.length, 32);
    assert.equal((await wrapper.decryptDataKey(keyName, generated.encryptedKey)).length, 32);
    assert.deepEqual(callOptions, [{ timeout: 30_000 }, { timeout: 30_000 }]);
    await assert.rejects(() => wrapper.generateDataKey("projects/other/locations/global/keyRings/auth/cryptoKeys/whatsapp"));
});

test("session-auth R2 configuration rejects alternate endpoints and shared media credentials", () => {
    const accountId = "a".repeat(32);
    const config = getSessionAuthObjectStoreConfig({
        CLOUDFLARE_R2_ACCOUNT_ID: accountId,
        WHATSAPP_SESSION_AUTH_R2_ACCESS_KEY_ID: "dedicated-access",
        WHATSAPP_SESSION_AUTH_R2_SECRET_ACCESS_KEY: "dedicated-secret",
        WHATSAPP_SESSION_AUTH_R2_BUCKET: "private-whatsapp-auth",
    } as NodeJS.ProcessEnv);
    assert.equal(config.endpoint, `https://${accountId}.r2.cloudflarestorage.com`);
    assert.throws(() => getSessionAuthObjectStoreConfig({
        CLOUDFLARE_R2_ACCOUNT_ID: accountId,
        WHATSAPP_SESSION_AUTH_R2_ACCESS_KEY_ID: "dedicated-access",
        WHATSAPP_SESSION_AUTH_R2_SECRET_ACCESS_KEY: "dedicated-secret",
        WHATSAPP_SESSION_AUTH_R2_BUCKET: "private-whatsapp-auth",
        WHATSAPP_SESSION_AUTH_R2_ENDPOINT: "https://example.test",
    } as NodeJS.ProcessEnv), /endpoint/);
    assert.throws(() => getSessionAuthObjectStoreConfig({
        CLOUDFLARE_R2_ACCOUNT_ID: accountId,
        R2_ACCESS_KEY_ID: "shared-media-access",
        R2_SECRET_ACCESS_KEY: "shared-media-secret",
        WHATSAPP_SESSION_AUTH_R2_BUCKET: "private-whatsapp-auth",
    } as NodeJS.ProcessEnv), /credentials/);
});

test("session-auth object keys stay inside an opaque immutable generation prefix", async () => {
    assert.equal(
        buildSessionAuthObjectKey("placement_abc", 4, "object-uuid"),
        "whatsapp-session-auth/v1/placement/placement_abc/generation/4/object-uuid.bin",
    );
    assert.throws(() => buildSessionAuthObjectKey("../placement", 4));
    assert.throws(() => buildSessionAuthObjectKey("placement", 0));
    const store = new R2SessionAuthObjectStore({
        accountId: "a".repeat(32),
        accessKeyId: "access",
        secretAccessKey: "secret",
        bucket: "private-auth",
        endpoint: `https://${"a".repeat(32)}.r2.cloudflarestorage.com`,
    }, { send: async () => { throw new Error("should not be called"); } } as any);
    await assert.rejects(() => store.get({ key: "../another-tenant.bin" }), /managed prefix/);
});
