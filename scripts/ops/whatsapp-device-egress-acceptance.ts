import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { evaluateDeviceEgressCanaryAcceptance } from "../../lib/device-tunnel/multi-node-operations";

async function main() {
const { values } = parseArgs({
    options: {
        observation: { type: "string" },
        template: { type: "boolean", default: false },
    },
    strict: true,
});
if (values.template) {
    process.stdout.write(`${JSON.stringify({
        nodeId: "", expectedNodeId: "",
        assignmentEpoch: 0, previousAssignmentEpoch: 0,
        leaseEpoch: 0, previousLeaseEpoch: 0,
        authEpoch: 0, previousAuthEpoch: 0,
        authGeneration: 0, restoredGeneration: 0,
        gatewayGeneration: "", expectedGatewayGeneration: "",
        authoritativeLeaseCount: 0, activeBrowserCount: 0, profileScopedOrphanChromiumCount: 0,
        androidTunnelReady: false, proxyReady: false, activeBrowserProbeFresh: false,
        authenticatedWebhookFresh: false, latestInboundAt: null, baselineInboundAt: null,
        outboundTunnelProofVerified: false, staleOwnerServeRejected: false,
        staleOwnerReadyRejected: false, staleOwnerCheckpointRejected: false,
    }, null, 2)}\n`);
    return;
}
const observationPath = String(values.observation || "").trim();
if (!observationPath) throw new Error("--observation must point to a redacted canary observation JSON file");
const parsed = JSON.parse(await readFile(observationPath, "utf8"));
for (const key of ["latestInboundAt", "baselineInboundAt"]) {
    parsed[key] = parsed[key] ? new Date(parsed[key]) : null;
}
const result = evaluateDeviceEgressCanaryAcceptance(parsed);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.ok) process.exitCode = 1;
}

void main().catch((error) => {
    console.error(String(error?.message || error).slice(0, 200));
    process.exitCode = 1;
});
