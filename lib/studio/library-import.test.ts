import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { Prisma } from '@prisma/client';
import { LibraryImportError, libraryImportTarget, validatedYoutubeCreator } from './library-import-metadata';
function load(options: { denied?: boolean; actor?: boolean; replay?: { id: string; url: string; payload?: Record<string, unknown> }[] } = {}) {
  let fetches = 0, reads = 0;
  const module = { exports: {} as any };
  const deps: Record<string,unknown> = {
    'server-only': {}, './library-summary': {enqueueLibrarySummary:async()=>null}, '../google/profile-youtube-credentials': {}, './studio-db': {}, 'node:crypto': { randomUUID: () => 'record-id' }, '@prisma/client': {Prisma},
    '@clerk/nextjs/server': { auth: async () => ({actor: options.actor ? {} : null}) },
    '../db': {default: {$queryRaw: async () => {reads++;return options.replay ?? [];},$transaction:async(fn:any)=>fn({$queryRaw:async()=>[{id:'member'}]})}},
    './access': { getStudioAccess: async () => options.denied ? null : {locationId:'location',userId:'person',app:'substo'} },
    './merge-gate': {assertStudioMergeReady:()=>{}},
    './library-import-youtube': {readLibraryYoutubeMetadata:async()=>{fetches++;return null;}},
    './library-import-metadata': {LibraryImportError,libraryImportTarget,validatedYoutubeCreator,fetchLibraryImportMetadata:async()=>{throw Error('unexpected fetch');}}
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/studio/library-import.ts','utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{module,exports:module.exports,require:(name:string)=>{assert.ok(name in deps,name);return deps[name];}});
  return {run:module.exports.importStudioLibrary,counts:()=>({reads,fetches})};
}
const command = {input:'https://youtu.be/dQw4w9WgXcQ',idempotencyKey:'03ac0352-c927-4f10-908c-1e87f4d3fa32'};
test('denied and impersonated imports never read records or fetch external metadata', async()=>{
  for (const config of [{denied:true},{actor:true}]) {const api=load(config);await assert.rejects(api.run('location',command));assert.deepEqual(api.counts(),{reads:0,fetches:0});}
});
test('idempotent replay precedes all external requests, and key reuse conflicts',async()=>{
  const api=load({replay:[{id:'existing',url:'https://www.youtube.com/watch?v=dQw4w9WgXcQ'}]});
  assert.equal((await api.run('location',command)).recordId,'existing'); assert.equal(api.counts().fetches,0);
  await assert.rejects(api.run('location',{...command,input:'https://youtube.com/@different'}), (error:any)=>error.status===409);
});

function serviceFixture(options: { revoked?: boolean; oauth?: boolean; changed?: boolean; summaryFails?: boolean } = {}) {
  let rows: any[] = [], sequence = 0, network = 0, writes = 0;
  let tail = Promise.resolve();
  const queries: any[] = [];
  const deps: Record<string,any> = {
    'server-only':{}, '@prisma/client':{Prisma}, 'node:crypto':{randomUUID:()=>`record-${++sequence}`},
    './access':{getStudioAccess:async()=>({locationId:'location',app:'substo',userId:'person'})},
    '@clerk/nextjs/server':{auth:async()=>({actor:null})}, './merge-gate':{assertStudioMergeReady:()=>{}},
    './studio-db':{studioDb:{}}, '../google/profile-youtube-credentials':{readProfileYoutubeConnection:async()=>({version:'one'})},
    './library-summary':{enqueueLibrarySummary:async()=>{if(options.summaryFails)throw Error('offline');return {summaryStatus:'waiting_for_device'};}},
    './library-import-youtube':{readLibraryYoutubeMetadata:async()=>options.oauth?{connectionVersion:'one'}:null},
    './library-import-metadata':{LibraryImportError,libraryImportTarget,validatedYoutubeCreator,fetchLibraryImportMetadata:async(target:any)=>{network++;return {kind:'reference',title:'Fetched title',payload:{url:target.url,thumbnailUrl:'https://example.com/thumb',channelName:'Fetched creator',description:'Fetched description',summaryStatus:'not_generated',platform:'youtube',format:target.format,importEvidence:{method:'test'}}};}},
  };
  const query = async (strings:any,...values:any[]) => {
    const sql = strings.sql ?? strings.join('?'); const args = Array.isArray(strings) ? values : strings.values; queries.push({sql,args});
    if(sql.includes('UserLocationRole'))return options.revoked?[]:[{id:'membership'}];
    if(sql.includes('platform_require_active_profile') || sql.includes('pg_advisory'))return [];
    if(sql.includes('platform_google_youtube_connections'))return [{version:options.changed?'two':'one'}];
    if(sql.includes('studio_save_record')) {const [location,id,kind,title,json,version]=args;assert.equal(location,'location');const patch=JSON.parse(json);const row=rows.find(r=>r.id===id);if(row){assert.equal(row.version,version);row.payload={...row.payload,...patch};row.version++;}else rows.push({id,kind,title,payload:patch,version:1});writes++;return [];}
    if(sql.includes('select id,version'))return rows;
    if(sql.includes('select id, payload'))return rows.filter(r=>r.payload.importRequestKeys?.includes(args[1])).map(r=>({id:r.id,url:r.payload.url}));
    throw Error(sql);
  };
  deps['../db']={default:{$queryRaw:query,$transaction:async(fn:any)=>{const prior=tail;let release!:()=>void;tail=new Promise<void>(resolve=>{release=resolve;});await prior;try{return await fn({$queryRaw:query});}finally{release();}}}};
  const module={exports:{} as any};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/studio/library-import.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{module,exports:module.exports,require:(name:string)=>{assert.ok(name in deps,name);return deps[name];}});
  return {run:module.exports.importStudioLibrary,queries,seed:(row:any)=>rows.push(row),rows:()=>rows,counts:()=>({network,writes})};
}
test('concurrent distinct keys for one source serialize to a single record',async()=>{
  const f=serviceFixture();const results=await Promise.all([f.run('location',command),f.run('location',{...command,idempotencyKey:'another-key'})]);
  assert.equal(results[0].recordId,results[1].recordId);assert.equal(f.rows().length,1);assert.equal(f.rows()[0].payload.importRequestKeys.length,2);
  assert.equal(results[0].summaryStatus,'waiting_for_device');
  assert.ok(f.queries.some(q=>q.sql.includes('for share of m,u,l')&&q.args.includes('person')&&q.args.includes('substo')));
});
test('legacy source enrichment patches missing metadata and evidence, preserving human edits and URL',async()=>{
  const f=serviceFixture();f.seed({id:'old',version:8,kind:'reference',title:'Human title',payload:{url:'https://youtu.be/dQw4w9WgXcQ?si=old',notes:'Human notes',summary:'Human summary',description:'Human description',importEvidence:{original:true}}});
  const result=await f.run('location',command);assert.equal(result.recordId,'old');const row=f.rows()[0];
  assert.equal(row.title,'Human title');assert.equal(row.payload.notes,'Human notes');assert.equal(row.payload.summary,'Human summary');assert.equal(row.payload.description,'Human description');assert.equal(row.payload.url,'https://youtu.be/dQw4w9WgXcQ?si=old');
  assert.equal(row.payload.importEvidence.original,true);assert.equal(row.payload.importEvidence.enrichment.method,'test');
  const selection=f.queries.find(q=>q.sql.includes('select id,version'));const pattern=selection.args.find((x:any)=>typeof x==='string'&&x.startsWith('^https?'));
  assert.equal(typeof pattern,'string');assert.ok(!pattern.includes('\\'));
  for(const url of [
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ?si=x',
    'https://youtube.com/shorts/dQw4w9WgXcQ',
    'https://www.youtube.com/shorts/dQw4w9WgXcQ?si=x',
    'https://www.youtube.com/watch?si=x&v=dQw4w9WgXcQ',
    'https://m.youtube.com/watch?si=x&v=dQw4w9WgXcQ&t=10',
  ])assert.match(url,new RegExp(pattern));
  for(const url of ['https://youtube.com.attacker.org/watch?v=dQw4w9WgXcQ','https://youtu.be/DIFFERENT12','https://youtube.com/watch?v=dQw4w9WgXcQextra'])assert.doesNotMatch(url,new RegExp(pattern));
});
test('revoked membership and changed OAuth are rejected before saving',async()=>{
  for(const config of [{revoked:true},{oauth:true,changed:true}]){const f=serviceFixture(config);await assert.rejects(f.run('location',command),(error:any)=>[403,409].includes(error.status));assert.equal(f.counts().writes,0);}
});
test('summary enqueue failure reports pending while retaining saved metadata',async()=>{
  const f=serviceFixture({summaryFails:true});const result=await f.run('location',command);assert.equal(result.summaryStatus,'pending');assert.ok(result.summaryError);assert.equal(f.rows().length,1);
});

test('watch rejects missing or cross-Location source metadata before external requests', async()=>{
  const api=load();
  await assert.rejects(api.run('location',{...command,input:'https://youtube.com/@creator',sourceId:'550e8400-e29b-41d4-a716-446655440000',sourceVersion:1}), (error:any)=>error.status===409);
  assert.equal(api.counts().fetches,0);
});

test('channel alias dedupe retains the original request target for same-key replay',async()=>{
 const key='substo:person:'+command.idempotencyKey;
 const api=load({replay:[{id:'channel',url:'https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv',payload:{importRequestSources:{[key]:'https://www.youtube.com/@creator'}}}]});
 assert.equal((await api.run('location',{...command,input:'https://youtube.com/@creator'})).recordId,'channel');
 assert.equal(api.counts().fetches,0);
 await assert.rejects(api.run('location',{...command,input:'https://youtube.com/@different'}),(error:any)=>error.status===409);
});
