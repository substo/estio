/**
 * One-time: move plaintext Gemini keys from SiteConfig.googleAiApiKey into the encrypted Location secret, then clear
 * the column. Dry run by default; `--apply` writes. Never prints key values.
 *   npx tsx scripts/ai/move-plaintext-keys.ts [--apply]
 */
import db from "@/lib/db";
import { settingsService } from "@/lib/settings/service";
import { SETTINGS_DOMAINS, SETTINGS_SECRET_KEYS } from "@/lib/settings/constants";
import { planPlaintextKeyMoves } from "@/lib/ai/plaintext-key-move";

const secret = (locationId: string) => ({ scopeType: "LOCATION" as const, scopeId: locationId, domain: SETTINGS_DOMAINS.LOCATION_AI, secretKey: SETTINGS_SECRET_KEYS.GOOGLE_AI_API_KEY });

async function main() {
  const apply = process.argv.includes("--apply");
  const configs = await db.siteConfig.findMany({ where: { googleAiApiKey: { not: null } }, select: { locationId: true, googleAiApiKey: true } });
  const rows = await Promise.all(configs.map(async c => ({ locationId: c.locationId, hasPlaintext: !!c.googleAiApiKey?.trim(),
    hasSecret: await settingsService.hasSecret(secret(c.locationId)) })));
  const plan = planPlaintextKeyMoves(rows);
  console.log(`${apply ? "APPLY" : "DRY RUN"}: ${plan.length} Location(s) with a plaintext Gemini key`);
  for (const step of plan) {
    console.log(`- ${step.locationId}: ${step.action === "copy-then-clear" ? "would copy to encrypted secret, then clear column" : "already has secret; would clear column"}`);
    if (!apply) continue;
    const plaintext = configs.find(c => c.locationId === step.locationId)!.googleAiApiKey!.trim();
    await db.$transaction(async tx => {
      if (step.action === "copy-then-clear") await settingsService.setSecret({ ...secret(step.locationId), plaintext, tx });
      await tx.siteConfig.update({ where: { locationId: step.locationId }, data: { googleAiApiKey: null } });
    });
    console.log("    done");
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "failed"); process.exitCode = 1; }).finally(() => db.$disconnect());
