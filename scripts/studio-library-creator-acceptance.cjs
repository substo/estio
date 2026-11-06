// Actual import transaction and SQL link owner, with only auth/network/summary execution stubbed.
const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const ts=require('typescript');const {randomUUID}=require('node:crypto');const {Prisma,PrismaClient}=require('@prisma/client');
const url=process.env.STUDIO_LIBRARY_TEST_DATABASE_URL;const parsed=new URL(url||'https://invalid');
if(parsed.hostname!=='localhost'||parsed.username!=='studio_test'||parsed.port!=='55449'||!parsed.searchParams.get('host')?.startsWith('/tmp/studio-summary.'))throw Error('Disposable Unix-socket test database required');
const db=new PrismaClient({datasourceUrl:url});
const {LibraryImportError,libraryImportTarget,validatedYoutubeCreator}=require('../lib/studio/library-import-metadata.ts');
const location='creator-acceptance';const user='creator-owner';let metadataReads=0;
const deps={'server-only':{},'./library-summary':{enqueueLibrarySummary:async()=>({summaryStatus:'waiting_for_device'})},'../google/profile-youtube-credentials':{},'./studio-db':{},'node:crypto':{randomUUID},'@prisma/client':{Prisma},'@clerk/nextjs/server':{auth:async()=>({actor:null})},'../db':{default:db},'./access':{getStudioAccess:async()=>({locationId:location,userId:user,app:'substo'})},'./merge-gate':{assertStudioMergeReady:()=>{}},'./library-import-youtube':{readLibraryYoutubeMetadata:async()=>null},'./library-import-metadata':{LibraryImportError,libraryImportTarget,validatedYoutubeCreator,fetchLibraryImportMetadata:async t=>{metadataReads++;return{kind:t.kind,title:'Fixture channel',payload:{url:t.url,platform:t.platform,format:'channel',...validatedYoutubeCreator(t.url.endsWith('/@fixturecreator')?'https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv':t.url),description:'Synthetic creator evidence',importEvidence:{method:'fixture'}}}}}};
const mod={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/studio/library-import.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{module:mod,exports:mod.exports,require:n=>{assert.ok(n in deps,n);return deps[n];}});
const run=mod.exports.importStudioLibrary;
async function seed(id,creator,loc=location,version=1){await db.$executeRaw`insert into studio.studio_records(location_id,id,kind,title,payload,version) values(${loc},${id}::uuid,'reference','Human title',${JSON.stringify({channelUrl:creator,notes:'Human notes',description:'Original description'})}::jsonb,${version})`;}
async function main(){
 await db.$queryRaw`select studio.studio_create_substo_location(${location},'Creator test',${user})`;
 await db.$queryRaw`select studio.studio_create_substo_location('creator-other','Other','other-owner')`;
 const source=randomUUID(),creator='https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv';await seed(source,creator);
 const command={input:creator,idempotencyKey:randomUUID(),sourceId:source,sourceVersion:1};const saved=await run(location,command);
 const links=await db.$queryRaw`select source_id,target_id from studio.studio_record_links where location_id=${location}`;assert.equal(links.length,1);assert.equal(links[0].source_id,source);assert.equal(links[0].target_id,saved.recordId);
 const [record]=await db.$queryRaw`select version,payload,title from studio.studio_records where location_id=${location} and id=${source}::uuid`;assert.equal(Number(record.version),2);assert.equal(record.payload.notes,'Human notes');assert.equal(record.payload.description,'Original description');assert.equal(record.title,'Human title');
 const reads=metadataReads;assert.equal((await run(location,command)).recordId,saved.recordId);assert.equal(metadataReads,reads);assert.equal((await db.$queryRaw`select count(*)::int as n from studio.studio_record_links where location_id=${location}`)[0].n,1);
 const relations={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/studio/record-relations.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{module:relations,exports:relations.exports,require:n=>({'server-only':{},'@prisma/client':{Prisma},'./studio-db':{studioDb:{rows:q=>db.$queryRaw(q)}},'./uploads':{listStudioRecordUploads:async()=>[]}})[n]});
 const incoming=await relations.exports.getStudioRecordRelations({locationId:location},saved.recordId,true);assert.equal(incoming.links[0].id,source,'channel reads incoming saved sources');
 const aliasSource=randomUUID(),alias='https://www.youtube.com/@fixturecreator';await seed(aliasSource,alias);const aliasCommand={input:alias,idempotencyKey:randomUUID(),sourceId:aliasSource,sourceVersion:1};assert.equal((await run(location,aliasCommand)).recordId,saved.recordId,'same native channel ID deduplicates handle and ID URLs');assert.equal((await run(location,aliasCommand)).recordId,saved.recordId,'alias retry reuses recorded input mapping');
 const stale=randomUUID(),staleCreator='https://www.youtube.com/channel/UCbbbbbbbbbbbbbbbbbbbbbb';await seed(stale,staleCreator,location,2);
 await assert.rejects(run(location,{input:staleCreator,idempotencyKey:randomUUID(),sourceId:stale,sourceVersion:1}),e=>e.meta?.code==='40001');
 assert.equal((await db.$queryRaw`select count(*)::int as n from studio.studio_records where location_id=${location} and kind='channel' and payload->>'url'=${staleCreator}`)[0].n,0,'stale link must roll back channel save');
 const foreign=randomUUID();await seed(foreign,creator,'creator-other');await assert.rejects(run(location,{...command,idempotencyKey:randomUUID(),sourceId:foreign}),e=>e.status===409);
 await db.$executeRaw`delete from public."UserLocationRole" where "locationId"=${location}`;
 await assert.rejects(run(location,{input:creator,idempotencyKey:randomUUID()}),e=>e.status===403);
 console.log('Real PostgreSQL import/link acceptance passed: atomic creator link, reverse relation read, channel-ID alias dedupe, idempotent retry, human evidence preservation, stale rollback, cross-tenant denial and revoked membership.');
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>db.$disconnect());
