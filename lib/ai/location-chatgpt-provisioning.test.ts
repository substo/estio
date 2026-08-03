import assert from "node:assert/strict";
import test from "node:test";
import {
    buildLocationChatGptConnectionPayload,
    provisionLocationChatGptAccessToken,
} from "./location-chatgpt-provisioning";

const baseInput = {
    locationId: "location-a",
    actorUserId: "admin-a",
    accessToken: "secret-workspace-token",
    accountType: "business" as const,
    workspaceLabel: "Acme Business workspace",
};

test("workspace provisioning rejects a non-admin before token validation or persistence", async () => {
    let validated = false;
    let persisted = false;
    await assert.rejects(() => provisionLocationChatGptAccessToken(baseInput, {
        authorize: async () => false,
        validate: async () => { validated = true; return true; },
        persist: async () => { persisted = true; },
    }), /not an admin/);
    assert.equal(validated, false);
    assert.equal(persisted, false);
});

test("workspace provisioning rejects an invalid token without writing settings", async () => {
    let persisted = false;
    await assert.rejects(() => provisionLocationChatGptAccessToken(baseInput, {
        authorize: async () => true,
        validate: async (token) => token !== baseInput.accessToken,
        persist: async () => { persisted = true; },
    }), /did not accept/);
    assert.equal(persisted, false);
});

test("workspace provisioning stores only the requested location and returns no credential", async () => {
    let persisted: any = null;
    const result = await provisionLocationChatGptAccessToken(baseInput, {
        authorize: async ({ locationId, actorUserId }) => locationId === "location-a" && actorUserId === "admin-a",
        validate: async (token) => token === baseInput.accessToken,
        persist: async (input) => { persisted = input; },
        now: () => new Date("2026-08-03T12:00:00.000Z"),
    });
    assert.equal(persisted.locationId, "location-a");
    assert.equal(persisted.actorUserId, "admin-a");
    assert.equal(persisted.accessToken, baseInput.accessToken);
    assert.deepEqual(result, {
        locationId: "location-a",
        accountType: "business",
        workspaceLabel: "Acme Business workspace",
        verifiedAt: "2026-08-03T12:00:00.000Z",
        stored: true,
    });
    assert.equal(JSON.stringify(result).includes(baseInput.accessToken), false);
});

test("dry-run validates authorization and token without persistence", async () => {
    let persisted = false;
    const result = await provisionLocationChatGptAccessToken({ ...baseInput, dryRun: true }, {
        authorize: async () => true,
        validate: async () => true,
        persist: async () => { persisted = true; },
    });
    assert.equal(result.stored, false);
    assert.equal(persisted, false);
});

test("workspace connection metadata preserves unrelated integration settings", () => {
    const payload = buildLocationChatGptConnectionPayload({
        existingPayload: { providerConnections: { gemini: { health: "connected" } } },
        accountType: "enterprise",
        workspaceLabel: "Acme Enterprise workspace",
        actorUserId: "admin-a",
        verifiedAt: "2026-08-03T12:00:00.000Z",
    });
    assert.deepEqual(payload.providerConnections, { gemini: { health: "connected" } });
    assert.deepEqual(payload.chatGptSubscription, {
        enabled: true,
        credentialKind: "workspace_access_token",
        eligibility: "business_or_enterprise_automation",
        identityMasked: "Acme Enterprise workspace",
        planType: "enterprise",
        verifiedAt: "2026-08-03T12:00:00.000Z",
        health: "connected",
        connectedByUserId: "admin-a",
        provisioningMode: "approved_operator",
        usageLimits: null,
    });
});
