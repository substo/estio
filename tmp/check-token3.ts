import "dotenv/config";
import db from "../lib/db";
import { getLegacyCryptr } from "../lib/security/legacy-cryptr";

async function run() {
    const locations = await db.location.findMany({
        where: { whatsappAccessToken: { not: null } },
        select: { id: true, name: true, whatsappAccessToken: true },
    });
    
    const cryptr = getLegacyCryptr();
    
    for (const loc of locations) {
        console.log(`Location ${loc.id} (${loc.name})`);
        try {
            const dec = cryptr.decrypt(loc.whatsappAccessToken!);
            console.log(`  Decrypted legacy token length: ${dec.length}`);
            
            // let's see if it's the valid EAA one
            if (dec.includes("EAA")) {
                console.log(`  It contains EAA.`);
                if (dec.trim() !== dec) console.log(`  WARNING: It has leading/trailing whitespace!`);
            } else {
                console.log(`  It does NOT contain EAA! Actually looks like: ${dec.substring(0, 50)}`);
            }
        } catch (e: any) {
            console.error(`  Failed to decrypt: ${e.message}`);
        }
    }
}

run().catch(console.error).finally(() => process.exit(0));
