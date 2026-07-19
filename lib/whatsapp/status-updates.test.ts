import test from "node:test";
import assert from "node:assert/strict";

import { resolveMonotonicWhatsAppDeliveryStatus } from "./status-updates";

test("WhatsApp delivery acknowledgements only advance", () => {
    assert.equal(resolveMonotonicWhatsAppDeliveryStatus("dispatch_accepted", "sent"), "sent");
    assert.equal(resolveMonotonicWhatsAppDeliveryStatus("sent", "delivered"), "delivered");
    assert.equal(resolveMonotonicWhatsAppDeliveryStatus("delivered", "read"), "read");
    assert.equal(resolveMonotonicWhatsAppDeliveryStatus("read", "delivered"), "read");
    assert.equal(resolveMonotonicWhatsAppDeliveryStatus("delivered", "sent"), "delivered");
});

test("a late failure does not overwrite provider-confirmed delivery", () => {
    assert.equal(resolveMonotonicWhatsAppDeliveryStatus("delivered", "failed"), "delivered");
    assert.equal(resolveMonotonicWhatsAppDeliveryStatus("dispatch_accepted", "failed"), "failed");
});
