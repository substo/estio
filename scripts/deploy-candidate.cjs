// One committed, current integration tip is the only supported deployment input.
const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const canonicalBranch = 'release/studio-go-live';
function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function sha(value, label) {
  if (!/^[a-f0-9]{40}$/.test(value || '')) throw new Error(`Missing or invalid ${label}`);
  return value;
}
function deploymentExclusions(root) {
  const script = readFileSync(join(root, 'deploy-local-build.sh'), 'utf8');
  const start = script.indexOf('# Step 3: Upload Code + Artifacts');
  const end = script.indexOf('# Step 4:', start);
  if (start < 0 || end < 0) throw new Error('Cannot identify owned deployment upload exclusions');
  const patterns = [...script.slice(start, end).matchAll(/--exclude='([^']+)'/g)].map(m => m[1]);
  if (!patterns.includes('.git') || !patterns.includes('.env*')) throw new Error('Upload exclusions are incomplete');
  return patterns;
}
function excluded(file, patterns) {
  const path = file.replace(/\/$/, '');
  // The generated Next artifact is checked separately by the build fingerprint.
  if (path === '.next' || path.startsWith('.next/')) return true;
  return patterns.some(pattern => {
    const p = pattern.replace(/\/$/, '');
    const regex = p.split('*').map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*');
    return new RegExp(`${p.includes('/') ? '^' : '(^|/)'}${regex}($|/)`).test(path);
  });
}
function assertClean(root) {
  const patterns = deploymentExclusions(root);
  const tracked = git(root, 'diff', '--name-only', '--ignore-submodules=none', '-z', 'HEAD').split('\0').filter(Boolean);
  const other = git(root, 'ls-files', '--others', '--exclude-standard', '--directory', '-z').split('\0').filter(Boolean);
  const ignored = git(root, 'ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z').split('\0').filter(Boolean);
  // Every tracked file is part of the committed release identity, even when
  // documentation/native assets are omitted from the runtime upload. Only the
  // explicitly excluded SIMRelay work is allowed to remain outside this release.
  const dirtyTracked = tracked.filter(p => !(patterns.includes('SIMRelay/') && /^SIMRelay(?:\/|$)/.test(p)));
  const dirty = [...new Set([...dirtyTracked, ...[...other, ...ignored].filter(p => !excluded(p, patterns))])];
  if (dirty.length) throw new Error(`Uncommitted or untracked deployable input: ${dirty.slice(0, 12).join(', ')}`);
}
function ancestor(root, a, b) {
  try { git(root, 'merge-base', '--is-ancestor', a, b); return true; } catch { return false; }
}
function checkCandidate({ root = process.cwd(), deployedRevision, expectedRevision, expectedCanonical,
  remote = 'origin', branch = canonicalBranch } = {}) {
  sha(deployedRevision, 'deployed committed revision');
  if (git(root, 'symbolic-ref', '--short', '-q', 'HEAD') !== branch) throw new Error(`Deploy only from ${branch}`);
  assertClean(root);
  const revision = sha(git(root, 'rev-parse', 'HEAD'), 'candidate revision');
  if (expectedRevision && revision !== sha(expectedRevision, 'expected revision')) throw new Error('Candidate revision changed during deployment');
  const ref = `refs/heads/${branch}`;
  git(root, 'fetch', '--quiet', '--no-tags', remote, `+${ref}:refs/remotes/${remote}/${branch}`);
  const canonical = sha(git(root, 'rev-parse', `refs/remotes/${remote}/${branch}`), 'canonical revision');
  const advertised = git(root, 'ls-remote', '--exit-code', remote, ref).split(/\s/)[0];
  if (advertised !== canonical) throw new Error('Canonical tip moved during fetch; restart release preflight');
  if (expectedCanonical && canonical !== sha(expectedCanonical, 'expected canonical revision')) throw new Error('Canonical tip changed during deployment');
  if (revision !== canonical) throw new Error('Candidate is not the latest canonical release tip');
  if (!ancestor(root, deployedRevision, revision)) throw new Error('Candidate does not contain the deployed committed revision');
  // Detect local writes/branch movement while fetching too.
  assertClean(root);
  if (git(root, 'rev-parse', 'HEAD') !== revision) throw new Error('Candidate revision changed during preflight');
  return { revision, canonical, tree: sha(git(root, 'rev-parse', 'HEAD^{tree}'), 'candidate tree'), deployedRevision };
}
if (require.main === module) {
  try {
    if (process.argv.length < 3 || process.argv.length > 5) throw new Error('Usage: deploy-candidate.cjs DEPLOYED_REVISION [EXPECTED_REVISION EXPECTED_CANONICAL]');
    process.stdout.write(JSON.stringify(checkCandidate({ deployedRevision: process.argv[2], expectedRevision: process.argv[3], expectedCanonical: process.argv[4] })) + '\n');
  } catch (error) { console.error(`Release candidate refused: ${error.message}`); process.exitCode = 1; }
}
module.exports = { checkCandidate, assertClean, excluded, deploymentExclusions };
