import test from "node:test";
import assert from "node:assert/strict";
import { createGoogleOAuthState, isGoogleOAuthStateValid } from "./oauth-state";

test("createGoogleOAuthState returns a non-empty token", () => {
    const token = createGoogleOAuthState();
    assert.equal(typeof token, "string");
    assert.ok(token.length > 20);
});

test("isGoogleOAuthStateValid accepts exact matches", () => {
    const token = createGoogleOAuthState();
    assert.equal(isGoogleOAuthStateValid(token, token), true);
});

test("isGoogleOAuthStateValid rejects null or mismatched values", () => {
    const token = createGoogleOAuthState();
    assert.equal(isGoogleOAuthStateValid(token, null), false);
    assert.equal(isGoogleOAuthStateValid(null, token), false);
    assert.equal(isGoogleOAuthStateValid(token, `${token}x`), false);
});
