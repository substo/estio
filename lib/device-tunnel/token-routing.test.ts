import assert from "node:assert/strict";
import test from "node:test";
import { resolveDeviceTunnelTokenRouting } from "./token-routing";

test("flag-off token routing preserves the configured global single-node URL", () => {
    assert.deepEqual(resolveDeviceTunnelTokenRouting({
        distributedPlacement: false,
        binding: {
            gatewayNodeId: "assigned-node",
            gatewayNode: { publicUrl: "wss://assigned.example.test/device-tunnel" },
        },
        env: {
            DEVICE_TUNNEL_GATEWAY_NODE_ID: "single-node",
            DEVICE_TUNNEL_PUBLIC_URL: "wss://global.example.test/device-tunnel",
        } as NodeJS.ProcessEnv,
        productionUrls: true,
    }), {
        nodeId: "single-node",
        gatewayUrl: "wss://global.example.test/device-tunnel",
    });
});

test("distributed token routing uses only the assigned registry node URL", () => {
    assert.deepEqual(resolveDeviceTunnelTokenRouting({
        distributedPlacement: true,
        binding: {
            gatewayNodeId: "node-b",
            gatewayNode: { publicUrl: "wss://node-b.example.test/device-tunnel" },
        },
        env: {
            DEVICE_TUNNEL_GATEWAY_NODE_ID: "single-node",
            DEVICE_TUNNEL_PUBLIC_URL: "wss://global.example.test/device-tunnel",
        } as NodeJS.ProcessEnv,
        productionUrls: true,
    }), {
        nodeId: "node-b",
        gatewayUrl: "wss://node-b.example.test/device-tunnel",
    });
});
