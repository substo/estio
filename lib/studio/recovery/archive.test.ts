import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { chmod, link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { aiCredentialContext, encryptStudioSecret } from "../secrets";
import { youtubeProfileContext } from "../../google/youtube-policy";
import { sealRecoveryBundle, verifyRecoveryBundle, type RecoveryState } from "./archive";
const sha = (v: Buffer | string) => createHash("sha256").update(v).digest("hex");
const env = { NODE_ENV: "test" as const, STUDIO_SECRETS_KEY_ID: "current", STUDIO_SECRETS_KEY: Buffer.alloc(32, 1).toString("base64"), STUDIO_SECRETS_PREVIOUS_KEYS: `previous:${Buffer.alloc(32, 2).toString("base64")}` };
async function fixture(run: (f: { root: string; parent: string; mediaFile: string; input: Parameters<typeof verifyRecoveryBundle>[0] }) => Promise<void>) {
 const parent = await mkdtemp(path.join(os.tmpdir(), "studio-recovery-unit-")); const root = path.join(parent, "bundle");
 try {
  await mkdir(path.join(root, "media"), { recursive: true, mode: 0o700 });
  const bytes = Buffer.from("private fixture bytes"), mediaHash = sha(bytes), mediaFile = path.join(root, "media", mediaHash);
  await writeFile(mediaFile, bytes, { mode: 0o600 }); await writeFile(path.join(root, "database.dump"), "inert fixture only; not executed", { mode: 0o600 });
  const workspaceId = "f9100000-0000-4000-8000-000000000001";
  const state: RecoveryState = { schema: 27, tables: [{ name: "studio_records", count: 1, sha256: sha("row state") }],
   media: [{ bucket: "studio-media", key: "private/original", byteSize: bytes.length, sha256: null }],
   credentials: [{ scope: "workspace", workspaceId, cipher: encryptStudioSecret("synthetic-openai-secret", aiCredentialContext(workspaceId, "openai"), env) },
    ...(["estio", "substo"] as const).map(brand => ({ scope: "profile" as const, brand, userId: "user_equal_fixture", cipher: encryptStudioSecret(`synthetic-${brand}`, youtubeProfileContext(brand, "user_equal_fixture", "refresh"), { STUDIO_SECRETS_KEY_ID: "previous", STUDIO_SECRETS_KEY: Buffer.alloc(32, 2).toString("base64") }) }))] };
  await writeFile(path.join(root, "state.json"), JSON.stringify(state), { mode: 0o600 });
  const pin = await sealRecoveryBundle(root, { projectRef: "fixturestudio00000000", bucket: "studio-media", release: "fixture-release", capturedAt: "2026-10-24T00:00:00Z", keyEscrowReceiptSha256: sha("external vault receipt"),
   media: [{ bucket: "studio-media", key: "private/original", byteSize: bytes.length, sha256: mediaHash, file: `media/${mediaHash}` }] });
  await run({ root, parent, mediaFile, input: { root, ...pin, projectRef: "fixturestudio00000000", bucket: "studio-media", env } });
 } finally { await rm(parent, { recursive: true, force: true }); }
}
test("pinned inert archive verifies all media and both key generations without printing private values or claiming a live restore", async () => fixture(async f => {
 const result = await verifyRecoveryBundle(f.input); assert.equal(result.verified, true); assert.equal(result.credentialProbes, 3); assert.equal(result.mediaObjects, 1);
 assert.equal(result.restoreExecuted, false); assert.equal(result.liveCompletenessVerified, false); assert.equal(result.keyEscrowRetrievalVerified, false);
 const output = JSON.stringify(result); for (const value of [env.STUDIO_SECRETS_KEY, "user_equal_fixture", "private/original", "synthetic-openai-secret"]) assert.ok(!output.includes(value));
}));
test("wrong project, bucket or independent pin and altered manifest are refused", async () => fixture(async f => {
 for (const input of [{ projectRef: "different00000000000" }, { bucket: "business-media" }, { manifestSha256: "0".repeat(64) }]) await assert.rejects(verifyRecoveryBundle({ ...f.input, ...input }), /^Error: recovery_verification_failed$/);
 await writeFile(path.join(f.root, "manifest.json"), "{}"); await assert.rejects(verifyRecoveryBundle(f.input), /recovery_verification_failed/);
}));
test("missing/truncated/corrupted bytes and extra private files cannot pass", async () => fixture(async f => {
 const original = await readFile(f.mediaFile);
 await writeFile(f.mediaFile, original.subarray(1)); await assert.rejects(verifyRecoveryBundle(f.input), /recovery_verification_failed/);
 await writeFile(f.mediaFile, original); await writeFile(path.join(f.root, ".env"), "not a real secret", { mode: 0o600 });
 await assert.rejects(verifyRecoveryBundle(f.input), /recovery_verification_failed/); await rm(path.join(f.root, ".env"));
 await rm(f.mediaFile); await assert.rejects(verifyRecoveryBundle(f.input), /recovery_verification_failed/);
}));
test("group-readable files, symlinks and hardlinks fail even when bytes match", async () => fixture(async f => {
 await chmod(f.mediaFile, 0o644); await assert.rejects(verifyRecoveryBundle(f.input), /recovery_verification_failed/); await chmod(f.mediaFile, 0o600);
 const external = path.join(f.parent, "outside"); await writeFile(external, await readFile(f.mediaFile), { mode: 0o600 });
 await rm(f.mediaFile); await symlink(external, f.mediaFile); await assert.rejects(verifyRecoveryBundle(f.input), /recovery_verification_failed/);
 await rm(f.mediaFile); await link(external, f.mediaFile); await assert.rejects(verifyRecoveryBundle(f.input), /recovery_verification_failed/);
}));
test("missing or wrong escrow material fails even when the ID remains the same", async () => fixture(async f => {
 await assert.rejects(verifyRecoveryBundle({ ...f.input, env: { ...env, STUDIO_SECRETS_PREVIOUS_KEYS: "" } }), /recovery_verification_failed/);
 await assert.rejects(verifyRecoveryBundle({ ...f.input, env: { ...env, STUDIO_SECRETS_KEY: Buffer.alloc(32, 3).toString("base64") } }), /recovery_verification_failed/);
}));
test("an internally consistent manifest cannot substitute a credential realm context", async () => fixture(async f => {
 await rm(path.join(f.root, "manifest.json"));
 const state = JSON.parse(await readFile(path.join(f.root, "state.json"), "utf8")); state.credentials[1].brand = "substo";
 await writeFile(path.join(f.root, "state.json"), JSON.stringify(state));
 const mediaHash = path.basename(f.mediaFile), bytes = await readFile(f.mediaFile);
 const pin = await sealRecoveryBundle(f.root, { projectRef: f.input.projectRef, bucket: f.input.bucket, release: "fixture-release", capturedAt: "2026-10-24T00:00:00Z", keyEscrowReceiptSha256: sha("receipt"),
  media: [{ bucket: "studio-media", key: "private/original", byteSize: bytes.length, sha256: mediaHash, file: `media/${mediaHash}` }] });
 await assert.rejects(verifyRecoveryBundle({ ...f.input, ...pin }), /recovery_verification_failed/);
}));

test("referenced media missing from the sealed inventory is rejected even with a freshly pinned manifest", async () => fixture(async f => {
 const old = JSON.parse(await readFile(path.join(f.root, "manifest.json"), "utf8"));
 await rm(path.join(f.root, "manifest.json"));
 const state = JSON.parse(await readFile(path.join(f.root, "state.json"), "utf8")); state.media.push({ ...state.media[0], key: "not-captured/original" });
 await writeFile(path.join(f.root, "state.json"), JSON.stringify(state));
 const { version: _version, files: _files, ...metadata } = old;
 const pin = await sealRecoveryBundle(f.root, metadata);
 await assert.rejects(verifyRecoveryBundle({ ...f.input, ...pin }), /recovery_verification_failed/);
}));
