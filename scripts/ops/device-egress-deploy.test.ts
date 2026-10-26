import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Disabled Android device egress must never crash-loop or abort a deploy.
const root = path.resolve(__dirname, "../..");
const tsx = path.join(root, "node_modules/.bin/tsx");
const deployScript = fs.readFileSync(path.join(root, "deploy-local-build.sh"), "utf8");

const expiredCanaryEnv = {
    DEVICE_TUNNEL_DISTRIBUTED_PLACEMENT: "true",
    DEVICE_TUNNEL_RUNTIME_LEASE_ENFORCEMENT: "true",
    WHATSAPP_SESSION_AUTH_MODE: "encrypted_snapshot",
    WHATSAPP_SESSION_AUTH_KMS_KEY_PATH: "projects/p/locations/global/keyRings/r/cryptoKeys/k",
    CLOUDFLARE_R2_ACCOUNT_ID: "a".repeat(32),
    WHATSAPP_SESSION_AUTH_R2_ACCESS_KEY_ID: "dedicated-access",
    WHATSAPP_SESSION_AUTH_R2_SECRET_ACCESS_KEY: "dedicated-secret",
    WHATSAPP_SESSION_AUTH_R2_BUCKET: "private-auth",
    DEVICE_TUNNEL_TRUSTED_HOST_SUFFIXES: "egress.estio.co",
    DEVICE_TUNNEL_CANARY_SCOPES: JSON.stringify([{
        locationId: "location-1",
        sessionId: "session-1",
        bindingId: "binding-1",
        gatewayNodeId: "node-b",
        gatewayUrl: "wss://node-b.egress.estio.co/device-tunnel",
        changeRef: "change-123",
        expiresAt: "2026-09-18T12:28:19.281Z",
    }]),
};

function runTs(script: string, env: NodeJS.ProcessEnv) {
    const clean = Object.fromEntries(Object.entries(process.env)
        .filter(([key]) => !/^(DEVICE_TUNNEL_|WHATSAPP_|CLOUDFLARE_R2_)/.test(key)));
    return spawnSync(tsx, [script], { cwd: root, env: { ...clean, ...env }, encoding: "utf8", timeout: 60_000 });
}

test("an expired canary makes the gateway and bridge exit 0 with a clear reason", () => {
    for (const script of ["scripts/device-tunnel-gateway.ts", "scripts/whatsapp-web-bridge-service.ts"]) {
        // Prisma validates the URL at construction only; nothing connects.
        const result = runTs(script, { ...expiredCanaryEnv, DATABASE_URL: "postgresql://unused@127.0.0.1:1/unused" });
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /disabled: canary_scope_expired/);
    }
});

test("the deploy status command reports enabled, disabled and invalid states", () => {
    const status = (env: NodeJS.ProcessEnv) => runTs("scripts/ops/device-egress-activation.ts", env);
    const disabled = status(expiredCanaryEnv);
    assert.equal(disabled.status, 0);
    assert.equal(disabled.stdout.trim(), "disabled:canary_scope_expired");
    const enabled = status({});
    assert.equal(enabled.status, 0);
    assert.equal(enabled.stdout.trim(), "enabled");
    const invalid = status({ DEVICE_TUNNEL_DISTRIBUTED_PLACEMENT: "true" });
    assert.equal(invalid.status, 1);
    assert.equal(invalid.stdout.trim(), "invalid:placement_lease_mismatch");
});

// Render the remote block the way ssh receives it, then run its egress gate and
// final failure summary against stub pm2/tsx binaries.
function remoteScript() {
    const start = deployScript.indexOf("ssh $SSH_OPTS $SERVER bash << ENDSSH\n");
    const end = deployScript.indexOf("\nENDSSH\n", start);
    assert.ok(start >= 0 && end > start, "remote deploy block not found");
    const body = deployScript.slice(deployScript.indexOf("\n", start) + 1, end);
    const rendered = spawnSync("bash", ["-c", `cat <<ENDSSH\n${body}\nENDSSH\n`], { encoding: "utf8" });
    assert.equal(rendered.status, 0, rendered.stderr);
    return rendered.stdout;
}

function between(source: string, from: string, to: string) {
    const start = source.indexOf(from);
    const end = source.indexOf(to, start);
    assert.ok(start >= 0 && end > start, `${from} .. ${to} not found`);
    return source.slice(start, end);
}

const remote = remoteScript();

function runGate(state: string) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "device-egress-deploy-"));
    try {
        const bin = path.join(dir, "bin");
        const app = path.join(dir, "app");
        fs.mkdirSync(bin);
        fs.mkdirSync(path.join(app, "node_modules/.bin"), { recursive: true });
        fs.writeFileSync(path.join(bin, "pm2"), `#!/bin/sh\necho "pm2 $*" >> "${dir}/calls"\n`, { mode: 0o755 });
        fs.writeFileSync(path.join(app, "node_modules/.bin/tsx"), `#!/bin/sh\necho '${state}'\n`, { mode: 0o755 });
        const script = [
            "set -euo pipefail",
            between(remote, "    POST_CUTOVER_FAILURES=\"\"", "\n    VIEWING_RELAY_PORT="),
            `fence_whatsapp_browser_for_gateway_restart() { echo "fence" >> "${dir}/calls"; }`,
            between(remote, "    DEVICE_EGRESS_STATE=", "    elif [ -n \"${DEVICE_TUNNEL_JWT_SECRET:-}\""),
            "    fi",
            `echo "RUN_WHATSAPP_BRIDGE=$RUN_WHATSAPP_BRIDGE"`,
            between(remote, "    if [ -n \"$POST_CUTOVER_FAILURES\" ]; then", "\n    fi\n") + "\n    fi",
        ].join("\n");
        const result = spawnSync("bash", ["-c", script], {
            encoding: "utf8",
            env: {
                ...process.env,
                PATH: `${bin}:${process.env.PATH}`,
                SYMLINK_PATH: app,
                DEPLOY_STATE_DIR: dir,
                DEVICE_TUNNEL_GATEWAY_APP_NAME: "estio-device-tunnel-gateway",
                WHATSAPP_BRIDGE_APP_NAME: "estio-whatsapp-web-bridge",
            },
        });
        const read = (name: string) => fs.existsSync(path.join(dir, name)) ? fs.readFileSync(path.join(dir, name), "utf8") : "";
        return { ...result, calls: read("calls"), statusFile: read("device-egress-status") };
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

test("a disabled gateway is removed, the bridge is skipped and the deploy continues", () => {
    const result = runGate("disabled:canary_scope_expired");
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /device egress is disabled \(canary_scope_expired\)/);
    assert.match(result.stdout, /RUN_WHATSAPP_BRIDGE=0/);
    assert.match(result.calls, /fence/);
    assert.match(result.calls, /pm2 describe estio-device-tunnel-gateway/);
    assert.match(result.statusFile, / disabled:canary_scope_expired\n$/);
});

test("invalid egress configuration fails loudly, but only after the summary point", () => {
    const result = runGate("invalid:kms_configuration_invalid");
    assert.equal(result.status, 1);
    assert.match(result.stdout, /❌ Android device egress configuration is invalid \(invalid:kms_configuration_invalid\)/);
    assert.match(result.stdout, /old slot drain is scheduled and PM2 state is saved, but these steps failed/);
    assert.equal(result.calls, "");
});

test("an enabled gateway proceeds to the normal start path", () => {
    const result = runGate("enabled");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /RUN_WHATSAPP_BRIDGE=1/);
});

test("no step between the gateway and pm2 save can abort the deploy", () => {
    const postCutover = between(remote, "    DEVICE_EGRESS_STATE=", "    pm2 save\n    pm2 list");
    assert.doesNotMatch(postCutover, /^\s*exit 1\b/m);
    assert.ok(remote.indexOf("pm2 save\n    pm2 list") < remote.indexOf('if [ -n "$POST_CUTOVER_FAILURES" ]; then'));
    for (const app of ["$DEVICE_TUNNEL_GATEWAY_APP_NAME", "$WHATSAPP_BRIDGE_APP_NAME"]) {
        const start = remote.split("\n").find((line) => line.includes(`pm2 start npm --name "${app}"`));
        assert.ok(start?.includes("--stop-exit-codes 0"), `${app} must treat exit 0 as final`);
    }
});

// A PM2 invocation can fail before any readiness probe. Exercise the actual
// start commands under errexit so this failure cannot bypass final cleanup.
test("PM2 start failures are reported after cleanup for both optional runtimes", () => {
    for (const app of ["$DEVICE_TUNNEL_GATEWAY_APP_NAME", "$WHATSAPP_BRIDGE_APP_NAME"]) {
        const start = remote.split("\n").find((line) => line.includes(`pm2 start npm --name "${app}"`));
        assert.ok(start);
        const result = spawnSync("bash", ["-c", [
            "set -euo pipefail",
            between(remote, '    POST_CUTOVER_FAILURES=""', "\n    VIEWING_RELAY_PORT="),
            "pm2() { return 1; }",
            start,
            'echo "drain completed"',
            'echo "pm2 save completed"',
            between(remote, '    if [ -n "$POST_CUTOVER_FAILURES" ]; then', "\n    fi\n") + "\n    fi",
        ].join("\n")], {
            encoding: "utf8",
            env: { ...process.env, DEVICE_TUNNEL_GATEWAY_APP_NAME: "gateway", WHATSAPP_BRIDGE_APP_NAME: "bridge", SYMLINK_PATH: "/unused", DEVICE_TUNNEL_GATEWAY_PORT: "3220", ACTIVE_GATEWAY_RUNTIME_OWNER_INSTANCE_ID: "test", WHATSAPP_BRIDGE_SESSION_DIR: "/unused", WHATSAPP_BRIDGE_APP_WEBHOOK_URL: "http://unused", EXPECTED_BRIDGE_CODE_HASH: "test" },
        });
        assert.equal(result.status, 1, result.stderr);
        assert.match(result.stdout, /failed to start/, result.stderr);
        assert.match(result.stdout, /drain completed\npm2 save completed/);
    }
});
