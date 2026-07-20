import { parseArgs } from "node:util";

async function main() {
const { values } = parseArgs({
    options: {
        action: { type: "string" },
        "gateway-url": { type: "string", default: "http://127.0.0.1:3220" },
        "change-ref": { type: "string" },
        execute: { type: "boolean", default: false },
    },
    strict: true,
});
const action = String(values.action || "");
const changeRef = String(values["change-ref"] || "").trim();
const gatewayUrl = new URL(String(values["gateway-url"]));
if (!new Set(["drain", "resume"]).has(action)) throw new Error("--action must be drain or resume");
if (!changeRef || !/^[A-Za-z0-9_.:-]{1,128}$/.test(changeRef)) throw new Error("A reviewable --change-ref is required");
if (gatewayUrl.protocol !== "http:" || !new Set(["127.0.0.1", "localhost", "[::1]"]).has(gatewayUrl.hostname)) {
    throw new Error("Gateway controls must be invoked through a loopback endpoint on the target node");
}
const plan = { action, changeRef, gatewayUrl: gatewayUrl.origin, execute: Boolean(values.execute) };
if (!values.execute) {
    process.stdout.write(`${JSON.stringify({ ok: true, dryRun: true, plan }, null, 2)}\n`);
    process.exit(0);
}
const secret = String(process.env.DEVICE_TUNNEL_INTERNAL_SECRET || "").trim();
if (!secret) throw new Error("DEVICE_TUNNEL_INTERNAL_SECRET is required for execution");
const response = await fetch(new URL(`/admin/${action}`, gatewayUrl), {
    method: "POST",
    headers: { "x-device-tunnel-secret": secret, "x-change-ref": changeRef },
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
});
const body = await response.json().catch(() => null);
if (!response.ok) throw new Error(`Gateway ${action} failed with status ${response.status}`);
process.stdout.write(`${JSON.stringify({ ok: true, dryRun: false, action, status: body?.status }, null, 2)}\n`);
}

void main().catch((error) => {
    console.error(String(error?.message || error).slice(0, 200));
    process.exitCode = 1;
});
