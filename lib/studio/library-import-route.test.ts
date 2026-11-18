import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { z } from 'zod';
import { isAllowedRequestOrigin } from '../auth/request-origin-policy';
import { libraryImportTarget, LibraryImportError } from './library-import-metadata';
import { canonicalYoutubeVideo } from './video-transcription-policy';
function route() {
  let tenants = 0; const imports: string[] = []; const queued: Array<{recordId:string;origin:string;requestKey:string}> = [];
  const module = {exports:{} as any};
  const dependencies: Record<string,unknown> = {
    zod:{z}, '@/lib/auth/request-origin-policy':{isAllowedRequestOrigin},
    '@/lib/studio/route-context':{withStudioRoute:(handler:unknown)=>handler,studioRouteParams:async()=>{tenants++;return {locationId:'active-location'};}},
    '@/lib/studio/library-import':{importStudioLibrary:async(location:string,command:{input:string})=>{assert.equal(location,'active-location');imports.push(libraryImportTarget(command.input).url);return {recordId:'saved'};}},
    '@/lib/studio/library-import-metadata':{LibraryImportError}, '@/lib/studio/db':{toStudioDbError:()=>({status:503})},
    '@/lib/studio/video-transcription':{videoRequestKey:(...parts:string[])=>parts.join('|'),enqueueVideoTranscription:async(location:string,command:{recordId:string;origin:string;requestKey:string})=>{assert.equal(location,'active-location');queued.push(command);return {status:'queued',transcriptionId:'t1'};}},
    '@/lib/studio/video-transcription-policy':{canonicalYoutubeVideo},
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/api/studio/library/import/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{module,exports:module.exports,Response,URL,Buffer,require:(name:string)=>{assert.ok(name in dependencies,name);return dependencies[name];}});
  return {post:module.exports.POST,queued,counts:()=>({tenants,imports})};
}
const urls = ['https://www.youtube.com/watch?v=KD71g4TK6Sg&pp=ugUHEgVlbi1HQg%3D%3D','https://youtu.be/KD71g4TK6Sg?si=8nMJitcBYy60x4B_'];
function request(origin: string | null, host='substo.com', input=urls[0], site='same-origin') {
  const headers:Record<string,string>={'content-type':'application/json','host':'localhost:3001','x-forwarded-host':host,'x-forwarded-proto':'https','sec-fetch-site':site,'X-Studio-Tenant':'active-location'};
  if(origin !== null) headers.origin=origin;
  return new Request('http://localhost:3001/api/studio/library/import',{method:'POST',headers,body:JSON.stringify({input,idempotencyKey:'03ac0352-c927-4f10-908c-1e87f4d3fa32'})});
}
test('public Substo and Estio origins pass behind internal Next origin and forwarded headers',async()=>{
  for(const host of ['substo.com','estio.co']) for(const input of urls) {
    const api=route(); const response=await api.post(request(`https://${host}`,host,input),{params:Promise.resolve({})});
    assert.equal(response.status,200);assert.deepEqual(api.counts(),{tenants:1,imports:['https://www.youtube.com/watch?v=KD71g4TK6Sg']});
  }
});
test('both exact reported URLs identify the same video',()=>{
  for(const input of urls) {const target=libraryImportTarget(input);assert.equal(target.videoId,'KD71g4TK6Sg');assert.equal(target.url,'https://www.youtube.com/watch?v=KD71g4TK6Sg');}
});
test('missing, malformed, unrelated and cross-site origins stop before tenant or import work',async()=>{
  for(const [origin,site] of [[null,'same-origin'],['not an origin','same-origin'],['null','same-origin'],['https://substo.com/path','same-origin'],['https://substo.com.evil.test','same-origin'],['https://evil.example','same-origin'],['https://substo.com','cross-site']] as const) {
    const api=route();const response=await api.post(request(origin,'substo.com',urls[0],site),{params:Promise.resolve({})});
    assert.equal(response.status,403);assert.deepEqual(api.counts(),{tenants:0,imports:[]});assert.match((await response.json()).error,/origin could not be verified/);
  }
});

function body(origin:string,input:string,extra:Record<string,unknown>){
  return new Request('http://localhost:3001/api/studio/library/import',{method:'POST',headers:{'content-type':'application/json','host':'localhost:3001','x-forwarded-host':'substo.com','x-forwarded-proto':'https','sec-fetch-site':'same-origin','X-Studio-Tenant':'active-location',origin},body:JSON.stringify({input,idempotencyKey:'03ac0352-c927-4f10-908c-1e87f4d3fa32',...extra})});
}
test('only an explicit paste of a YouTube video queues Mac transcription; enrichment, refresh and other sources never do',async()=>{
  const api=route();
  const paste=await api.post(body('https://substo.com',urls[0],{transcribe:true}),{params:Promise.resolve({})});
  assert.equal(paste.status,200);const result=await paste.json();assert.equal(result.transcription.status,'queued');
  assert.equal(JSON.stringify(api.queued),JSON.stringify([{recordId:'saved',origin:'paste',requestKey:'paste|saved|03ac0352-c927-4f10-908c-1e87f4d3fa32'}]));
  await api.post(body('https://substo.com',urls[0],{}),{params:Promise.resolve({})});          // background enrichment / refresh
  await api.post(body('https://substo.com','https://example.com/post',{transcribe:true}),{params:Promise.resolve({})}); // not a YouTube video
  await api.post(body('https://substo.com',urls[0],{transcribe:true,sourceId:'1b4e28ba-2fa1-4d2a-83f4-0b6f1f3d2b11',sourceVersion:1}),{params:Promise.resolve({})}); // channel link action
  assert.equal(api.queued.length,1);
});
