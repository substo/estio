import assert from "node:assert/strict";
import test from "node:test";
import { canManageChatGptConnection, canManageLocationAiIntegrations } from "./integration-access-policy";

test("members cannot manage location AI integrations", () => {
    assert.equal(canManageLocationAiIntegrations({ isActiveLocationMember: true, isActiveLocationAdmin: false }), false);
});

test("admins manage only an active location they belong to", () => {
    assert.equal(canManageLocationAiIntegrations({ isActiveLocationMember: true, isActiveLocationAdmin: true }), true);
    assert.equal(canManageLocationAiIntegrations({ isActiveLocationMember: false, isActiveLocationAdmin: true }), false);
});

test("a user can manage only their own personal ChatGPT scope", () => {
    assert.equal(canManageChatGptConnection({ scope: "USER", isActiveLocationMember: true, isActiveLocationAdmin: false, isCurrentUserScope: true }), true);
    assert.equal(canManageChatGptConnection({ scope: "USER", isActiveLocationMember: true, isActiveLocationAdmin: true, isCurrentUserScope: false }), false);
});

test("only an active-location admin can manage location ChatGPT", () => {
    assert.equal(canManageChatGptConnection({ scope: "LOCATION", isActiveLocationMember: true, isActiveLocationAdmin: true, isCurrentUserScope: true }), true);
    assert.equal(canManageChatGptConnection({ scope: "LOCATION", isActiveLocationMember: true, isActiveLocationAdmin: false, isCurrentUserScope: true }), false);
    assert.equal(canManageChatGptConnection({ scope: "LOCATION", isActiveLocationMember: false, isActiveLocationAdmin: true, isCurrentUserScope: true }), false);
});
