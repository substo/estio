// Synthetic data only; never reads deployment env files or connects to a database.
import { createHash, randomBytes } from "node:crypto";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { aiCredentialContext, encryptStudioSecret } from "../../lib/studio/secrets";
import { youtubeProfileContext } from "../../lib/google/youtube-policy";
import { sealRecoveryBundle, verifyRecoveryBundle, type RecoveryState } from "../../lib/studio/recovery/archive";
const w = "f9100000-0000-4000-8000-000000000001", r = "f9200000-0000-4000-8000-000000000001", up = "f9300000-0000-4000-8000-000000000001";
const user = "user_recovery_fixture";
const projectRef = "fixturestudio00000000", bucket = "studio-media";
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const literal = (value: unknown) => `'${String(value).replaceAll("'", "''")}'`;
async function main() {
 const [mode, root] = process.argv.slice(2);
 if (!root || !path.isAbsolute(root)) throw new Error("fixture_root_required");
 const bundle = path.join(root, "recovery-bundle");
 if (mode === "prepare") {
  await mkdir(path.join(bundle, "media"), { recursive: true, mode: 0o700 }); await mkdir(path.join(root, "fixture-r2-source"), { mode: 0o700 });
  const keys = { NODE_ENV: "test" as const, STUDIO_SECRETS_KEY: randomBytes(32).toString("base64"), STUDIO_SECRETS_KEY_ID: "current",
    STUDIO_SECRETS_PREVIOUS_KEYS: `previous:${randomBytes(32).toString("base64")}` };
  // Stands in for separately controlled escrow in this synthetic test only. Never included in the bundle.
  await writeFile(path.join(root, "fixture-escrow.json"), JSON.stringify(keys), { mode: 0o600 });
  const ai = encryptStudioSecret("sk-synthetic-recovery-only", aiCredentialContext(w, "openai"), keys);
  const previous = keys.STUDIO_SECRETS_PREVIOUS_KEYS.split(":")[1];
  const grants = ["estio", "substo"].map(brand => ({ brand, cipher: encryptStudioSecret(`synthetic-${brand}-refresh`, youtubeProfileContext(brand, user, "refresh"), { STUDIO_SECRETS_KEY_ID: "previous", STUDIO_SECRETS_KEY: previous }) }));
  const media = Buffer.from("synthetic private recovery media\n"); const sha256 = digest(media);
  await writeFile(path.join(root, "fixture-r2-source", sha256), media, { mode: 0o600 });
  await cp(path.join(root, "fixture-r2-source", sha256), path.join(bundle, "media", sha256));
  const sql = `
select public.studio_create_substo_workspace('${w}','Recovery fixture','${user}');
insert into public.studio_records(workspace_id,id,kind,title,payload) values('${w}','${r}','content','Private recovery fixture','{"stage":"idea","script":"Preserve exact human text"}');
select public.studio_set_ai_credential('${w}','substo','${user}','openai',${literal(ai.ciphertext)},${literal(ai.iv)},${literal(ai.authTag)},'current','test');
select public.studio_set_ai_budget('${w}','substo','${user}',1000000);
${grants.map(g => `insert into public.platform_google_youtube_connections(brand,clerk_user_id,client_id,refresh_cipher,granted_scopes) values('${g.brand}','${user}','fixture-client',${literal(JSON.stringify(g.cipher))}::jsonb,array['https://www.googleapis.com/auth/youtube.readonly']);`).join("\n")}
select public.studio_create_upload('${w}','substo','${user}','${up}','${r}','fixture.ogg','audio/ogg',${media.length},'${bucket}');
select public.studio_complete_upload('${w}','substo','${user}','${up}',${media.length});
do $$ declare j public.studio_jobs; a jsonb; begin
 perform public.studio_claim_jobs('recovery-fixture-worker',1,120);
 select * into j from public.studio_jobs where workspace_id='${w}' and kind='studio.transcribe_upload';
 a:=public.studio_begin_transcription_attempt('${w}','${up}',j.id,'recovery-fixture-worker',j.lease_token,0,60);
 perform public.studio_close_transcription_attempt('${w}','${up}',j.id,'recovery-fixture-worker',j.lease_token,(a->>'attempt_id')::uuid,false);
 perform public.studio_fail_job(j.id,'recovery-fixture-worker',j.lease_token,'transcription_outcome_uncertain','Synthetic uncertain provider outcome',false,null);
end $$;
select public.studio_enqueue_job('${w}','studio.diagnostic','{}','recovery-queued','${user}',5);
select public.platform_delete_profile('estio','user_recovery_deleted','fixture-deleted',clock_timestamp(),repeat('a',64));
`;
  await writeFile(path.join(root, "recovery-seed.sql"), sql, { mode: 0o600 });
 } else if (mode === "seal") {
  const state = JSON.parse(await readFile(path.join(bundle, "state.json"), "utf8")) as RecoveryState;
  const files = await import("node:fs/promises"); const names = await files.readdir(path.join(bundle, "media"));
  const sha256 = names[0], ref = state.media[0];
  const result = await sealRecoveryBundle(bundle, { projectRef, bucket, release: "fixture-release", capturedAt: new Date().toISOString(),
    keyEscrowReceiptSha256: digest(await readFile(path.join(root, "fixture-escrow.json"))),
    media: [{ bucket, key: ref.key, byteSize: ref.byteSize, sha256, file: `media/${sha256}` }] });
  await writeFile(path.join(root, "pinned-manifest.sha256"), result.manifestSha256, { mode: 0o600 });
  const env = JSON.parse(await readFile(path.join(root, "fixture-escrow.json"), "utf8"));
  await verifyRecoveryBundle({ root: bundle, ...result, projectRef, bucket, env });
 } else if (mode === "compare") {
  const source = JSON.parse(await readFile(path.join(bundle, "state.json"), "utf8"));
  const restored = JSON.parse(await readFile(path.join(root, "restored-bundle/state.json"), "utf8"));
  for (const section of Object.keys(source)) {
   if (JSON.stringify(source[section]) === JSON.stringify(restored[section])) continue;
   if (Array.isArray(source[section]) && Array.isArray(restored[section])) {
    source[section].forEach((item: Record<string, unknown>, index: number) => {
     const target = restored[section][index];
     if (JSON.stringify(item) !== JSON.stringify(target)) console.log(JSON.stringify({ section, index, name: item.name, fields: Object.keys(item).filter(k => JSON.stringify(item[k]) !== JSON.stringify(target?.[k])), ...(section === "relations" ? { expectedAcl: item.acl, restoredAcl: target?.acl } : {}) }));
    });
   } else console.log(JSON.stringify({ section }));
  }
 } else if (mode === "verify-restored") {
  // Reload the separately retained keyring, not any pre-capture in-memory key.
  const env = JSON.parse(await readFile(path.join(root, "fixture-escrow.json"), "utf8"));
  const result = await verifyRecoveryBundle({ root: path.join(root, "restored-bundle"), projectRef, bucket,
    manifestSha256: await readFile(path.join(root, "pinned-manifest.sha256"), "utf8"), env });
  if (result.mediaObjects !== 1 || result.credentialProbes !== 3) throw new Error("fixture_coverage_incomplete");
  console.log(JSON.stringify({ ...result, fixtureRestoreExecuted: true, fixtureKeyringReloaded: true }));
 } else throw new Error("unknown_fixture_mode");
}
main().catch(() => { console.error("Synthetic recovery fixture failed."); process.exitCode = 1; });
