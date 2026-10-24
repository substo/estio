const assert = require('node:assert/strict');
const test = require('node:test');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { fingerprintBuildInputs } = require('./deploy-build-fingerprint.cjs');

test('build fingerprints include unstaged source while preserving Git ignores and the production environment input', () => {
    const root = mkdtempSync(join(tmpdir(), 'estio-build-fingerprint-'));
    const write = (file, value) => writeFileSync(join(root, file), value);
    try {
        execFileSync('git', ['init', '--quiet'], { cwd: root });
        for (const directory of ['app', 'data', '.next']) mkdirSync(join(root, directory));
        write('.gitignore', 'data/\n.next/\n.env*\napp/ignored.ts\n');
        write('.env.prod', 'RUNTIME_SECRET=production-input\n');
        write('.env.local', 'IGNORED_SECRET=local\n');
        write('app/ignored.ts', 'ignored source');
        write('data/private.json', 'private data');
        write('.next/build.js', 'build output');
        write('app/page.tsx', 'export default function Page() { return null; }');
        const initial = fingerprintBuildInputs(root);
        assert.match(initial, /^[a-f0-9]{64}$/);

        write('app/page.tsx', 'export default function Page() { return "new content"; }');
        const modifiedSource = fingerprintBuildInputs(root);
        assert.notEqual(modifiedSource, initial, 'untracked app edits must invalidate a prebuilt artifact');

        execFileSync('git', ['add', 'app/page.tsx'], { cwd: root });
        assert.equal(fingerprintBuildInputs(root), modifiedSource, 'staging the same source must not alter its fingerprint');
        write('.env.local', 'IGNORED_SECRET=changed\n');
        write('app/ignored.ts', 'changed ignored source');
        write('data/private.json', 'changed private data');
        write('.next/build.js', 'changed build output');
        assert.equal(fingerprintBuildInputs(root), modifiedSource, 'ignored secrets/data/build output must remain excluded');

        write('.env.prod', 'RUNTIME_SECRET=changed-production-input\n');
        assert.notEqual(fingerprintBuildInputs(root), modifiedSource, 'production environment remains an explicit build input');
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});
