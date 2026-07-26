import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const componentUrl = new URL("./sto-secure-delivery-indicator.tsx", import.meta.url);

test("STO indicator provides progressive disclosure and a connected-device action", async () => {
    const source = await readFile(componentUrl, "utf8");

    assert.match(source, /<Popover>/);
    assert.match(source, /<PopoverTrigger asChild>/);
    assert.match(source, /Click to learn about STO Secure Delivery/);
    assert.match(source, /Your WhatsApp message is sent through your connected STO device/);
    assert.match(source, /If the device disconnects, messages wait safely/);
    assert.match(source, /Last relay heartbeat/);
    assert.match(source, /View STO settings and device/);
    assert.match(source, /\/admin\/settings\/integrations\/sms-relay#sto-secure-delivery/);
});
