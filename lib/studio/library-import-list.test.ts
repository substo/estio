import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { Prisma } from '@prisma/client';
import { libraryImportTarget, safeLibraryThumbnailUrl } from './library-import-metadata';

test('generated SQL platform patterns match legacy URLs; filters precede pagination',async()=>{
  let query: Prisma.Sql | undefined;
  const deps: Record<string,unknown> = {
    'server-only':{}, '@prisma/client':{Prisma},
    './library-import-metadata':{libraryImportTarget,safeLibraryThumbnailUrl},
    './access':{getStudioAccess:async()=>({locationId:'location'})},
    './record-relations':{},
    './studio-db':{studioDb:{rows:async(q:Prisma.Sql)=>{query=q;return [];}}}
  };
  const module={exports:{} as any};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/studio/library.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{module,exports:module.exports,require:(name:string)=>{assert.ok(name in deps,name);return deps[name];}});
  await module.exports.listStudioLibrary('location',2,{kind:'reference',platform:'youtube'});
  const sql=query!.sql;
  assert.ok(sql.indexOf('and kind =')<sql.indexOf('limit 51'));
  assert.ok(sql.indexOf('case')<sql.indexOf('limit 51'));
  assert.ok(query!.values.includes('youtube'));assert.ok(query!.values.includes(100));
  const branches=[...sql.matchAll(/~ '([^']+)' then '([^']+)'/g)].map(m=>({pattern:new RegExp(m[1]),platform:m[2]}));
  const fallback=sql.match(/from '([^']+)'\), 'other'/)![1];
  assert.ok(branches.length===3);assert.ok(!branches.some(b=>b.pattern.source.includes('\\.')));
  const infer=(url:string)=>branches.find(b=>b.pattern.test(url))?.platform ?? url.match(new RegExp(fallback))?.[1] ?? 'other';
  // These exercise the literal patterns emitted in the database query, with absent payload.platform.
  for(const [url,expected] of [
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ','youtube'],
    ['https://fb.watch/clip','facebook'],
    ['https://m.instagram.com/reel/clip','instagram'],
    ['https://example.org/post','other'],
    ['https://youtube.com.attacker.org/post','other']
  ])assert.equal(infer(url),expected,url);
});
