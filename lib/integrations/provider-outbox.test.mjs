import test from "node:test";
import assert from "node:assert/strict";
import { buildProviderOutboxIdempotencyKey } from "./provider-outbox-keys.ts";

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
