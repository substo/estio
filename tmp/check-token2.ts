import db from "../lib/db";
import { settingsService } from "../lib/settings/service";

async function run() {
    console.log("Checking DB directly for whatsapp credentials...");
    
    // Look for recent secrets
    const secrets = await db.settingsSecret.findMany({
        where: { secretKey: "whatsappAccessToken" },
        orderBy: { updatedAt: 'desc' },
        take: 3
    });
    
    for (const secret of secrets) {
        console.log(`Found SettingsSecret for location ${secret.scopeId}, updated at ${secret.updatedAt}`);
        try {
            const val = await settingsService.getSecret({
                scopeType: secret.scopeType as any,
                scopeId: secret.scopeId,
                domain: secret.domain as any,
                secretKey: secret.secretKey
            });
            console.log(`  Decrypted token starts with: ${val ? val.substring(0, 15) : 'null'}...`);
        } catch (e: any) {
            console.error(`  Failed to decrypt: ${e.message}`);
        }
    }
    
    // Look at legacy location fields
    const locations = await db.location.findMany({
        where: { whatsappAccessToken: { not: null } },
        select: { id: true, name: true, whatsappAccessToken: true, whatsappPhoneNumberId: true },
        take: 3
    });
    
    for (const loc of locations) {
        console.log(`Found Legacy token for location ${loc.id} (${loc.name})`);
        console.log(`  whatsappAccessToken (encrypted len): ${loc.whatsappAccessToken?.length}`);
    }
}

run().catch(console.error).finally(() => process.exit(0));
