import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('unified backup retains all schemas, rejects incomplete/corrupt archives and refuses overwrite', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'estio-backup-test-'));
  try {
    const bin = path.join(root, 'bin'); mkdirSync(bin);
    writeFileSync(path.join(bin, 'pg_dump'), '#!/bin/bash\n[[ "$*" == "--format=custom --file=database.dump service=fixture" ]] || exit 9\necho fixture > database.dump\n', { mode: 0o700 });
    writeFileSync(path.join(bin, 'pg_restore'), `#!/bin/bash
if [[ "$1" == --list ]]; then
 echo '1; 1 1 SCHEMA - public owner'
 [[ "$BACKUP_TEST_MODE" == missing ]] || echo '2; 1 2 SCHEMA - studio owner'
 exit 0
fi
[[ "$*" == '--file=/dev/null database.dump' ]] || exit 9
[[ "$BACKUP_TEST_MODE" != corrupt ]]
`, { mode: 0o700 });
    const run = (mode, output) => spawnSync('bash', ['scripts/backup-unified-database.sh', 'fixture', output], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, BACKUP_TEST_MODE: mode }, encoding: 'utf8' });
    const good = path.join(root, 'good');
    assert.equal(run('good', good).status, 0);
    assert.match(readFileSync(path.join(good, 'SHA256SUMS'), 'utf8'), /database.dump/);
    assert.notEqual(run('good', good).status, 0);
    for (const mode of ['missing', 'corrupt']) {
      const output = path.join(root, mode);
      assert.notEqual(run(mode, output).status, 0);
      assert.equal(existsSync(path.join(output, 'SHA256SUMS')), false);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
