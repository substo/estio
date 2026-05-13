import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import db from "../lib/db";
import { getWhatsAppCloudCredentials } from "../lib/whatsapp/client";

async function run() {
    const locations = await db.location.findMany({
        where: { whatsappAccessToken: { not: null } },
        select: { id: true, name: true },
    });
    
    for (const loc of locations) {
        console.log(`Location ${loc.id} (${loc.name})`);
        try {
            const creds = await getWhatsAppCloudCredentials(loc.id);
            console.log(`  Resolved Access Token Length: ${creds.accessToken.length}`);
            console.log(`  Starts with: ${creds.accessToken.substring(0, 15)}`);
            if (!creds.accessToken.includes("EAA")) {
                console.log(`  WARNING: RESOLVED TOKEN DOES NOT CONTAIN EAA! Looks like: ${creds.accessToken.substring(0, 50)}...`);
            } else {
                console.log(`  Resolved Token is valid EAA format.`);
            }
        } catch (e: any) {
            console.error(`  Failed to resolve credentials: ${e.message}`);
        }
    }
}

run().catch(console.error).finally(() => process.exit(0));
