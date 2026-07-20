import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import mergeModule from "./merge-secret-env.js";

const { mergeSecretEnv } = mergeModule;

test("server secret overlay replaces matching keys without exposing values", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "merge-secret-env-"));
    const target = path.join(directory, ".env");
    const overlay = path.join(directory, "overlay.env");
    fs.writeFileSync(target, "KEEP=yes\nREPLACE=old\n", { mode: 0o600 });
    fs.writeFileSync(overlay, "REPLACE='new secret'\nADDED=value\n", { mode: 0o600 });
    const result = mergeSecretEnv(target, overlay);
    assert.deepEqual(result, { merged: true, keyCount: 2, runtimeOwnerGenerated: false });
    assert.match(fs.readFileSync(target, "utf8"), /KEEP=yes/);
    assert.doesNotMatch(fs.readFileSync(target, "utf8"), /REPLACE=old/);
    assert.match(fs.readFileSync(target, "utf8"), /REPLACE='new secret'/);
    assert.equal(fs.statSync(target).mode & 0o777, 0o600);
    fs.rmSync(directory, { recursive: true, force: true });
});

test("enabled runtime enforcement receives a fresh deployment owner", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "merge-secret-env-"));
    const target = path.join(directory, ".env");
    const overlay = path.join(directory, "overlay.env");
    fs.writeFileSync(target, "DEVICE_TUNNEL_RUNTIME_OWNER_INSTANCE_ID=old-owner\n", { mode: 0o600 });
    fs.writeFileSync(overlay, "DEVICE_TUNNEL_RUNTIME_LEASE_ENFORCEMENT=true\n", { mode: 0o600 });
    const result = mergeSecretEnv(target, overlay, { generateRuntimeOwner: true });
    const contents = fs.readFileSync(target, "utf8");
    assert.equal(result.runtimeOwnerGenerated, true);
    assert.doesNotMatch(contents, /old-owner/);
    assert.match(contents, /DEVICE_TUNNEL_RUNTIME_OWNER_INSTANCE_ID=deploy-[0-9a-f-]{36}/);
    fs.rmSync(directory, { recursive: true, force: true });
});

test("server secret overlay rejects group-readable files and duplicate keys", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "merge-secret-env-"));
    const target = path.join(directory, ".env");
    const overlay = path.join(directory, "overlay.env");
    fs.writeFileSync(target, "KEEP=yes\n", { mode: 0o600 });
    fs.writeFileSync(overlay, "A=1\n", { mode: 0o640 });
    assert.throws(() => mergeSecretEnv(target, overlay), /secret_env_permissions_invalid/);
    fs.chmodSync(overlay, 0o600);
    fs.writeFileSync(overlay, "A=1\nA=2\n", { mode: 0o600 });
    assert.throws(() => mergeSecretEnv(target, overlay), /secret_env_key_duplicate/);
    fs.rmSync(directory, { recursive: true, force: true });
});
