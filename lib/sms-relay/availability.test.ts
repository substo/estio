import assert from "node:assert/strict";
import test from "node:test";

import { deriveSmsRelayAvailability } from "./availability";

test("Android SMS relay availability depends on relay config, not GHL SMS", () => {
    assert.deepEqual(
        deriveSmsRelayAvailability({
            smsRelayEnabled: true,
            contactPhone: "+35797428827",
            device: { id: "device_1", paired: true, status: "online" },
        }),
        {
            available: true,
            reason: null,
            label: null,
            deviceId: "device_1",
        }
    );
});

test("Android SMS relay fails closed for missing contact or device prerequisites", () => {
    assert.equal(
        deriveSmsRelayAvailability({
            smsRelayEnabled: true,
            contactPhone: null,
            device: { id: "device_1", paired: true, status: "online" },
        }).reason,
        "missing_phone"
    );

    assert.equal(
        deriveSmsRelayAvailability({
            smsRelayEnabled: false,
            contactPhone: "+35797428827",
            device: { id: "device_1", paired: true, status: "online" },
        }).reason,
        "sms_relay_disabled"
    );

    assert.equal(
        deriveSmsRelayAvailability({
            smsRelayEnabled: true,
            contactPhone: "+35797428827",
            device: { id: "device_1", paired: true, status: "offline" },
        }).reason,
        "sms_relay_offline"
    );
});
