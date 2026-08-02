import assert from "node:assert/strict";
import test from "node:test";
import { getDeviceHeaderStatus } from "./device-header-status";

test("shows checking until the server-derived device list loads", () => {
    assert.equal(getDeviceHeaderStatus([], true).label, "CHECKING");
});

test("shows live only when a paired device is online", () => {
    const status = getDeviceHeaderStatus([
        { paired: true, status: "offline" },
        { paired: true, status: "online" },
    ], false);
    assert.equal(status.label, "LIVE");
    assert.equal(status.pulse, true);
});

test("shows offline when paired devices exist but none are online", () => {
    const status = getDeviceHeaderStatus([{ paired: true, status: "offline" }], false);
    assert.equal(status.label, "OFFLINE");
    assert.equal(status.pulse, false);
});

test("shows no devices for an empty or pairing-only list", () => {
    assert.equal(getDeviceHeaderStatus([], false).label, "NO DEVICES");
    assert.equal(
        getDeviceHeaderStatus([{ paired: false, status: "offline" }], false).label,
        "NO DEVICES",
    );
});
