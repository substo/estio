import test from "node:test";
import assert from "node:assert/strict";
import { GHLError } from "@/lib/ghl/client";
import {
    classifyGhlHealthError,
    getGhlConnectionHealth,
} from "./connection-health";

const now = () => new Date("2026-05-16T10:00:00.000Z");

function location(overrides: Record<string, any> = {}) {
    return {
        id: "loc_internal",
        ghlAccessToken: "access",
        ghlRefreshToken: "refresh",
        ghlTokenType: "Bearer",
        ghlExpiresAt: new Date("2026-05-16T11:00:00.000Z"),
        ghlScopes: "locations.readonly",
        ghlLocationId: "ghl_loc",
        ghlAgencyId: "agency",
        ghlInstallId: "install",
        ...overrides,
    };
}

test("GHL health reports not_connected when required fields are missing", async () => {
    const health = await getGhlConnectionHealth(location({ ghlAccessToken: null }), { now });

    assert.equal(health.status, "not_connected");
    assert.match(health.reason, /complete/);
    assert.equal(health.checkedAt, "2026-05-16T10:00:00.000Z");
});

test("GHL health reports connected after refresh and location lookup", async () => {
    const health = await getGhlConnectionHealth(location(), {
        now,
        refreshToken: async (input) => ({ ...input, ghlAccessToken: "new_access" }),
        fetchLocation: async (accessToken, locationId) => {
            assert.equal(accessToken, "new_access");
            assert.equal(locationId, "ghl_loc");
            return { location: { name: "Enabled Location" } };
        },
    });

    assert.equal(health.status, "connected");
    assert.equal(health.remoteLocationName, "Enabled Location");
});

test("GHL health classifies refresh failure as broken", async () => {
    const health = await getGhlConnectionHealth(location(), {
        now,
        refreshToken: async () => {
            throw new Error("Failed to refresh GHL token");
        },
    });

    assert.equal(health.status, "broken");
    assert.match(health.reason, /refresh/i);
});

test("GHL health classifies auth and missing location errors as broken", () => {
    assert.equal(classifyGhlHealthError(new GHLError("Nope", 401, {})).status, "broken");
    assert.equal(classifyGhlHealthError(new GHLError("Nope", 403, {})).status, "broken");
    assert.equal(classifyGhlHealthError(new GHLError("Gone", 404, {})).status, "broken");
});

test("GHL health classifies upstream failures as unknown", () => {
    const classified = classifyGhlHealthError(new GHLError("Unavailable", 503, {}));

    assert.equal(classified.status, "unknown");
    assert.match(classified.reason, /right now/i);
});
