import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import db from "../lib/db";
import { settingsService } from "../lib/settings/service";
import { SETTINGS_DOMAINS, SETTINGS_SECRET_KEYS, isSettingsDualWriteLegacyEnabled } from "../lib/settings/constants";
import { getLegacyCryptr } from "../lib/security/legacy-cryptr";

async function run() {
    const resolvedLocationId = "cmingx6b10008rdycg7hwesyn";
    const localUserId = "user_2test";
    
    const accessTokenInput = "EAAczyMojzxQBRczz7ZBv7EpDTdGp3NKKh3Q76ncpORLEtGko0IBszRyIBJI9yru5sJNCK1LxWDD4ahHUcOeWD0AgwhWYIm4BGhZAwoeIZBKt4ZC8xuZADo0Qbud4c2ZCEHm0l47K0lLtT2WnooEREKm2052qinXUckkILyZA2usgWcuZBFZBwAojE2RZCr5h8XBQZDZD";
    const clearWhatsAppAccessToken = true; // user checked it!
    
    const shouldUpdateAccessToken = accessTokenInput.length > 0 && accessTokenInput !== "********";

    console.log({ clearWhatsAppAccessToken, shouldUpdateAccessToken });

    try {
        if (clearWhatsAppAccessToken) {
            console.log("Clearing secret...");
            await settingsService.clearSecret({
                scopeType: "LOCATION",
                scopeId: resolvedLocationId,
                domain: SETTINGS_DOMAINS.LOCATION_INTEGRATIONS,
                secretKey: SETTINGS_SECRET_KEYS.WHATSAPP_ACCESS_TOKEN,
                actorUserId: localUserId,
            });
        } else if (shouldUpdateAccessToken) {
            console.log("Setting secret...");
            await settingsService.setSecret({
                scopeType: "LOCATION",
                scopeId: resolvedLocationId,
                domain: SETTINGS_DOMAINS.LOCATION_INTEGRATIONS,
                secretKey: SETTINGS_SECRET_KEYS.WHATSAPP_ACCESS_TOKEN,
                plaintext: accessTokenInput,
                actorUserId: localUserId,
            });
        }

        if (isSettingsDualWriteLegacyEnabled()) {
            console.log("Dual writing legacy...");
            const updateData: any = {};
            const cryptr = getLegacyCryptr();
            if (shouldUpdateAccessToken) {
                console.log("Encrypting legacy token...");
                updateData.whatsappAccessToken = cryptr.encrypt(accessTokenInput);
            } else if (clearWhatsAppAccessToken) {
                updateData.whatsappAccessToken = null;
            }

            console.log("Updating db.location...");
            await db.location.update({
                where: { id: resolvedLocationId },
                data: updateData
            });
        }
        
        console.log("Success!");
    } catch (e: any) {
        console.error("Error:", e.message);
    }
}

run().catch(console.error);
