import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

test('company forms submit only fields accepted by core actions', () => {
    const add = read('app/(main)/admin/companies/_components/add-company-dialog.tsx');
    const edit = read('app/(main)/admin/companies/_components/edit-company-dialog.tsx');
    const remove = read('app/(main)/admin/companies/_components/delete-company-dialog.tsx');
    const actions = read('app/(main)/admin/companies/actions.ts');

    for (const source of [add, edit, remove]) assert.doesNotMatch(source, /name="locationId"/);
    assert.doesNotMatch(actions.slice(0, actions.indexOf('// FEED ACTIONS')), /formData\.get\('locationId'\)/);
    assert.match(add, /name="name"/);
    assert.match(add, /name="type"/);
    assert.match(edit, /name="companyId"/);
    assert.match(remove, /name="confirmationName"/);
});

test('core company controls expose the requested accessible semantics', () => {
    const page = read('app/(main)/admin/companies/page.tsx');
    const filters = read('app/(main)/admin/companies/_components/company-filters.tsx');
    const edit = read('app/(main)/admin/companies/_components/edit-company-dialog.tsx');
    const remove = read('app/(main)/admin/companies/_components/delete-company-dialog.tsx');

    assert.equal((page.match(/<h1/g) || []).length, 1);
    assert.match(page, /<caption className="sr-only">/);
    assert.match(page, /overflow-x-auto/);
    assert.match(filters, /htmlFor="company-search"/);
    assert.match(filters, /role="group" aria-label="Filter companies by type"/);
    assert.match(filters, /type="button"/);
    assert.match(filters, /aria-pressed=/);
    assert.match(edit, /company-name-\$\{company\.id\}/);
    assert.match(edit, /Edit \{company\.name\}/);
    assert.match(remove, /Delete \{company\.name\}/);
});

test('the core edit dialog does not mount feed management', () => {
    assert.doesNotMatch(
        read('app/(main)/admin/companies/_components/edit-company-dialog.tsx'),
        /FeedManager|feed-manager/,
    );
});

test('company detail access is bound to the server active location', () => {
    const detail = read('app/(main)/admin/companies/[id]/view/page.tsx');

    assert.doesNotMatch(detail, /searchParams|searchLocationId|verifyUserHasAccessToLocation/);
    assert.match(detail, /const locationId = access\.locationId/);
    assert.match(detail, /const access = await getActiveContactsAccess\(\)/);
    assert.match(detail, /where: \{\s*id,\s*locationId,/);
    assert.match(detail, /where: \{ property: \{ locationId \} \}/);
    assert.match(detail, /where: \{ contact: contactVisibilityWhere \}/);
    assert.match(detail, /notFound\(\)/);
    assert.doesNotMatch(detail, /locationId: company\.locationId|\?locationId=/);
});

test('company detail remains accessible and mounts location-scoped feed management', () => {
    const detail = read('app/(main)/admin/companies/[id]/view/page.tsx');

    assert.equal((detail.match(/<CardTitle/g) || []).length, 1);
    assert.equal((detail.match(/<h2/g) || []).length, 3);
    assert.match(detail, /flex flex-wrap items-center justify-between/);
    assert.match(detail, /safeCompanyWebsite\(company\.website\)/);
    assert.match(detail, /<ul className="space-y-2">/);
    assert.match(detail, /feeds: \{[\s\S]*lastSyncAt: true,[\s\S]*orderBy: \{ createdAt: "desc" \}/);
    assert.match(detail, /<FeedManager companyId=\{company\.id\} initialFeeds=\{company\.feeds\}/);
});

test('company feed mutations enforce active-location ownership', () => {
    const actions = read('app/(main)/admin/companies/actions.ts');
    const feedActions = actions.slice(actions.indexOf('// FEED ACTIONS'));

    assert.match(feedActions, /companyAccess\.requireCompany\(validated\.data\.companyId\)/);
    assert.equal((feedActions.match(/feedAccess\.requireFeed/g) || []).length, 2);
    assert.match(feedActions, /deleteMany\([\s\S]*company: \{ locationId \}/);
    assert.match(feedActions, /updateMany\([\s\S]*company: \{ locationId \}/);
    assert.doesNotMatch(feedActions, /return \{ success: false, message: e\.message \}/);
    assert.doesNotMatch(feedActions, /propertyFeed\.(delete|update)\(/);
});

test('company update and delete mutations retain the active-location predicate', () => {
    const actions = read('app/(main)/admin/companies/actions.ts');
    const coreActions = actions.slice(0, actions.indexOf('// FEED ACTIONS'));

    assert.match(coreActions, /const \{ locationId \} = await companyAccess\.requireCompany\(companyId\)/);
    assert.match(coreActions, /db\.company\.updateMany\(\{\s*where: \{ id: companyId, locationId \}/);
    assert.match(coreActions, /tx\.company\.findFirst\(\{\s*where: \{ id: companyId, locationId \}/);
    assert.match(coreActions, /tx\.company\.deleteMany\(\{\s*where: \{ id: companyId, locationId \}/);
    assert.ok(
        coreActions.indexOf('tx.company.findFirst') < coreActions.indexOf('tx.companyPropertyRole.deleteMany'),
        'the authoritative company must be rechecked before linked roles are deleted',
    );
});

test('manual company feed sync uses an authenticated active-location POST command', () => {
    const route = read('app/api/admin/companies/feed-sync/route.ts');
    const manager = read('app/(main)/admin/companies/_components/feed-manager.tsx');

    assert.match(route, /export async function POST\(/);
    assert.doesNotMatch(route, /export async function GET\(/);
    assert.match(route, /const \{ userId \} = await auth\(\)/);
    assert.match(route, /const location = await getLocationContext\(\)/);
    assert.match(route, /where: \{ id: validated\.data\.companyId, locationId: location\.id \}/);
    assert.match(route, /feeds: \{[\s\S]*where: \{ isActive: true \}/);
    assert.match(route, /new CronGuard\('sync-feeds'\)/);
    assert.doesNotMatch(route, /error\?\.message|error\.message/);

    assert.match(manager, /fetch\('\/api\/admin\/companies\/feed-sync'/);
    assert.match(manager, /method: 'POST'/);
    assert.match(manager, /JSON\.stringify\(\{ companyId \}\)/);
    assert.doesNotMatch(manager, /\/api\/cron\/sync-feeds/);
});

test('feed processing uses the centralized safe public fetch boundary', () => {
    const service = read('lib/feed/feed-service.ts');
    const boundary = read('lib/feed/safe-feed-fetch.ts');

    assert.match(service, /fetchSafeFeedText\(feed\.url\)/);
    assert.doesNotMatch(service, /fetch\(feed\.url\)/);
    assert.match(boundary, /fetchPublicHttpResponse/);
    assert.match(boundary, /maxResponseBytes: maxBytes/);
    assert.match(boundary, /maxRedirects/);
});

test('feed analyze and preview routes require active-location company access and safe fetching', () => {
    const analyze = read('app/api/feed/analyze/route.ts');
    const preview = read('app/api/feed/preview/route.ts');
    const wizard = read('app/(main)/admin/companies/_components/feed-builder/feed-wizard.tsx');

    for (const route of [analyze, preview]) {
        assert.match(route, /const \{ userId \} = await auth\(\)/);
        assert.match(route, /const location = await getLocationContext\(\)/);
        assert.match(route, /locationId: location\.id/);
        assert.match(route, /fetchSafeFeedText\(validated\.data\.url\)/);
        assert.doesNotMatch(route, /fetch\(url\)|error\.message|error\?\.message/);
    }
    assert.match(wizard, /JSON\.stringify\(\{ url, companyId, mappingConfig: mapping \}\)/);
});

test('feed analysis is location-rate-limited and deduplicated before invoking AI', () => {
    const analyze = read('app/api/feed/analyze/route.ts');
    const guard = read('lib/feed/feed-analysis-guard.ts');

    assert.match(analyze, /runFeedAnalysisGuarded\(\{/);
    assert.match(analyze, /locationId: location\.id/);
    assert.match(analyze, /status: 429/);
    assert.match(analyze, /status: 409/);
    assert.match(analyze, /status: 503/);
    assert.match(analyze, /'Retry-After'/);
    assert.match(guard, /estio:feed-analysis-rate:v1/);
    assert.match(guard, /estio:feed-analysis-lock:v1/);
    assert.match(guard, /const inFlight = new Map/);
});

test('feed manager and wizard expose accessible, retryable mutation states', () => {
    const manager = read('app/(main)/admin/companies/_components/feed-manager.tsx');
    const wizard = read('app/(main)/admin/companies/_components/feed-builder/feed-wizard.tsx');

    assert.match(manager, /<AlertDialog/);
    assert.match(manager, /aria-label=\{`Delete feed \$\{feed\.url\}`\}/);
    assert.match(manager, /aria-label=\{`\$\{feed\.isActive \? 'Pause' : 'Activate'\} feed/);
    assert.match(manager, /role=\{message\.kind === 'error' \? 'alert' : 'status'\}/);
    assert.match(manager, /router\.refresh\(\)/);
    assert.doesNotMatch(manager, /window\.location\.reload|\bconfirm\(/);

    assert.match(wizard, /htmlFor="company-feed-url"/);
    assert.match(wizard, /type="url"/);
    assert.match(wizard, /response\.headers\.get\('Retry-After'\)/);
    assert.match(wizard, /aria-busy=/);
    assert.match(wizard, /role=\{message\.kind === 'error' \? 'alert' : 'status'\}/);
    assert.match(wizard, /aria-label=\{`Map \$\{label\} to a CRM field`\}/);
});

test('feed creation validates canonical mappings and rejects company duplicates', () => {
    const actions = read('app/(main)/admin/companies/actions.ts');
    const feedActions = actions.slice(actions.indexOf('// FEED ACTIONS'));

    assert.match(feedActions, /url: feedUrlSchema/);
    assert.match(feedActions, /feedMappingConfigSchema\.safeParse\(parsed\)/);
    assert.match(feedActions, /format === 'GENERIC' && !mappingConfig/);
    assert.match(feedActions, /propertyFeed\.findMany\(\{[\s\S]*where: \{ companyId: validated\.data\.companyId \}/);
    assert.match(feedActions, /matchesCanonicalFeedUrl\(feed\.url, validated\.data\.url\)/);
    assert.match(feedActions, /TransactionIsolationLevel\.Serializable/);
    assert.match(feedActions, /error\.code === 'P2034'/);
    assert.match(feedActions, /This feed is already configured for the company\./);
});
