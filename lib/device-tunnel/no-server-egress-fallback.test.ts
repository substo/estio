import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DEVICE_EGRESS_FAILURE_SCENARIOS, planDeviceEgressFailureResponse } from "./multi-node-operations";

test("device-egress operator unbinding cannot activate server egress", async () => {
    const source = await readFile(new URL("../../app/api/admin/whatsapp-egress/bind/route.ts", import.meta.url), "utf8");
    assert.doesNotMatch(source, /egressMode:\s*["']server["']/);
    assert.match(source, /egressMode:\s*["']device_tunnel["']/);
});

test("every multi-node failure remains fail-closed without server fallback", () => {
    for (const scenario of DEVICE_EGRESS_FAILURE_SCENARIOS) {
        assert.equal(planDeviceEgressFailureResponse(scenario).serverEgressFallback, false, scenario);
    }
});
