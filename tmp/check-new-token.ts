import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import db from "../lib/db";
import { getLegacyCryptr } from "../lib/security/legacy-cryptr";

async function run() {
    const loc = await db.location.findUnique({
        where: { id: "cmingx6b10008rdycg7hwesyn" }
    });
    
    if (loc && loc.whatsappAccessToken) {
        const cryptr = getLegacyCryptr();
        const dec = cryptr.decrypt(loc.whatsappAccessToken);
        console.log(`Current DB Token: ${dec.substring(0, 15)}...${dec.slice(-15)}`);
    } else {
        console.log("No token in DB");
    }
}

run().catch(console.error).finally(() => process.exit(0));
