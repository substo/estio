// Fingerprint inputs used by the Next build and runtime relay, without printing secrets.
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0')
    .filter(file => file && file !== 'deploy-local-build.sh' && file !== 'scripts/deploy-build-fingerprint.cjs')
    .filter(file => /^(app|components|lib|public|styles|prisma|scripts|types)\//.test(file) || /^(package.*\.json|next.*\.(js|mjs|ts)|tsconfig\.json|middleware\.tsx?|instrumentation\.tsx?|tailwind.*|postcss.*)$/.test(file))
    .sort();
const hash = createHash('sha256');
for (const file of [...files, '.env.prod']) hash.update(file).update('\0').update(readFileSync(file)).update('\0');
process.stdout.write(hash.digest('hex') + '\n');
