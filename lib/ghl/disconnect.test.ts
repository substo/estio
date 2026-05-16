import test from "node:test";
import assert from "node:assert/strict";
import { buildGhlDisconnectData } from "./disconnect";

test("GHL disconnect clears tokens but keeps remote ids by default", () => {
    assert.deepEqual(buildGhlDisconnectData(), {
        ghlAccessToken: null,
        ghlRefreshToken: null,
        ghlTokenType: null,
        ghlExpiresAt: null,
        ghlScopes: null,
    });
});

test("GHL full unlink also clears remote ids", () => {
    assert.deepEqual(buildGhlDisconnectData("full_unlink"), {
        ghlAccessToken: null,
        ghlRefreshToken: null,
        ghlTokenType: null,
        ghlExpiresAt: null,
        ghlScopes: null,
        ghlLocationId: null,
        ghlAgencyId: null,
        ghlInstallId: null,
    });
});
