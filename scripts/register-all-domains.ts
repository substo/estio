
import db from "../lib/db";
import { registerClerkDomain } from "../lib/auth/clerk-domains";
import * as dotenv from 'dotenv';
import path from 'path';

// Load .env.local and .env
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

async function main() {
    console.log("🚀 Starting Bulk Domain Registration...");

    // Validate Secret Key availability
    if (!process.env.CLERK_SECRET_KEY) {
        console.error("❌ CLERK_SECRET_KEY is missing from environment variables.");
        process.exit(1);
    }

    try {
        // Fetch all SiteConfigs with a domain
        const configs = await db.siteConfig.findMany({
            where: {
                domain: {
                    not: null
                }
            },
            select: {
                domain: true,
                locationId: true
            }
        });

        console.log(`Found ${configs.length} domains to process.`);

        for (const config of configs) {
            if (!config.domain) continue;

            console.log(`Processing: ${config.domain} (Location: ${config.locationId})`);
            const success = await registerClerkDomain(config.domain);

            if (success) {
                console.log(`✅ Registered: ${config.domain}`);
            } else {
                console.error(`❌ Failed: ${config.domain}`);
            }

            // Small delay to avoid rate limits
            await new Promise(r => setTimeout(r, 500));
        }

        console.log("✨ Bulk Registration Complete.");

    } catch (error) {
        console.error("Fatal Error:", error);
        process.exit(1);
    }
}

main();
