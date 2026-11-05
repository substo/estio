/**
 * One-time copy before the SiteConfig ("SearchConfig") table is dropped (phase 6). For every Location it copies the
 * operational values still only in that table into their homes, never overwriting a value already there:
 *   AI model, transcript, viewing-session and outreach settings -> location.ai document
 *   search defaults, public listing switch, Substo site title     -> location.public_site (website) document
 *   domain                                                        -> Location.domain
 * Business details were copied to the Business profile in phase 2 and Substo site addresses by the phase 6 migration.
 * Prints exactly what it would write; differences between the table and a document are reported, the document wins.
 *
 *   npx tsx scripts/settings/retire-site-config.ts            # dry run
 *   npx tsx scripts/settings/retire-site-config.ts --apply
 */
import db from "@/lib/db";
import { settingsService } from "@/lib/settings/service";
import { SETTINGS_DOMAINS } from "@/lib/settings/constants";
import { planSiteConfigRetirement } from "@/lib/location-config/retire";

async function main() {
    const apply = process.argv.includes("--apply");
    const rows = await db.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT * FROM "SearchConfig"`);
    console.log(`${apply ? "APPLY" : "DRY RUN"}: ${rows.length} SiteConfig row(s)`);
    for (const row of rows) {
        const locationId = String(row.locationId);
        const [location, ai, website] = await Promise.all([
            db.location.findUnique({ where: { id: locationId }, select: { name: true, domain: true } }),
            settingsService.getDocument<Record<string, unknown>>({ scopeType: "LOCATION", scopeId: locationId, domain: SETTINGS_DOMAINS.LOCATION_AI }),
            settingsService.getDocument<Record<string, unknown>>({ scopeType: "LOCATION", scopeId: locationId, domain: SETTINGS_DOMAINS.LOCATION_PUBLIC_SITE }),
        ]);
        const plan = planSiteConfigRetirement({ row, locationDomain: location?.domain ?? null, ai: ai?.payload ?? null, website: website?.payload ?? null });
        console.log(`- ${location?.name ?? "(missing Location)"} ${locationId}`);
        for (const line of plan.report) console.log(`    ${line}`);
        if (!apply || !location) continue;
        if (Object.keys(plan.ai).length) await settingsService.upsertDocument({ scopeType: "LOCATION", scopeId: locationId, domain: SETTINGS_DOMAINS.LOCATION_AI,
            payload: { ...(ai?.payload ?? {}), ...plan.ai }, expectedVersion: ai?.version ?? 0, actorUserId: null, schemaVersion: 1 });
        if (Object.keys(plan.website).length) await settingsService.upsertDocument({ scopeType: "LOCATION", scopeId: locationId, domain: SETTINGS_DOMAINS.LOCATION_PUBLIC_SITE,
            payload: { ...(website?.payload ?? {}), ...plan.website }, expectedVersion: website?.version ?? 0, actorUserId: null, schemaVersion: 1 });
        if (plan.domain) await db.location.update({ where: { id: locationId }, data: { domain: plan.domain } });
        console.log("    written");
    }
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(() => db.$disconnect());
