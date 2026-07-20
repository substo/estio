import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("gateway and bridge entrypoints do not log raw operational identifiers or paths", async () => {
    const [gateway, bridge] = await Promise.all([
        readFile("scripts/device-tunnel-gateway.ts", "utf8"),
        readFile("scripts/whatsapp-web-bridge-service.ts", "utf8"),
    ]);

    for (const source of [gateway, bridge]) {
        assert.doesNotMatch(
            source,
            /console\.(?:log|info|warn|error)\([\s\S]{0,240}\$\{(?:sessionId|messageId|fallbackJid|SESSION_DIR|GATEWAY_NODE_ID)\}/,
        );
        assert.doesNotMatch(
            source,
            /console\.(?:log|info|warn|error)\([\s\S]{0,240}(?:error\?\.message|error\?\.stack|\|\| error)/,
        );
    }
    assert.doesNotMatch(bridge, /session dir \$\{SESSION_DIR\}/i);
    assert.match(bridge, /sessionDirFingerprint: fingerprintOperationalPath\(SESSION_DIR\)/);
});
