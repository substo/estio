import test from "node:test";
import assert from "node:assert/strict";
import { operationCapability } from "./provider-outbox";
import { buildProviderOutboxIdempotencyKey } from "./provider-outbox-keys";

test("buildProviderOutboxIdempotencyKey is stable for provider mirror rows", () => {
    const input = {
        provider: "ghl",
        providerAccountId: "loc_123",
        operation: "mirror_message",
        locationId: "estio_loc",
        conversationId: "conv_1",
        messageId: "msg_1",
        contactId: "contact_1",
    };

    assert.equal(
        buildProviderOutboxIdempotencyKey(input),
        buildProviderOutboxIdempotencyKey({ ...input })
    );
    assert.equal(
        buildProviderOutboxIdempotencyKey({ ...input, providerAccountId: null }),
        "provider_outbox:ghl:default:mirror_message:estio_loc:conv_1:msg_1:contact_1"
    );
});

test("buildProviderOutboxIdempotencyKey scopes Google contact sync to the user account", () => {
    assert.equal(
        buildProviderOutboxIdempotencyKey({
            provider: "google",
            providerAccountId: "user_123",
            operation: "sync_contact",
            locationId: "estio_loc",
            contactId: "contact_1",
        }),
        "provider_outbox:google:user_123:sync_contact:estio_loc:-:-:contact_1"
    );
});

test("operationCapability routes provider outbox operations to capability checks", () => {
    assert.equal(operationCapability("mirror_conversation"), "canMirrorOutbound");
    assert.equal(operationCapability("mirror_message"), "canMirrorOutbound");
    assert.equal(operationCapability("sync_contact"), "canSyncContacts");
    assert.equal(operationCapability("sync_status"), "canUpdateStatus");
    assert.equal(operationCapability("unknown"), null);
});
