#!/usr/bin/env node

const { execSync } = require("child_process");

const appName = process.env.WHATSAPP_BRIDGE_APP_NAME || "estio-whatsapp-web-bridge";
const expectedCwd = process.env.EXPECTED_CWD || "";
const expectedWebhookUrl = process.env.EXPECTED_WEBHOOK_URL || "";
const expectedSessionDir = process.env.EXPECTED_SESSION_DIR || "";
const apply = process.env.APPLY === "1";

function readPm2List() {
    const override = process.env.PM2_JLIST_JSON;
    if (override) return JSON.parse(override);
    return JSON.parse(execSync("pm2 jlist", { encoding: "utf8" }));
}

function envValue(entry, key) {
    return entry?.pm2_env?.[key] || entry?.pm2_env?.env?.[key] || "";
}

function score(entry) {
    let value = 0;
    const status = String(entry?.pm2_env?.status || entry?.status || "");
    const pid = Number(entry?.pid || 0);
    const restarts = Number(entry?.pm2_env?.restart_time || 0);
    const uptime = Number(entry?.pm2_env?.pm_uptime || 0);
    if (status === "online") value += 100;
    if (pid > 0) value += 20;
    if (expectedCwd && String(entry?.pm2_env?.pm_cwd || "") === expectedCwd) value += 20;
    if (expectedWebhookUrl && envValue(entry, "WHATSAPP_WEB_BRIDGE_APP_WEBHOOK_URL") === expectedWebhookUrl) value += 15;
    if (expectedSessionDir && envValue(entry, "WHATSAPP_WEB_BRIDGE_SESSION_DIR") === expectedSessionDir) value += 15;
    value -= Math.min(restarts, 50);
    value += Math.min(Math.floor(Math.max(0, Date.now() - uptime) / 1000), 3600) / 3600;
    return value;
}

function summarize(entry) {
    return {
        id: entry?.pm_id,
        name: entry?.name,
        pid: entry?.pid || 0,
        status: entry?.pm2_env?.status || entry?.status || "unknown",
        restarts: Number(entry?.pm2_env?.restart_time || 0),
        cwd: entry?.pm2_env?.pm_cwd || "",
        webhookUrl: envValue(entry, "WHATSAPP_WEB_BRIDGE_APP_WEBHOOK_URL"),
        sessionDir: envValue(entry, "WHATSAPP_WEB_BRIDGE_SESSION_DIR"),
        score: score(entry),
    };
}

const list = readPm2List();
const matches = list.filter((entry) => entry && entry.name === appName);
matches.sort((a, b) => score(b) - score(a));

const keep = matches[0] || null;
const duplicates = keep ? matches.slice(1) : [];

if (apply) {
    for (const entry of duplicates) {
        const id = entry?.pm_id;
        if (id === undefined || id === null) continue;
        try {
            execSync(`pm2 delete ${id}`, { stdio: "inherit" });
        } catch {
            // Keep going; the deploy script will still report the final state.
        }
    }
}

process.stdout.write(JSON.stringify({
    appName,
    count: matches.length,
    keep: keep ? summarize(keep) : null,
    duplicates: duplicates.map(summarize),
    apply,
}, null, 2));
process.stdout.write("\n");
