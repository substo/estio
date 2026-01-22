
import * as dotenv from 'dotenv';
import path from 'path';

// Load .env.local or .env
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY;

if (!CLERK_SECRET_KEY) {
    console.error("❌ CLERK_SECRET_KEY is missing from environment variables.");
    process.exit(1);
}

async function main() {
    console.log("🚀 Starting Clerk Domain Fix...");

    // 1. List Domains
    const listRes = await fetch("https://api.clerk.com/v1/domains", {
        headers: {
            "Authorization": `Bearer ${CLERK_SECRET_KEY}`,
            "Content-Type": "application/json"
        }
    });

    if (!listRes.ok) {
        console.error(`❌ Failed to list domains: ${listRes.statusText}`);
        process.exit(1);
    }

    const { data: domains } = await listRes.json();
    const targetDomain = domains.find((d: any) => d.name === "estio.co");

    if (!targetDomain) {
        console.error("❌ Domain 'estio.co' not found in Clerk.");
        process.exit(1);
    }

    console.log(`✅ Found 'estio.co' (ID: ${targetDomain.id})`);
    console.log(`   Current Proxy URL: ${targetDomain.proxy_url}`);

    if (!targetDomain.proxy_url) {
        console.log("   Proxy URL is already empty. No action needed.");
        return;
    }

    // 2. Update Domain to Remove Proxy URL
    console.log("🔄 Removing proxy_url...");

    const updateRes = await fetch(`https://api.clerk.com/v1/domains/${targetDomain.id}`, {
        method: "PATCH",
        headers: {
            "Authorization": `Bearer ${CLERK_SECRET_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            proxy_url: null
        })
    });

    if (!updateRes.ok) {
        const err = await updateRes.text();
        console.error(`❌ Failed to update domain: ${err}`);
        process.exit(1);
    }

    const updated = await updateRes.json();
    console.log(`✅ Successfully updated domain!`);
    console.log(`   New Proxy URL: ${updated.proxy_url}`);
}

main();
