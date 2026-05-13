import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import db from "../lib/db";
import { getWhatsAppCloudHealth } from "../lib/whatsapp/client";

async function run() {
    const locations = await db.location.findMany({
        where: { whatsappAccessToken: { not: null } },
        select: { id: true, name: true },
    });
    
    for (const loc of locations) {
        console.log(`Checking health for Location ${loc.id} (${loc.name})`);
        try {
            const health = await getWhatsAppCloudHealth(loc.id);
            console.log(JSON.stringify(health, null, 2));
        } catch (e: any) {
            console.error(`Error: ${e.message}`);
        }
    }
}

run().catch(console.error).finally(() => process.exit(0));
