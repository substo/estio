import assert from "node:assert/strict";
import test from "node:test";
import {
    computeWhatsAppCustomerServiceExpiresAt,
    hasOpenWhatsAppCustomerServiceWindow,
} from "./customer-window";

test("computeWhatsAppCustomerServiceExpiresAt adds 24 hours", () => {
    const inboundAt = new Date("2026-05-09T10:00:00.000Z");
    assert.equal(
        computeWhatsAppCustomerServiceExpiresAt(inboundAt)?.toISOString(),
        "2026-05-10T10:00:00.000Z"
    );
});

test("hasOpenWhatsAppCustomerServiceWindow closes after expiration", () => {
    const expiresAt = new Date("2026-05-10T10:00:00.000Z");
    assert.equal(hasOpenWhatsAppCustomerServiceWindow(expiresAt, new Date("2026-05-10T09:59:59.000Z")), true);
    assert.equal(hasOpenWhatsAppCustomerServiceWindow(expiresAt, new Date("2026-05-10T10:00:00.000Z")), false);
});
