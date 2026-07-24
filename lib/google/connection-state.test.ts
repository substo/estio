import test from "node:test";
import assert from "node:assert/strict";
import { resolveGoogleConnectionState } from "./connection-state";

const disconnected = {
    syncEnabled: false,
    hasEncryptedAccessToken: false,
    hasEncryptedRefreshToken: false,
    legacyAccessToken: null,
    legacyRefreshToken: null,
};

test("uses encrypted credentials as the canonical connected state", () => {
    assert.equal(resolveGoogleConnectionState({
        ...disconnected,
        syncEnabled: true,
        hasEncryptedRefreshToken: true,
    }), true);
});

test("supports legacy credentials during migration", () => {
    assert.equal(resolveGoogleConnectionState({
        ...disconnected,
        syncEnabled: true,
        legacyAccessToken: "legacy-access",
    }), true);
});

test("requires sync to be enabled and at least one usable credential", () => {
    assert.equal(resolveGoogleConnectionState({
        ...disconnected,
        hasEncryptedAccessToken: true,
    }), false);
    assert.equal(resolveGoogleConnectionState({
        ...disconnected,
        syncEnabled: true,
    }), false);
});
