import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { aiCredentialContext, decryptStudioSecret, type StudioSecretCiphertext } from "../secrets";
import { youtubeProfileContext } from "../../google/youtube-policy";
const hashPattern = /^[a-f0-9]{64}$/;
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export interface RecoveryState {
 schema: number; tables: Array<{ name: string; count: number; sha256: string }>;
 media: Array<{ bucket: string; key: string; byteSize: number; sha256: string | null }>;
 credentials: Array<({ scope: "workspace"; workspaceId: string } | { scope: "profile"; brand: "estio" | "substo"; userId: string }) & { cipher: StudioSecretCiphertext }>;
 [key: string]: unknown;
}
export interface RecoveryManifest {
 version: 1; projectRef: string; bucket: string; release: string; capturedAt: string; keyEscrowReceiptSha256: string;
 files: Array<{ name: string; byteSize: number; sha256: string }>;
 media: Array<{ bucket: string; key: string; byteSize: number; sha256: string; file: string }>;
}
export class RecoveryVerificationError extends Error { constructor() { super("recovery_verification_failed"); } }
/** Private local archives only. Never follows a symlink or opens an arbitrary path from an archive. */
async function privateFile(root: string, name: string, maxBytes?: number) {
 if (!/^(?:database\.dump|state\.json|manifest\.json|media\/[a-f0-9]{64})$/.test(name)) throw new RecoveryVerificationError();
 const parent = path.dirname(path.join(root, name));
 const parentInfo = await lstat(parent);
 if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink() || (parentInfo.mode & 0o077) || await realpath(parent) !== parent) throw new RecoveryVerificationError();
 const file = await open(path.join(root, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
 try {
  const before = await file.stat();
  if (!before.isFile() || before.nlink !== 1 || (before.mode & 0o077) || (maxBytes && before.size > maxBytes)) throw new RecoveryVerificationError();
  const hash = createHash("sha256"); let size = 0; const chunks: Buffer[] = [];
  for await (const chunk of file.createReadStream({ autoClose: false })) { size += chunk.length; if (maxBytes && size > maxBytes) throw new RecoveryVerificationError(); hash.update(chunk); if (maxBytes) chunks.push(chunk); }
  const after = await file.stat();
  if (size !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) throw new RecoveryVerificationError();
  return { byteSize: size, sha256: hash.digest("hex"), bytes: maxBytes ? Buffer.concat(chunks) : undefined };
 } finally { await file.close(); }
}
async function privateRoot(root: string) {
 const info = await lstat(root);
 if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077)) throw new RecoveryVerificationError();
 const location = await realpath(root);
 const applicationRoot = await realpath(fileURLToPath(new URL("../../../", import.meta.url)));
 const relative = path.relative(applicationRoot, location);
 if (!relative || (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative) && relative !== "..")) throw new RecoveryVerificationError();
 return location;
}
function stateValue(bytes: Buffer): RecoveryState {
 const s = JSON.parse(bytes.toString("utf8")) as RecoveryState;
 if (!s || s.schema !== 27 || !Array.isArray(s.tables) || !Array.isArray(s.media) || !Array.isArray(s.credentials) || s.tables.length > 1000 || s.media.length > 100000 || s.credentials.length > 100000) throw new RecoveryVerificationError();
 if (s.tables.some(t => !t || typeof t.name !== "string" || !Number.isSafeInteger(t.count) || t.count < 0 || !hashPattern.test(t.sha256))) throw new RecoveryVerificationError();
 return s;
}
function validateManifest(m: RecoveryManifest, expected: { projectRef: string; bucket: string }) {
 if (!m || m.version !== 1 || !/^[a-z0-9]{10,40}$/.test(m.projectRef) || m.projectRef !== expected.projectRef || m.bucket !== expected.bucket ||
  !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(m.bucket) || typeof m.release !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(m.release) ||
  !Number.isFinite(Date.parse(m.capturedAt)) || !hashPattern.test(m.keyEscrowReceiptSha256) || !Array.isArray(m.files) || !Array.isArray(m.media) || m.media.length > 100000 || m.files.length > 100002) throw new RecoveryVerificationError();
 const names = new Set<string>();
 for (const f of m.files) {
  if (!f || typeof f.name !== "string" || names.has(f.name) || !hashPattern.test(f.sha256) || !Number.isSafeInteger(f.byteSize) || f.byteSize < 0) throw new RecoveryVerificationError();
  names.add(f.name);
 }
 if (!names.has("database.dump") || !names.has("state.json")) throw new RecoveryVerificationError();
 const refs = new Set<string>();
 for (const item of m.media) {
  if (!item || item.bucket !== m.bucket || typeof item.key !== "string" || !item.key || item.key.length > 2048 || /[\x00-\x1f\x7f]/.test(item.key) ||
   !hashPattern.test(item.sha256) || item.file !== `media/${item.sha256}` || !Number.isSafeInteger(item.byteSize) || item.byteSize < 0 || refs.has(item.key)) throw new RecoveryVerificationError();
  refs.add(item.key);
  const file = m.files.find(f => f.name === item.file);
  if (!file || file.sha256 !== item.sha256 || file.byteSize !== item.byteSize) throw new RecoveryVerificationError();
 }
 const expectedFiles = new Set(["database.dump", "state.json", ...m.media.map(item => item.file)]);
 if (names.size !== expectedFiles.size || [...names].some(name => !expectedFiles.has(name))) throw new RecoveryVerificationError();
}
async function validateContents(root: string, m: RecoveryManifest) {
 const rootNames = (await readdir(root)).sort();
 if (JSON.stringify(rootNames) !== JSON.stringify(["database.dump", "manifest.json", "media", "state.json"])) throw new RecoveryVerificationError();
 const mediaRoot = path.join(root, "media"), info = await lstat(mediaRoot);
 if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077)) throw new RecoveryVerificationError();
 const names = (await readdir(mediaRoot)).sort();
 const expected = [...new Set(m.media.map(item => item.sha256))].sort();
 if (JSON.stringify(names) !== JSON.stringify(expected)) throw new RecoveryVerificationError();
}
/** Seals files already captured by an approved export. This function never exports DB/media/key material. */
export async function sealRecoveryBundle(root: string, input: Omit<RecoveryManifest, "version" | "files">) {
 const location = await privateRoot(root);
 const names = [...new Set(["database.dump", "state.json", ...input.media.map(m => m.file)])].sort();
 const files = [];
 for (const name of names) files.push({ name, ...await privateFile(location, name) });
 const manifest: RecoveryManifest = { version: 1, ...input, files: files.map(({ name, byteSize, sha256 }) => ({ name, byteSize, sha256 })) };
 validateManifest(manifest, input);
 const bytes = Buffer.from(JSON.stringify(manifest));
 await writeFile(path.join(location, "manifest.json"), bytes, { mode: 0o600, flag: "wx" });
 return { manifestSha256: digest(bytes) };
}
/** Verifies inert bytes and decryption only. Does not execute a dump, connect to a DB or contact a provider. */
export async function verifyRecoveryBundle(input: { root: string; manifestSha256: string; projectRef: string; bucket: string; env?: NodeJS.ProcessEnv }) {
 try {
  if (!hashPattern.test(input.manifestSha256)) throw new RecoveryVerificationError();
  const root = await privateRoot(input.root);
  const manifestFile = await privateFile(root, "manifest.json", 32 * 1024 ** 2);
  if (manifestFile.sha256 !== input.manifestSha256) throw new RecoveryVerificationError();
  const manifest = JSON.parse(manifestFile.bytes!.toString("utf8")) as RecoveryManifest;
  validateManifest(manifest, input);
  await validateContents(root, manifest);
  for (const expected of manifest.files) {
   const actual = await privateFile(root, expected.name);
   if (actual.sha256 !== expected.sha256 || actual.byteSize !== expected.byteSize) throw new RecoveryVerificationError();
  }
  const stateFile = await privateFile(root, "state.json", 32 * 1024 ** 2);
  const expectedState = manifest.files.find(f => f.name === "state.json")!;
  if (stateFile.sha256 !== expectedState.sha256) throw new RecoveryVerificationError();
  const state = stateValue(stateFile.bytes!);
  for (const ref of state.media) {
   const item = manifest.media.find(m => m.bucket === ref.bucket && m.key === ref.key);
   if (!item || item.byteSize !== Number(ref.byteSize) || (ref.sha256 !== null && ref.sha256 !== item.sha256)) throw new RecoveryVerificationError();
  }
  for (const probe of state.credentials) {
   let context: string;
   if (probe.scope === "workspace" && /^[0-9a-f-]{36}$/i.test(probe.workspaceId)) context = aiCredentialContext(probe.workspaceId, "openai");
   else if (probe.scope === "profile" && ["estio", "substo"].includes(probe.brand) && typeof probe.userId === "string" && probe.userId.length > 0) context = youtubeProfileContext(probe.brand, probe.userId, "refresh");
   else throw new RecoveryVerificationError();
   if (!decryptStudioSecret(probe.cipher, context, input.env).length) throw new RecoveryVerificationError();
  }
  return { verified: true, manifestSha256: input.manifestSha256, tables: state.tables.length, mediaObjects: manifest.media.length,
   credentialProbes: state.credentials.length, databaseBytes: manifest.files.find(f => f.name === "database.dump")!.byteSize,
   restoreExecuted: false, liveCompletenessVerified: false, keyEscrowRetrievalVerified: false };
 } catch { throw new RecoveryVerificationError(); }
}
