import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, chmod, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runThreadAction } from './thread-action';
import type { Profile } from './contract';
const profile = { id:'p', enabled:true, account:'default', provider:'codex', model:'test' } as Profile;

test('Merge sends approval to the original conversation and verifies its Git result, without starting a thread', async () => {
 const dir=await mkdtemp(path.join(os.tmpdir(),'thread-action-'));
 const cwd=path.join(dir,'repo'), remote=path.join(dir,'remote');
 const git=(at:string,...args:string[])=>execFileSync('git',['-c','user.name=Fixture','-c','user.email=f@localhost',...args],{cwd:at,encoding:'utf8'}).trim();
 try {
  await mkdir(cwd);git(dir,'init','--bare','-q',remote);git(cwd,'init','-q');
  await writeFile(path.join(cwd,'a.txt'),'before\n');git(cwd,'add','.');git(cwd,'commit','-qm','base');
  const base=git(cwd,'rev-parse','HEAD');git(cwd,'remote','add','origin',remote);git(cwd,'push','-q','origin','HEAD:refs/heads/release/studio-go-live');git(cwd,'checkout','-qb','build/original');
  await writeFile(path.join(cwd,'a.txt'),'approved\n');
  const cli=path.join(dir,'t3');
  await writeFile(cli,`#!/usr/bin/env node
const fs=require('node:fs'),cp=require('node:child_process');const cwd=${JSON.stringify(cwd)},dir=${JSON.stringify(dir)},a=process.argv.slice(2);
if(a[1]==='start')throw Error('Must not start another thread');
if(a[1]==='send'){fs.writeFileSync(dir+'/sent.json',JSON.stringify({args:a,text:fs.readFileSync(0,'utf8')}));cp.execFileSync('git',['-c','user.name=F','-c','user.email=f@localhost','commit','-qam','approved'],{cwd});cp.execFileSync('git',['push','-q','origin','HEAD:refs/heads/release/studio-go-live'],{cwd});console.log('{}');}
else console.log(JSON.stringify({thread:{threadId:'mcp:original',model:'test',providerInstanceId:'codex',status:'completed',activeRunId:null,pendingRequestCount:0,latestRunId:fs.existsSync(dir+'/sent.json')?'new':'old',worktreePath:cwd,branch:'build/original'},messages:[{role:'assistant',text:'Merged with context'}]}));
`);await chmod(cli,0o755);
  let dispatched=0;
  const result=await runThreadAction({action:{id:'owner-approval',kind:'merge',state:'queued',at:''},command:cli,checkout:cwd,canonical:cwd,target:'release/studio-go-live',worktree:cwd,threadId:'mcp:original',branch:'build/original',title:'Fixture',base,files:['a.txt'],profile,approvalRoot:path.join(dir,'actions'),dispatched:async()=>{dispatched++;}});
  assert.equal(result.sha,git(cwd,'rev-parse','HEAD'));assert.equal(dispatched,1);
  const sent=JSON.parse(await readFile(path.join(dir,'sent.json'),'utf8'));
  assert.equal(sent.args[1],'send');assert.equal(sent.args[2],'mcp:original');assert.match(sent.text,/Build action owner-approval/);
  // Reconciliation is read-only and cannot dispatch the approval again.
  await runThreadAction({action:{id:'owner-approval',kind:'merge',state:'queued',at:'',reconcile:true},command:cli,checkout:cwd,canonical:cwd,target:'release/studio-go-live',worktree:cwd,threadId:'mcp:original',branch:'build/original',title:'Fixture',base,files:['a.txt'],profile,approvalRoot:path.join(dir,'actions'),dispatched:async()=>{throw Error('Duplicate send');}});
 } finally {await rm(dir,{recursive:true,force:true});}
});

test('the helper invoked inside the conversation verifies reviewed content and conflict scope before pushing', async () => {
 const { threadMerge }=await import('./thread-merge');
 for(const invalid of ['none','task-content','conflict-scope']) {
  const dir=await mkdtemp(path.join(os.tmpdir(),'thread-merge-'));
  const cwd=path.join(dir,'task'),canonical=path.join(dir,'canonical'),remote=path.join(dir,'remote');
  const git=(at:string,...args:string[])=>execFileSync('git',args,{cwd:at,encoding:'utf8'}).trim();
  try {
   await mkdir(cwd);git(dir,'init','--bare','-q',remote);git(cwd,'init','-q');git(cwd,'config','user.name','Fixture');git(cwd,'config','user.email','f@localhost');
   await writeFile(path.join(cwd,'a.txt'),'base\n');git(cwd,'add','.');git(cwd,'commit','-qm','base');
   const base=git(cwd,'rev-parse','HEAD');git(cwd,'remote','add','origin',remote);git(cwd,'worktree','add','-qb','release/studio-go-live',canonical,base);git(canonical,'push','-q','origin','release/studio-go-live');git(cwd,'checkout','-qb','build/original');
   await writeFile(path.join(cwd,'a.txt'),'approved\n');const blob=git(cwd,'hash-object','a.txt');
   const receipt=path.join(dir,'approval.json');await writeFile(receipt,JSON.stringify({checkout:cwd,canonical,worktree:cwd,branch:'build/original',target:'release/studio-go-live',title:'Fixture',base,files:['a.txt'],blobs:[{file:'a.txt',blob}]}));
   if(invalid==='task-content') {
    await writeFile(path.join(cwd,'a.txt'),'not approved\n');await assert.rejects(threadMerge(receipt,'prepare'),/Unreviewed/);
   } else {
    await threadMerge(receipt,'prepare');
    assert.equal(git(cwd,'ls-remote','origin','refs/heads/release/studio-go-live').split(/\s/)[0],base);
    if(invalid==='conflict-scope'){await writeFile(path.join(canonical,'unrelated.txt'),'not approved\n');git(canonical,'add','unrelated.txt');}
    git(canonical,'commit','-qm','Context-aware merge');
    if(invalid==='conflict-scope')await assert.rejects(threadMerge(receipt,'finish'),/files the task didn't/);
    else {const result=await threadMerge(receipt,'finish');assert.equal(result.sha,git(canonical,'rev-parse','HEAD'));}
   }
   if(invalid!=='none')assert.equal(git(cwd,'ls-remote','origin','refs/heads/release/studio-go-live').split(/\s/)[0],base);
  } finally {await rm(dir,{recursive:true,force:true});}
 }
});
