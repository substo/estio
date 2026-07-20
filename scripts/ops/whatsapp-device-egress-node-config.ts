import { parseArgs } from "node:util";
import {
    isDeviceTunnelAndroidTrustedHostname,
    validateTrustedDeviceTunnelGatewayUrl,
} from "../../lib/device-tunnel/gateway-url";

const { values } = parseArgs({
    options: {
        "node-id": { type: "string" },
        region: { type: "string" },
        "public-url": { type: "string" },
        "trusted-host-suffix": { type: "string", multiple: true },
        capacity: { type: "string", default: "100" },
        "gateway-port": { type: "string", default: "3220" },
        "bridge-port": { type: "string", default: "3218" },
        "session-dir": { type: "string" },
    },
    strict: true,
});

const nodeId = String(values["node-id"] || "").trim();
const region = String(values.region || "").trim();
const trustedHostSuffixes = (values["trusted-host-suffix"] || []).map((entry) => String(entry));
const publicUrl = validateTrustedDeviceTunnelGatewayUrl({
    value: String(values["public-url"] || ""),
    trustedHostSuffixes,
    production: true,
});
if (!isDeviceTunnelAndroidTrustedHostname(new URL(publicUrl).hostname)) {
    throw new Error("Node hostname is outside the Android estio.co trust boundary");
}
const capacity = Number(values.capacity);
const gatewayPort = Number(values["gateway-port"]);
const bridgePort = Number(values["bridge-port"]);
const sessionDir = String(values["session-dir"] || "").trim();
if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(nodeId) || !region || !sessionDir.startsWith("/")) {
    throw new Error("Stable node ID, region, and absolute session directory are required");
}
if (![capacity, gatewayPort, bridgePort].every((value) => Number.isSafeInteger(value) && value > 0)) {
    throw new Error("Capacity and ports must be positive integers");
}

const lines = [
    `DEVICE_TUNNEL_GATEWAY_NODE_ID=${nodeId}`,
    `DEVICE_TUNNEL_GATEWAY_REGION=${region}`,
    `DEVICE_TUNNEL_PUBLIC_URL=${publicUrl}`,
    `DEVICE_TUNNEL_TRUSTED_HOST_SUFFIXES=${trustedHostSuffixes.join(",")}`,
    `DEVICE_TUNNEL_GATEWAY_PORT=${gatewayPort}`,
    `DEVICE_TUNNEL_GATEWAY_INTERNAL_URL=http://127.0.0.1:${gatewayPort}`,
    `DEVICE_TUNNEL_GATEWAY_CAPACITY_SESSIONS=${capacity}`,
    `WHATSAPP_WEB_BRIDGE_PORT=${bridgePort}`,
    `WHATSAPP_WEB_BRIDGE_URL=http://127.0.0.1:${bridgePort}`,
    `WHATSAPP_WEB_BRIDGE_SESSION_DIR=${sessionDir}`,
    "DEVICE_TUNNEL_DISTRIBUTED_PLACEMENT=false",
    "DEVICE_TUNNEL_RUNTIME_LEASE_ENFORCEMENT=false",
    "WHATSAPP_SESSION_AUTH_MODE=local",
    "WHATSAPP_RATE_LIMIT_MODE=disabled",
    "# Secrets and canary scopes are intentionally omitted; distribute them through the node secret manager.",
];
process.stdout.write(`${lines.join("\n")}\n`);
