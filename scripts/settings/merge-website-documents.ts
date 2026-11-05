/**
 * Phase 5, one-time: fold each Location's location.navigation and location.content documents into its website document
 * (location.public_site), strip business copies from the website and AI documents (they live in the Business profile),
 * and delete the old documents. Dry run by default; --apply writes. Prints keys and checks only, never values.
 *   npx tsx scripts/settings/merge-website-documents.ts [--apply]
 */
import db from "@/lib/db";
import { settingsService } from "@/lib/settings/service";
import { businessProfileSchema } from "@/lib/business-profile/schema";
import { businessView } from "@/lib/business-profile/view";
import { planWebsiteMerge } from "@/lib/website/merge-plan";

const apply = process.argv.includes("--apply");
(async () => {
    const locations = await db.location.findMany({ select: { id: true, name: true, timeZone: true, domain: true, authRealm: true }, orderBy: { createdAt: "asc" } });
    console.log(`${apply ? "APPLY" : "DRY RUN"}: ${locations.length} Location(s)`);
    for (const location of locations) {
        const docs = await db.settingsDocument.findMany({ where: { scopeType: "LOCATION", scopeId: location.id, domain: { in: ["location.public_site", "location.navigation", "location.content", "location.ai", "location.business"] } } });
        const doc = (domain: string) => { const d = docs.find(x => x.domain === domain); return d ? { payload: d.payload as Record<string, any>, updatedAt: d.updatedAt, version: d.version } : null; };
        const businessDoc = doc("location.business");
        const parsed = businessDoc ? businessProfileSchema.safeParse(businessDoc.payload) : null;
        const business = parsed?.success ? businessView(parsed.data, location) : null;
        const plan = planWebsiteMerge({ publicSite: doc("location.public_site"), navigation: doc("location.navigation"), content: doc("location.content"), ai: doc("location.ai"), business });
        const label = `${location.name ?? "(unnamed)"} [${location.authRealm}] ${location.id}`;
        if (!plan.website && !plan.ai) { console.log(`- ${label}: nothing to merge`); continue; }
        const parts = [plan.website ? `website document with keys ${Object.keys(plan.website).sort().join(", ")}` : null, plan.deleteNavigation ? "delete navigation" : null, plan.deleteContent ? "delete content" : null, plan.ai ? "strip brand voice from AI settings" : null].filter(Boolean);
        console.log(`- ${label}: ${parts.join("; ")}`);
        for (const c of plan.conflicts) console.log(`    conflict: ${c}`);
        for (const s of plan.stripped) console.log(`    strip ${s.key}: ${s.inProfile ? "present in Business profile/Location" : "NOT in Business profile - review"}`);
        if (!apply) continue;
        if (plan.stripped.some(s => !s.inProfile)) { console.log("    skipped: a stripped value is not in the Business profile"); continue; }
        await db.$transaction(async tx => {
            const scope = { scopeType: "LOCATION" as const, scopeId: location.id };
            if (plan.website) await settingsService.upsertDocument({ ...scope, domain: "location.public_site", payload: plan.website, expectedVersion: doc("location.public_site")?.version ?? 0, schemaVersion: 1, tx });
            if (plan.ai) await settingsService.upsertDocument({ ...scope, domain: "location.ai", payload: plan.ai, expectedVersion: doc("location.ai")!.version, schemaVersion: 1, tx });
            if (plan.deleteNavigation) await settingsService.deleteDocument({ ...scope, domain: "location.navigation" as never, tx });
            if (plan.deleteContent) await settingsService.deleteDocument({ ...scope, domain: "location.content" as never, tx });
        });
        console.log("    written");
    }
})().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(() => db.$disconnect());
