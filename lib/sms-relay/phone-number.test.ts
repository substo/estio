import assert from "node:assert/strict";
import test from "node:test";
import {
    normalizeSmsRelayPhoneNumber,
    requireSmsRelayPhoneNumber,
} from "./phone-number";

test("normalizes international SIM relay numbers to E.164", () => {
    assert.equal(normalizeSmsRelayPhoneNumber(" 00357 99 123456 "), "+35799123456");
    assert.equal(normalizeSmsRelayPhoneNumber("35799123456"), "+35799123456");
});

test("allows an unavailable automatically detected number", () => {
    assert.equal(normalizeSmsRelayPhoneNumber(null), null);
    assert.equal(normalizeSmsRelayPhoneNumber(""), null);
});

test("rejects invalid manually entered numbers", () => {
    assert.throws(
        () => requireSmsRelayPhoneNumber("123"),
        /valid mobile number in international format/i,
    );
});
