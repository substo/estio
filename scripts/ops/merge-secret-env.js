const fs = require("node:fs");
const path = require("node:path");

function envKey(line) {
    const match = String(line).match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=/);
    return match?.[1] || null;
}

function mergeSecretEnv(targetPath, overlayPath) {
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
    const merged = `${retained.join("\n")}\n\n# Server-managed secret overlay\n${normalizedOverlay.join("\n")}\n`;
    const temporaryPath = path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.merge-${process.pid}`);
    fs.writeFileSync(temporaryPath, merged, { mode: 0o600, flag: "wx" });
    fs.renameSync(temporaryPath, targetPath);
    fs.chmodSync(targetPath, 0o600);
    return { merged: true, keyCount: keys.size };
}

if (require.main === module) {
    const [targetPath, overlayPath] = process.argv.slice(2);
    if (!targetPath || !overlayPath) throw new Error("secret_env_paths_required");
    process.stdout.write(`${JSON.stringify(mergeSecretEnv(targetPath, overlayPath))}\n`);
}

module.exports = { envKey, mergeSecretEnv };
