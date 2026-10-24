import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Runs the exact remote snippets from deploy-local-build.sh against temporary files.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const deployScript = fs.readFileSync(path.join(root, "deploy-local-build.sh"), "utf8");

function heredoc(name) {
    const match = deployScript.match(new RegExp(`<<'${name}'\\n([\\s\\S]*?)\\n${name}\\n`));
    assert.ok(match, `${name} heredoc not found`);
    return match[1];
}

const activationCommand = deployScript.match(/^STUDIO_ACTIVATION=\$\((node -e .*)\)$/m)?.[1];

function sandbox() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-studio-env-"));
    // The server uses GNU stat; provide its `-c %a` form on any test host.
    const bin = path.join(directory, "bin");
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, "stat"), `#!/bin/sh\nexec node -e 'process.stdout.write((require("node:fs").statSync(process.argv[1]).mode & 0o777).toString(8))' "$3"\n`, { mode: 0o755 });
    return { directory, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } };
}

function run(script, args, { directory, env }) {
    return spawnSync("bash", ["-s", "--", ...args], { input: script, cwd: directory, env, encoding: "utf8" });
}

const completeStudioEnv = [
    "STUDIO_SUPABASE_URL=https://example.supabase.co",
    "STUDIO_SUPABASE_SERVICE_ROLE_KEY=s1",
    "STUDIO_SECRETS_KEY=s2",
    "STUDIO_SECRETS_KEY_ID=k1",
    "SUBSTO_CLERK_PUBLISHABLE_KEY=pk",
    "SUBSTO_CLERK_SECRET_KEY=sk",
    "CLERK_ENCRYPTION_KEY=ek",
].join("\n") + "\n";

test("activation follows a nonblank SUBSTO_APP_HOSTS in .env.prod", () => {
    assert.ok(activationCommand);
    const box = sandbox();
    for (const [contents, expected] of [
        ["SUBSTO_APP_HOSTS=substo.com\n", "1"],
        ["export SUBSTO_APP_HOSTS='substo.com'\n", "1"],
        ["SUBSTO_APP_HOSTS=\n", ""],
        ["SUBSTO_APP_HOSTS=\"\"\n", ""],
        ["# SUBSTO_APP_HOSTS=substo.com\nOTHER=1\n", ""],
        ["SUBSTO_APP_HOSTS=substo.com\nSUBSTO_APP_HOSTS=\n", ""],
    ]) {
        fs.writeFileSync(path.join(box.directory, ".env.prod"), contents);
        const result = spawnSync("bash", ["-c", activationCommand], { cwd: box.directory, encoding: "utf8" });
        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.stdout, expected, contents);
    }
    fs.rmSync(box.directory, { recursive: true, force: true });
});

test("studio overlay check requires an owner-only file with required keys and prints no values", () => {
    const box = sandbox();
    const studioEnv = path.join(box.directory, "studio.env");
    const check = heredoc("STUDIO_ENV_CHECK");
    assert.notEqual(run(check, [studioEnv], box).status, 0);

    fs.writeFileSync(studioEnv, completeStudioEnv, { mode: 0o644 });
    assert.match(run(check, [studioEnv], box).stdout, /owner-only/);
    fs.chmodSync(studioEnv, 0o600);
    const ok = run(check, [studioEnv], box);
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);

    fs.writeFileSync(studioEnv, completeStudioEnv.replace("SUBSTO_CLERK_SECRET_KEY=sk", "SUBSTO_CLERK_SECRET_KEY="), { mode: 0o600 });
    const missing = run(check, [studioEnv], box);
    assert.notEqual(missing.status, 0);
    assert.match(missing.stdout, /lacks: SUBSTO_CLERK_SECRET_KEY/);
    for (const secret of ["s1", "s2", "pk", "ek"]) assert.ok(!missing.stdout.includes(`=${secret}`));
    fs.rmSync(box.directory, { recursive: true, force: true });
});

test("release env merges the studio overlay only when activated", () => {
    const box = sandbox();
    const target = path.join(box.directory, "release");
    fs.mkdirSync(path.join(target, "scripts/ops"), { recursive: true });
    fs.copyFileSync(path.join(root, "scripts/ops/merge-secret-env.js"), path.join(target, "scripts/ops/merge-secret-env.js"));
    const serverEnv = path.join(box.directory, "server.env");
    const studioEnv = path.join(box.directory, "studio.env");
    fs.writeFileSync(serverEnv, "WHATSAPP_TOKEN=w\n", { mode: 0o600 });
    fs.writeFileSync(studioEnv, completeStudioEnv, { mode: 0o600 });
    const merge = heredoc("MERGE_SECRET_ENV");
    const base = "KEEP=yes\nSUBSTO_APP_HOSTS=substo.com\nSTUDIO_SECRETS_KEY=local\n";

    fs.writeFileSync(path.join(target, ".env"), base, { mode: 0o600 });
    let result = run(merge, [target, serverEnv, studioEnv, "1"], box);
    assert.equal(result.status, 0, result.stderr);
    let contents = fs.readFileSync(path.join(target, ".env"), "utf8");
    assert.match(contents, /WHATSAPP_TOKEN=w/);
    assert.match(contents, /SUBSTO_CLERK_SECRET_KEY=sk/);
    assert.match(contents, /SUBSTO_APP_HOSTS=substo\.com/);
    assert.doesNotMatch(contents, /STUDIO_SECRETS_KEY=local/);

    fs.writeFileSync(path.join(target, ".env"), "KEEP=yes\n", { mode: 0o600 });
    result = run(merge, [target, serverEnv, studioEnv, ""], box);
    assert.equal(result.status, 0, result.stderr);
    contents = fs.readFileSync(path.join(target, ".env"), "utf8");
    assert.match(contents, /WHATSAPP_TOKEN=w/);
    assert.doesNotMatch(contents, /SUBSTO_CLERK|STUDIO_SUPABASE/);

    fs.rmSync(studioEnv);
    assert.notEqual(run(merge, [target, serverEnv, studioEnv, "1"], box).status, 0);

    fs.writeFileSync(studioEnv, "WHATSAPP_TOKEN=collide\n", { mode: 0o600 });
    fs.writeFileSync(path.join(target, ".env"), "KEEP=yes\n", { mode: 0o600 });
    assert.notEqual(run(merge, [target, serverEnv, studioEnv, "1"], box).status, 0);
    assert.equal(fs.readFileSync(path.join(target, ".env"), "utf8"), "KEEP=yes\n");
    fs.rmSync(box.directory, { recursive: true, force: true });
});
