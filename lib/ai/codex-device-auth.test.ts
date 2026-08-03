import assert from "node:assert/strict";
import test from "node:test";
import {
    canConsumeCodexDeviceAttempt,
    isCodexDeviceAttemptTerminal,
    maskChatGptIdentity,
    matchesCodexAttemptOwner,
    sanitizeChatGptUsageLimits,
} from "./codex-device-auth";

test("login attempts are actor-bound, location-bound, and scope-bound", () => {
    const owner = { actorUserId: "user-a", locationId: "location-a", scope: "USER" as const };
    assert.equal(matchesCodexAttemptOwner(owner, owner), true);
    assert.equal(matchesCodexAttemptOwner(owner, { ...owner, actorUserId: "user-b" }), false);
    assert.equal(matchesCodexAttemptOwner(owner, { ...owner, locationId: "location-b" }), false);
    assert.equal(matchesCodexAttemptOwner(owner, { ...owner, scope: "LOCATION" }), false);
});

test("ChatGPT identity is masked before it is exposed to the browser", () => {
    assert.equal(maskChatGptIdentity("alex@example.com"), "a***@example.com");
    assert.equal(maskChatGptIdentity(null), null);
});

test("login attempts expire and terminal attempts are single-use", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const past = new Date(Date.now() - 1).toISOString();
    assert.equal(canConsumeCodexDeviceAttempt({ state: "waiting", handled: false, expiresAt: future }), true);
    assert.equal(canConsumeCodexDeviceAttempt({ state: "waiting", handled: false, expiresAt: past }), false);
    assert.equal(canConsumeCodexDeviceAttempt({ state: "waiting", handled: true, expiresAt: future }), false);
    assert.equal(canConsumeCodexDeviceAttempt({ state: "connected", handled: true, expiresAt: future }), false);
    assert.equal(isCodexDeviceAttemptTerminal("waiting"), false);
    assert.equal(isCodexDeviceAttemptTerminal("cancelled"), true);
});

test("rate-limit status is reduced to safe display fields", () => {
    assert.deepEqual(sanitizeChatGptUsageLimits({
        primary: { usedPercent: 35.2, windowDurationMins: 300, resetsAt: 1_900_000_000, internal: "secret" },
        token: "never expose",
    }), {
        primary: { usedPercent: 35.2, windowDurationMins: 300, resetsAt: 1_900_000_000 },
        secondary: null,
    });
});
