import test from "node:test";
import assert from "node:assert/strict";
import { mapWhatsAppDeliveryStatus } from "@/lib/whatsapp/sync";

test("mapWhatsAppDeliveryStatus maps Web Bridge ack states", () => {
    assert.equal(mapWhatsAppDeliveryStatus("SERVER_ACK"), "sent");
    assert.equal(mapWhatsAppDeliveryStatus("DELIVERED"), "delivered");
    assert.equal(mapWhatsAppDeliveryStatus("READ"), "read");
    assert.equal(mapWhatsAppDeliveryStatus("FAILED"), "failed");
    assert.equal(mapWhatsAppDeliveryStatus(""), "");
});
