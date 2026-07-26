import test from "node:test";
import assert from "node:assert/strict";

import { isValidatedWebBridgePhoneIdentityMatch } from "./web-bridge-identity";

test("reuses high-confidence validation for the same normalized phone", () => {
    assert.equal(isValidatedWebBridgePhoneIdentityMatch({
        identityType: "phone",
        identityValue: "35799123456",
        phone: "35799123456",
        confidence: "high",
    }, "+357 99 123 456"), true);
});

test("does not reuse validation after the contact phone changes", () => {
    assert.equal(isValidatedWebBridgePhoneIdentityMatch({
        identityType: "phone",
        identityValue: "35799123456",
        phone: "35799123456",
        confidence: "high",
    }, "+357 96 654 321"), false);
});

test("does not reuse evidence invalidated by a definitive provider rejection", () => {
    assert.equal(isValidatedWebBridgePhoneIdentityMatch({
        identityType: "phone",
        identityValue: "35799123456",
        phone: "35799123456",
        confidence: "unresolved",
    }, "+357 99 123 456"), false);
});

test("accepts a high-confidence matching phone attached to a chat identity", () => {
    assert.equal(isValidatedWebBridgePhoneIdentityMatch({
        identityType: "chat",
        identityValue: "35799123456@c.us",
        phone: "35799123456",
        confidence: "high",
    }, "+35799123456"), true);
});
