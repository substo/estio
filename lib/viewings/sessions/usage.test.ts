import assert from "node:assert/strict";
import test from "node:test";
import {
    resolveViewingSessionCostAuthority,
    resolveViewingSessionUsageAuthority,
} from "@/lib/viewings/sessions/usage";

test("usage authority defaults to provider reported for live audio and derived elsewhere", () => {
    assert.equal(resolveViewingSessionUsageAuthority("live_audio"), "provider_reported");
    assert.equal(resolveViewingSessionUsageAuthority("analysis"), "derived");
    assert.equal(resolveViewingSessionUsageAuthority("summary"), "derived");
    assert.equal(resolveViewingSessionUsageAuthority("tooling"), "derived");
});

test("usage authority honors explicit overrides", () => {
    assert.equal(resolveViewingSessionUsageAuthority("analysis", "provider_reported"), "provider_reported");
    assert.equal(resolveViewingSessionUsageAuthority("live_audio", "derived"), "derived");
});

test("cost authority defaults to estimated unless the provider is authoritative", () => {
    assert.equal(resolveViewingSessionCostAuthority(undefined), "estimated");
    assert.equal(resolveViewingSessionCostAuthority("estimated"), "estimated");
    assert.equal(resolveViewingSessionCostAuthority("provider_reported"), "provider_reported");
});
