import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

const script = new URL("./whatsapp-bridge-pm2-singleton.js", import.meta.url);

function run(entries, extraEnv = {}) {
    const output = execFileSync(process.execPath, [script.pathname], {
        encoding: "utf8",
        env: {
            ...process.env,
            PM2_JLIST_JSON: JSON.stringify(entries),
            WHATSAPP_BRIDGE_APP_NAME: "estio-whatsapp-web-bridge",
            EXPECTED_CWD: "/home/martin/estio-app",
            EXPECTED_WEBHOOK_URL: "https://estio.co/api/webhooks/whatsapp-web-bridge",
            EXPECTED_SESSION_DIR: "/home/martin/whatsapp-web-sessions",
            ...extraEnv,
        },
    });
    return JSON.parse(output);
}

test("keeps the online bridge with expected cwd, webhook, and session dir", () => {
    const result = run([
        {
            name: "estio-whatsapp-web-bridge",
            pm_id: 10,
            pid: 111,
            pm2_env: {
                status: "online",
                restart_time: 20,
                pm_cwd: "/home/martin/estio-app",
                WHATSAPP_WEB_BRIDGE_APP_WEBHOOK_URL: "https://estio.co/api/webhooks/whatsapp-web-bridge",
                WHATSAPP_WEB_BRIDGE_SESSION_DIR: "/home/martin/whatsapp-web-sessions",
            },
        },
        {
            name: "estio-whatsapp-web-bridge",
            pm_id: 11,
            pid: 112,
            pm2_env: {
                status: "online",
                restart_time: 0,
                pm_cwd: "/home/martin/estio-app-green",
            },
        },
    ]);

    assert.equal(result.keep.id, 10);
    assert.deepEqual(result.duplicates.map((entry) => entry.id), [11]);
});

test("ignores unrelated pm2 apps", () => {
    const result = run([
        { name: "estio-app-blue", pm_id: 1, pid: 100, pm2_env: { status: "online" } },
        { name: "estio-scrape-worker", pm_id: 2, pid: 200, pm2_env: { status: "online" } },
    ]);

    assert.equal(result.count, 0);
    assert.equal(result.keep, null);
    assert.deepEqual(result.duplicates, []);
});
