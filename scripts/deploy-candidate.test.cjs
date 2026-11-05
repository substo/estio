const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, mkdirSync, rmSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const { checkCandidate } = require('./deploy-candidate.cjs');
const branch = 'release/studio-go-live';
const run = (cwd, ...args) => execFileSync('git', args, {cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
function fixture(t) {
  const d=mkdtempSync(path.join(os.tmpdir(),'deploy-candidate-'));t.after(()=>rmSync(d,{recursive:true,force:true}));
  const remote=path.join(d,'remote.git'),repo=path.join(d,'repo');run(d,'init','--bare',remote);run(d,'clone',remote,repo);
  run(repo,'config','user.name','Fixture');run(repo,'config','user.email','fixture@example.invalid');run(repo,'checkout','-b',branch);
  writeFileSync(path.join(repo,'deploy-local-build.sh'),"# Step 3: Upload Code + Artifacts\nrsync --exclude='.git' --exclude='.env*' --exclude='node_modules' --exclude='next-env.d.ts' --exclude='SIMRelay/' --exclude='documentation/' ./ server\n# Step 4: Configure Env\n");
  writeFileSync(path.join(repo,'.gitignore'),'.env*\n.next/\nnode_modules/\nnext-env.d.ts\ncoverage/\n');writeFileSync(path.join(repo,'source'),'base');mkdirSync(path.join(repo,'documentation'));writeFileSync(path.join(repo,'documentation','release.md'),'committed policy');run(repo,'add','.');run(repo,'commit','-m','base');run(repo,'push','-u','origin',branch);
  return {root:repo,base:run(repo,'rev-parse','HEAD'),commit(text='change',push=true){writeFileSync(path.join(repo,'source'),text);run(repo,'add','source');run(repo,'commit','-m',text);const sha=run(repo,'rev-parse','HEAD');if(push)run(repo,'push','origin',branch);return sha;}};
}
test('clean latest integrated release containing live revision is accepted',t=>{const f=fixture(t);f.commit();const v=checkCandidate({...f,deployedRevision:f.base});assert.equal(v.revision,run(f.root,'rev-parse','HEAD'));assert.equal(v.canonical,v.revision);});
test('old local candidate cannot omit newer canonical work',t=>{const f=fixture(t);const old=f.base;f.commit();run(f.root,'reset','--hard',old);assert.throws(()=>checkCandidate({...f,deployedRevision:old}),/latest canonical/);});
test('divergent sibling missing live history is rejected even if canonical',t=>{const f=fixture(t);const live=f.commit('live');run(f.root,'reset','--hard',f.base);f.commit('sibling',false);run(f.root,'push','--force','origin',branch);assert.throws(()=>checkCandidate({...f,deployedRevision:live}),/does not contain/);});
test('tracked staged and unstaged source changes are refused',t=>{const f=fixture(t);writeFileSync(path.join(f.root,'source'),'dirty');assert.throws(()=>checkCandidate({...f,deployedRevision:f.base}),/Uncommitted/);run(f.root,'add','source');assert.throws(()=>checkCandidate({...f,deployedRevision:f.base}),/Uncommitted/);});
test('untracked and ignored-but-uploaded inputs are refused',t=>{const f=fixture(t);writeFileSync(path.join(f.root,'new-code'),'dirty');assert.throws(()=>checkCandidate({...f,deployedRevision:f.base}),/new-code/);rmSync(path.join(f.root,'new-code'));mkdirSync(path.join(f.root,'coverage'));writeFileSync(path.join(f.root,'coverage','artifact'),'dirty');assert.throws(()=>checkCandidate({...f,deployedRevision:f.base}),/coverage/);});
test('secrets, generated build and actual upload exclusions are allowed',t=>{const f=fixture(t);writeFileSync(path.join(f.root,'.env.prod'),'PRIVATE=fixture');mkdirSync(path.join(f.root,'.next'));writeFileSync(path.join(f.root,'.next','BUILD_ID'),'fixture');writeFileSync(path.join(f.root,'next-env.d.ts'),'generated');mkdirSync(path.join(f.root,'SIMRelay'));writeFileSync(path.join(f.root,'SIMRelay','native'),'excluded');assert.equal(checkCandidate({...f,deployedRevision:f.base}).revision,f.base);});
test('changed canonical and candidate identities refuse a second phase',t=>{const f=fixture(t);const first=checkCandidate({...f,deployedRevision:f.base});f.commit();assert.throws(()=>checkCandidate({...f,deployedRevision:f.base,expectedRevision:first.revision,expectedCanonical:first.canonical}),/Candidate revision changed/);assert.throws(()=>checkCandidate({...f,deployedRevision:f.base,expectedCanonical:first.canonical}),/Canonical tip changed/);});
test('unknown live revision and task branches fail closed',t=>{const f=fixture(t);assert.throws(()=>checkCandidate({...f,deployedRevision:''}),/Missing or invalid/);run(f.root,'checkout','-b','task');assert.throws(()=>checkCandidate({...f,deployedRevision:f.base}),/Deploy only/);});

test('tracked documentation changes are refused even when upload excludes documentation',t=>{const f=fixture(t);writeFileSync(path.join(f.root,'documentation','release.md'),'uncommitted policy');assert.throws(()=>checkCandidate({...f,deployedRevision:f.base}),/documentation\/release.md/);});
test('canonical movement is refused while candidate revision itself remains unchanged',t=>{const f=fixture(t);const first=checkCandidate({...f,deployedRevision:f.base});f.commit('another-integrated-release');run(f.root,'reset','--hard',first.revision);assert.equal(run(f.root,'rev-parse','HEAD'),first.revision);assert.throws(()=>checkCandidate({...f,deployedRevision:f.base,expectedRevision:first.revision,expectedCanonical:first.canonical}),/Canonical tip changed/);});
