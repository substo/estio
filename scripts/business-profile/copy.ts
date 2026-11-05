/**
 * One-time copy of today's business details into each Location's Business profile (settings domain location.business).
 *   npx tsx scripts/business-profile/copy.ts          dry run (default): prints what it would write, writes nothing
 *   npx tsx scripts/business-profile/copy.ts --apply  writes profiles; never overwrites an existing one
 * Back up the database before --apply.
 */
import db from '@/lib/db';
import { settingsService } from '@/lib/settings/service';
import { SETTINGS_DOMAINS } from '@/lib/settings/constants';
import { profileFromLegacy } from '@/lib/business-profile/copy';

const apply = process.argv.includes('--apply');
async function main() {
    const locations = await db.location.findMany({ select: { id: true, name: true, authRealm: true }, orderBy: { createdAt: 'asc' } });
    console.log(`${apply ? 'APPLY' : 'DRY RUN'}: ${locations.length} Location(s)`);
    for (const location of locations) {
        const scope = { scopeType: 'LOCATION' as const, scopeId: location.id };
        const [existing, publicSite, navigation, ai, siteConfig] = await Promise.all([
            settingsService.getDocument({ ...scope, domain: SETTINGS_DOMAINS.LOCATION_BUSINESS }),
            settingsService.getDocument<Record<string, unknown>>({ ...scope, domain: SETTINGS_DOMAINS.LOCATION_PUBLIC_SITE }),
            settingsService.getDocument<Record<string, unknown>>({ ...scope, domain: 'location.navigation' as never /* removed in phase 5; read only if still present */ }),
            settingsService.getDocument<Record<string, unknown>>({ ...scope, domain: SETTINGS_DOMAINS.LOCATION_AI }),
            db.siteConfig.findUnique({ where: { locationId: location.id }, select: { contactInfo: true, theme: true, socialLinks: true, footerBio: true, brandVoice: true, primaryColor: true, secondaryColor: true, accentColor: true } }),
        ]);
        const label = `${location.name ?? '(unnamed)'} [${location.authRealm}] ${location.id}`;
        if (existing) { console.log(`- ${label}: already has a Business profile (version ${existing.version}); left unchanged`); continue; }
        const result = profileFromLegacy({ publicSite: publicSite?.payload, navigation: navigation?.payload, ai: ai?.payload, siteConfig: siteConfig as Record<string, unknown> | null });
        console.log(`- ${label}: ${result.copied.length ? `copies ${result.copied.join(', ')}` : 'nothing to copy'}`);
        for (const s of result.skipped) console.log(`    skipped ${s.field} "${s.value}": ${s.reason}`);
        if (!result.copied.length) continue;
        if (!apply) { console.log(`    would write: ${JSON.stringify(result.profile)}`); continue; }
        await settingsService.upsertDocument({ ...scope, domain: SETTINGS_DOMAINS.LOCATION_BUSINESS, payload: result.profile, expectedVersion: 0, actorUserId: null });
        console.log('    written');
    }
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(() => db.$disconnect());
