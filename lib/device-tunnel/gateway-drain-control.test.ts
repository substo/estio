import assert from "node:assert/strict";
import test from "node:test";
import { DeviceTunnelGatewayDrainController } from "./gateway-drain-control";

test("drain persists the process fence before closing sessions and resume is fenced", async () => {
    const events: string[] = [];
    let persist = true;
    const controller = new DeviceTunnelGatewayDrainController({
        async persistDrainState(draining) { events.push(`persist:${draining}`); return persist; },
        async fenceConnectedSessions() { events.push("fence"); },
        closeServer() { events.push("close"); },
    });
    assert.equal(await controller.drain(), true);
    assert.deepEqual(events, ["persist:true", "fence"]);
    assert.equal(await controller.drain(), false);
    persist = false;
    assert.equal(await controller.resume(), false);
    assert.equal(controller.isDraining, true);
    persist = true;
    assert.equal(await controller.resume(), true);
    assert.equal(controller.isDraining, false);
});

test("shutdown of an already drained generation closes without repeating fences", async () => {
    let fenced = 0;
    let closed = 0;
    const controller = new DeviceTunnelGatewayDrainController({
        async persistDrainState() { return true; },
        async fenceConnectedSessions() { fenced += 1; },
        closeServer() { closed += 1; },
    });
    await controller.drain();
    await controller.drain(true);
    assert.equal(fenced, 1);
    assert.equal(closed, 1);
});
