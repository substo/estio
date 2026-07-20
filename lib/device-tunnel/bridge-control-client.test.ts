import assert from "node:assert/strict";
import test from "node:test";
import { createDeviceTunnelBridgeControlClient } from "./bridge-control-client";

const ownership = {
    locationId: "location-1", sessionId: "session-1", bindingId: "binding-1",
    gatewayNodeId: "node-1", assignmentEpoch: 2, ownerInstanceId: "owner-1", leaseEpoch: 3,
};

test("bridge control uses authenticated bounded endpoints and exact ownership", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = createDeviceTunnelBridgeControlClient({
        baseUrl: "http://127.0.0.1:3218/",
        secret: "internal-secret",
        fetchImpl: (async (url: string, init: RequestInit) => {
            calls.push({ url, init });
            return { ok: true, status: 200 } as Response;
        }) as any,
    });
    await client.startSession({ sessionId: "session/1", locationId: "location-1", ownership });
    assert.equal(calls[0].url, "http://127.0.0.1:3218/sessions/session%2F1/start");
    assert.equal((calls[0].init.headers as any)["x-whatsapp-web-bridge-secret"], "internal-secret");
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), { locationId: "location-1", ownership });
    assert.equal(await client.fenceSession({ sessionId: "session-1", ownership }), true);
});

test("bridge control fails closed without credentials or on rejected starts", async () => {
    assert.throws(() => createDeviceTunnelBridgeControlClient({ baseUrl: "http://127.0.0.1:3218", secret: "" }));
    const client = createDeviceTunnelBridgeControlClient({
        baseUrl: "http://127.0.0.1:3218", secret: "secret",
        fetchImpl: (async () => ({ ok: false, status: 409 })) as any,
    });
    await assert.rejects(() => client.startSession({ sessionId: "session-1", locationId: "location-1", ownership }), /start_rejected_409/);
});
