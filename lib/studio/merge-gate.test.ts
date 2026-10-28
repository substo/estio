import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { assertStudioMergeReady } from "./merge-gate";
const sha=(v:string|Buffer)=>createHash("sha256").update(v).digest("hex");
test("all producer database entry points fail closed; verified identity and schema required; freeze is immediate",()=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'studio-gate-')), file=path.join(dir,'ready.json');
 const env={NODE_ENV:'production' as const,DATABASE_URL:'postgresql://fixture.invalid/crm',STUDIO_MERGE_STATE_FILE:file};
 try {
  const valid={version:1,verified:true,database:sha(env.DATABASE_URL),copyDigest:'a'.repeat(64),migrationDigest:sha(readFileSync('prisma/migrations/20261028100000_studio_schema/migration.sql'))};
  for(const producer of ['web','worker','cron','Mac']) {
   assert.throws(()=>assertStudioMergeReady(env),/not_verified_or_frozen/,producer);
  }
  for(const patch of [{verified:false},{database:'other'},{migrationDigest:'b'.repeat(64)},{copyDigest:null},{version:2}]) {
   writeFileSync(file,JSON.stringify({...valid,...patch}));assert.throws(()=>assertStudioMergeReady(env));
  }
  writeFileSync(file,JSON.stringify(valid));assert.doesNotThrow(()=>assertStudioMergeReady(env));
  unlinkSync(file);assert.throws(()=>assertStudioMergeReady(env));
  const db=readFileSync('lib/studio/db.ts','utf8');assert.equal((db.match(/assertStudioMergeReady\(\);/g)||[]).length,3);
  const deploy=readFileSync('deploy-local-build.sh','utf8');assert.ok(deploy.indexOf('assertStudioMergeReady()')<deploy.indexOf('PROCESS_ROLE=web pm2 start'));
  const worker=readFileSync('scripts/studio-deploy-readiness.sh','utf8');assert.ok(worker.indexOf('assertStudioMergeReady()')<worker.indexOf('pm2 delete'));
 } finally {rmSync(dir,{recursive:true,force:true});}
});
