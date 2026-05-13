import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import db from "../lib/db";
import { getLegacyCryptr } from "../lib/security/legacy-cryptr";
import { settingsService } from "../lib/settings/service";

async function run() {
    const loc = await db.location.findUnique({
        where: { id: "cmingx6b10008rdycg7hwesyn" }
    });
    
    if (loc && loc.whatsappAccessToken) {
        const cryptr = getLegacyCryptr();
        const dec = cryptr.decrypt(loc.whatsappAccessToken);
        console.log(`Legacy DB Token Length: ${dec.length}`);
        console.log(`Legacy DB Token: ${dec.substring(0, 15)}...${dec.slice(-15)}`);
    } else {
        console.log("No legacy token in DB");
    }

    try {
        const secret = await settingsService.getSecret({
            scopeType: "LOCATION",
            scopeId: "cmingx6b10008rdycg7hwesyn",
            domain: "location.integrations",
            secretKey: "whatsapp_access_token",
        });
        if (secret) {
            console.log(`Settings Service Token Length: ${secret.length}`);
            console.log(`Settings Service Token: ${secret.substring(0, 15)}...${secret.slice(-15)}`);
        } else {
            console.log("Settings Service Token is NULL");
        }
    } catch (e: any) {
        console.error("Error reading settings secret:", e.message);
    }
}

run().catch(console.error).finally(() => process.exit(0));
