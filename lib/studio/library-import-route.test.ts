import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { z } from 'zod';
import { isAllowedRequestOrigin } from '../auth/request-origin-policy';
import { libraryImportTarget, LibraryImportError } from './library-import-metadata';
function route() {
  let tenants = 0; const imports: string[] = [];
  const module = {exports:{} as any};
  const dependencies: Record<string,unknown> = {
    zod:{z}, '@/lib/auth/request-origin-policy':{isAllowedRequestOrigin},
    '@/lib/studio/route-context':{withStudioRoute:(handler:unknown)=>handler,studioRouteParams:async()=>{tenants++;return {locationId:'active-location'};}},
    '@/lib/studio/library-import':{importStudioLibrary:async(location:string,command:{input:string})=>{assert.equal(location,'active-location');imports.push(libraryImportTarget(command.input).url);return {recordId:'saved'};}},
    '@/lib/studio/library-import-metadata':{LibraryImportError}, '@/lib/studio/db':{toStudioDbError:()=>({status:503})},
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/api/studio/library/import/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{module,exports:module.exports,Response,URL,Buffer,require:(name:string)=>{assert.ok(name in dependencies,name);return dependencies[name];}});
  return {post:module.exports.POST,counts:()=>({tenants,imports})};
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
