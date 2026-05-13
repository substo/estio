import db from "../lib/db";
import { settingsService } from "../lib/settings/service";
import { SETTINGS_DOMAINS, SETTINGS_SECRET_KEYS } from "../lib/settings/constants";

async function run() {
    const location = await db.location.findFirst();
    if (!location) {
        console.log("No location found");
        return;
    }

    const secret = await settingsService.getSecret({
        scopeType: "LOCATION",
        scopeId: location.id,
        domain: SETTINGS_DOMAINS.LOCATION_INTEGRATIONS,
        secretKey: SETTINGS_SECRET_KEYS.WHATSAPP_ACCESS_TOKEN,
    }).catch(() => "not found or error");

    console.log("DB Location Token (starts with):", location.whatsappAccessToken ? location.whatsappAccessToken.substring(0, 15) : "Not present");
    console.log("Settings Service Token (starts with):", secret ? String(secret).substring(0, 15) : "Not present");
}

run().catch(console.error).finally(() => process.exit(0));
