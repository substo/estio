import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import db from "../lib/db";

async function run() {
    const secrets = await db.settingsSecret.findMany({});
    console.log(`Found ${secrets.length} secrets in the DB.`);
    for (const sec of secrets) {
        console.log(`Secret: ${sec.domain} / ${sec.secretKey} for ${sec.scopeId}`);
    }
}

run().catch(console.error).finally(() => process.exit(0));
