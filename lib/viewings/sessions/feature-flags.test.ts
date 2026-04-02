import test from "node:test";
import assert from "node:assert/strict";
import { getViewingSessionFeatureFlags } from "@/lib/viewings/sessions/feature-flags";

const ENV_KEYS = [
    "VIEWING_SESSION_VOICE_PREMIUM",
    "VIEWING_SESSION_VOICE_PREMIUM_MODE",
    "viewing_session_voice_premium",
    "VIEWING_SESSION_CANARY_LOCATIONS",
    "VIEWING_SESSION_CANARY_LOCATION_IDS",
    "viewing_session_canary_locations",
];

function resetEnv() {
    for (const key of ENV_KEYS) {
        delete process.env[key];
    }
}

test("voice premium flag defaults to off", () => {
    resetEnv();
    const flags = getViewingSessionFeatureFlags("loc_a");
    assert.equal(flags.voicePremiumEnabled, false);
    assert.equal(flags.canaryMatch, false);
});

test("voice premium flag enables for all locations when mode is on", () => {
    resetEnv();
    process.env.VIEWING_SESSION_VOICE_PREMIUM = "on";
    const flags = getViewingSessionFeatureFlags("loc_a");
    assert.equal(flags.voicePremiumEnabled, true);
    assert.equal(flags.canaryMatch, false);
});

test("voice premium canary enables only listed locations", () => {
    resetEnv();
    process.env.VIEWING_SESSION_VOICE_PREMIUM_MODE = "canary";
    process.env.VIEWING_SESSION_CANARY_LOCATIONS = "loc_1,loc_2";

    const canary = getViewingSessionFeatureFlags("loc_2");
    const nonCanary = getViewingSessionFeatureFlags("loc_3");

    assert.equal(canary.voicePremiumEnabled, true);
    assert.equal(canary.canaryMatch, true);
    assert.equal(nonCanary.voicePremiumEnabled, false);
    assert.equal(nonCanary.canaryMatch, false);
});

test("invalid mode falls back to off", () => {
    resetEnv();
    process.env.viewing_session_voice_premium = "maybe";
    const flags = getViewingSessionFeatureFlags("loc_a");
    assert.equal(flags.voicePremiumEnabled, false);
});
