/** Read-only evidence index. Heuristics find candidates, not proven transition graphs. */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean).sort();
const evidence = [];
for (const file of files) {
  if (!/\.(?:ts|tsx|js|mjs|swift|kt|prisma|sql)$/.test(file) || /(?:^|\/)(?:vendor|node_modules|build|\.build|tests?|__tests__)\//.test(file) || /(?:\.test|\.spec)\./.test(file) || file === 'scripts/audit/state-machines.mjs') continue;
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { continue; }
  const historical = /(?:migrations|\/import\/|\/recovery\/)/.test(file);
  let owner = null;
  text.split('\n').forEach((line, index) => {
    const model = line.match(/^model\s+(\w+)/); if (model) owner = model[1];
    const kinds = [];
    if (file.endsWith('.prisma') && /^\s+(?:status|state|\w+Status|\w+State)\s+\w/.test(line)) kinds.push('persisted-state');
    if (/\b(?:type|enum)\s+\w*(?:State|Status|Phase|Stage|Mode)\b/.test(line)) kinds.push('state-type');
    if (/\b(?:status|state|phase|stage)\s*:\s*z\.enum\(/.test(line)) kinds.push('validated-state');
    if (/\buseState(?:<[^>]+>)?\(/.test(line) && /(?:loading|saving|pending|open|running|error|step|phase|status|state)/i.test(line)) kinds.push('ui-state');
    if (/\b(?:status|state|phase|stage)\b.*(?:===|!==|==|!=| IN\s*\(|CHECK\s*\()/i.test(line)) kinds.push('state-guard-candidate');
    if (/\b(?:lease_token|leaseToken|leaseExpiresAt|lease_expires_at)\b/.test(line)) kinds.push('lease-fence-candidate');
    if (kinds.length) evidence.push({ file, line: index + 1, owner: file.endsWith('.prisma') ? owner : null, historical, kinds, source: line.trim().slice(0, 350) });
  });
}
const counts = {};
for (const item of evidence) for (const kind of item.kinds) counts[kind] = (counts[kind] ?? 0) + 1;
process.stdout.write(JSON.stringify({ scope: 'Tracked source only; textual candidates, not exhaustive semantic discovery. Historical SQL is evidence, not runtime authority. No environment or database reads.', filesScanned: files.length, filesWithEvidence: new Set(evidence.map(e => e.file)).size, counts, evidence }, null, 2) + '\n');
