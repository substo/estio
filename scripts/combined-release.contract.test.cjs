const {test}=require('node:test');const assert=require('node:assert/strict');const {readFileSync:read}=require('node:fs');
test('combined release retains browse-first Library and canonical phase6 services',()=>{
 assert.match(read('app/(main)/studio/(tenant)/library/page.tsx','utf8'),/LibraryBrowse/);
 assert.match(read('app/(main)/studio/_components/library-browse.tsx','utf8'),/LibraryAddDialog/);
 assert.match(read('lib/business-profile/service.ts','utf8'),/settings/);
 assert.match(read('lib/location-config/service.ts','utf8'),/settings/);
 assert.doesNotMatch(read('prisma/schema.prisma','utf8'),/model SiteConfig\s*\{/);
 assert.match(read('prisma/migrations/20261105150000_retire_site_config/migration.sql','utf8'),/as k from studio.platform_google_youtube_connections/);
});
test('owned deploy fences all mutation stages and publishes only after soak',()=>{
 const s=read('deploy-local-build.sh','utf8');assert.ok(s.indexOf('node scripts/deploy-candidate.cjs')<s.indexOf('./scripts/backup.sh'));
 assert.match(s, /assert_release_input\n\n# Step 2/);assert.match(s,/assert_release_input\n\n# Step 5/);
 assert.ok(s.indexOf('deploy-guard.py publish')>s.indexOf('Post-switch soak checks passed'));
 assert.doesNotMatch(s,/drift check is temporarily skipped/);assert.match(s,/trap rollback_on_error EXIT/);
 assert.match(s,/--exclude='SIMRelay\/'/);
});

test('retirement recovery uses pinned CLI available with production omit-dev install',()=>{const s=read('scripts/settings/recover-retirement-migration.ts','utf8');assert.match(s,/execFileSync\('npx',\['--yes','prisma@6.19.0','migrate','resolve'/);assert.doesNotMatch(s,/node_modules\/\.bin\/prisma/);});
