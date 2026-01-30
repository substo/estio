
import { whitelistClerkDomain } from "../lib/auth/clerk-domains";
import * as dotenv from 'dotenv';
import path from 'path';

// Load .env.local
// Load .env.local and .env
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

async function main() {
    const args = process.argv.slice(2);
    const domain = args[0];

    if (!domain) {
        console.error("Please provide a domain argument (e.g., npx tsx scripts/whitelist-only.ts estio.co)");
        process.exit(1);
    }

    console.log(`🚀 Starting whitelist-only for: ${domain}`);

    // Validate Secret Key availability
    if (!process.env.CLERK_SECRET_KEY) {
        console.error("❌ CLERK_SECRET_KEY is missing from environment variables.");
        process.exit(1);
    }

    const success = await whitelistClerkDomain(domain);

    if (success) {
        console.log("✅ Domain whitelisted successfully (Allowed Origins + Redirect URLs).");
    } else {
        console.error("❌ Failed to whitelist domain.");
        process.exit(1);
    }
}

main();
