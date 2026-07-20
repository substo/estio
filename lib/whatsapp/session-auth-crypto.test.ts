import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import {
    decryptSessionAuthArchive,
    encryptSessionAuthArchive,
    type SessionAuthKeyWrapper,
} from "./session-auth-crypto";

const scope = {
    placementId: "placement-a",
    locationId: "location-a",
    sessionId: "session-a",
    generation: 4,
    authEpoch: 11,
};

function keyWrapper(): SessionAuthKeyWrapper {
    const keys = new Map<string, Buffer>();
    return {
        async generateDataKey() {
            const key = randomBytes(32);
            const encryptedKey = randomBytes(24).toString("base64");
            keys.set(encryptedKey, Buffer.from(key));
            return { plaintextKey: key, encryptedKey };
        },
        async decryptDataKey(_kmsKeyName, encryptedKey) {
            const key = keys.get(encryptedKey);
            if (!key) throw new Error("missing test key");
            return Buffer.from(key);
        },
    };
}

test("session-auth archives round trip with scoped authenticated encryption", async () => {
    const wrapper = keyWrapper();
    const plaintext = Buffer.from("profile archive fixture");
    const encrypted = await encryptSessionAuthArchive({
        plaintext,
        scope,
        kmsKeyName: "projects/p/locations/global/keyRings/r/cryptoKeys/auth",
        keyWrapper: wrapper,
    });
    assert.notDeepEqual(encrypted.ciphertext, plaintext);
    assert.deepEqual(await decryptSessionAuthArchive({ archive: encrypted, scope, keyWrapper: wrapper }), plaintext);
});

test("ciphertext tampering, metadata tampering, and cross-tenant replay fail closed", async () => {
    const wrapper = keyWrapper();
    const encrypted = await encryptSessionAuthArchive({
        plaintext: Buffer.from("profile archive fixture"),
        scope,
        kmsKeyName: "projects/p/locations/global/keyRings/r/cryptoKeys/auth",
        keyWrapper: wrapper,
    });
    const tamperedCiphertext = Buffer.from(encrypted.ciphertext);
    tamperedCiphertext[0] ^= 0xff;
    await assert.rejects(() => decryptSessionAuthArchive({
        archive: { ...encrypted, ciphertext: tamperedCiphertext },
        scope,
        keyWrapper: wrapper,
    }), /integrity/);
    await assert.rejects(() => decryptSessionAuthArchive({
        archive: encrypted,
        scope: { ...scope, locationId: "location-b" },
        keyWrapper: wrapper,
    }));
    await assert.rejects(() => decryptSessionAuthArchive({
        archive: { ...encrypted, metadata: { ...encrypted.metadata, plaintextSha256: "0".repeat(64) } },
        scope,
        keyWrapper: wrapper,
    }), /plaintext archive integrity/);
});

test("empty and oversized archives are rejected before encryption", async () => {
    const wrapper = keyWrapper();
    await assert.rejects(() => encryptSessionAuthArchive({
        plaintext: Buffer.alloc(0), scope, kmsKeyName: "kms", keyWrapper: wrapper,
    }));
    await assert.rejects(() => encryptSessionAuthArchive({
        plaintext: Buffer.alloc(2048), scope, kmsKeyName: "kms", keyWrapper: wrapper, maxArchiveBytes: 1024,
    }));
});
