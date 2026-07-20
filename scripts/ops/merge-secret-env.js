const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

function envKey(line) {
    const match = String(line).match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=/);
    return match?.[1] || null;
}

function mergeSecretEnv(targetPath, overlayPath, options = {}) {
    const overlayStat = fs.statSync(overlayPath);
    if (!overlayStat.isFile() || (overlayStat.mode & 0o077) !== 0) {
        throw new Error("secret_env_permissions_invalid");
    }
    const overlayLines = fs.readFileSync(overlayPath, "utf8").split(/\r?\n/);
    const keys = new Set();
    for (const line of overlayLines) {
        if (!line.trim() || line.trimStart().startsWith("#")) continue;
        const key = envKey(line);
        if (!key) throw new Error("secret_env_line_invalid");
        if (keys.has(key)) throw new Error("secret_env_key_duplicate");
        keys.add(key);
    }
    if (!keys.size) throw new Error("secret_env_empty");

    const targetLines = fs.readFileSync(targetPath, "utf8").split(/\r?\n/);
    const retained = targetLines.filter((line) => {
        const key = envKey(line);
        return !key || !keys.has(key);
    });
    while (retained.length && !retained[retained.length - 1]) retained.pop();
    const normalizedOverlay = overlayLines.filter((line, index) => line || index < overlayLines.length - 1);
    const combined = [
        ...retained,
        "",
        "# Server-managed secret overlay",
        ...normalizedOverlay,
    ];
    let runtimeOwnerGenerated = false;
    if (options.generateRuntimeOwner) {
        const runtimeEnforcement = [...combined].reverse().find((line) => envKey(line) === "DEVICE_TUNNEL_RUNTIME_LEASE_ENFORCEMENT");
        const enabled = String(runtimeEnforcement || "").split("=", 2)[1]?.trim().replace(/^['\"]|['\"]$/g, "") === "true";
        if (enabled) {
            for (let index = combined.length - 1; index >= 0; index -= 1) {
                if (envKey(combined[index]) === "DEVICE_TUNNEL_RUNTIME_OWNER_INSTANCE_ID") combined.splice(index, 1);
            }
            combined.push(`DEVICE_TUNNEL_RUNTIME_OWNER_INSTANCE_ID=deploy-${randomUUID()}`);
            runtimeOwnerGenerated = true;
        }
    }
    const merged = `${combined.join("\n")}\n`;
    const temporaryPath = path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.merge-${process.pid}`);
    fs.writeFileSync(temporaryPath, merged, { mode: 0o600, flag: "wx" });
    fs.renameSync(temporaryPath, targetPath);
    fs.chmodSync(targetPath, 0o600);
    return { merged: true, keyCount: keys.size, runtimeOwnerGenerated };
}

if (require.main === module) {
    const [targetPath, overlayPath] = process.argv.slice(2);
    if (!targetPath || !overlayPath) throw new Error("secret_env_paths_required");
    process.stdout.write(`${JSON.stringify(mergeSecretEnv(targetPath, overlayPath, {
        generateRuntimeOwner: process.argv.includes("--runtime-owner"),
    }))}\n`);
}

module.exports = { envKey, mergeSecretEnv };
