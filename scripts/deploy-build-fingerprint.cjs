// Fingerprint inputs used by the Next build and runtime relay, without printing secrets.
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

function fingerprintBuildInputs(root = process.cwd()) {
    // New source files are part of a build before they are staged or committed.
    // Git's standard ignore rules still omit local data, secrets, and build output.
    const listedFiles = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
        cwd: root,
        encoding: 'utf8',
    }).split('\0');
    const files = [...new Set(listedFiles)]
        .filter(file => file && file !== 'deploy-local-build.sh' && file !== 'scripts/deploy-build-fingerprint.cjs')
        .filter(file => /^(app|components|lib|public|styles|prisma|scripts|types)\//.test(file) || /^(package.*\.json|next.*\.(js|mjs|ts)|tsconfig\.json|middleware\.tsx?|instrumentation\.tsx?|tailwind.*|postcss.*)$/.test(file))
        .sort();
    const hash = createHash('sha256');
    // Production environment is an intentional input even though Git ignores it.
    for (const file of [...files, '.env.prod']) hash.update(file).update('\0').update(readFileSync(join(root, file))).update('\0');
    return hash.digest('hex');
}

if (require.main === module) process.stdout.write(fingerprintBuildInputs() + '\n');
module.exports = { fingerprintBuildInputs };
