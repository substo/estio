
import { registerClerkDomain } from "../lib/auth/clerk-domains";
import * as dotenv from 'dotenv';
import path from 'path';

// Load .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function main() {
    const args = process.argv.slice(2);
    const domain = args[0];

    if (!domain) {
        console.error("Please provide a domain argument (e.g., npx tsx scripts/register-domain.ts properties.example.com)");
        process.exit(1);
    }

    console.log(`🚀 Starting manual registration for: ${domain}`);

    // Validate Secret Key availability
    if (!process.env.CLERK_SECRET_KEY) {
        console.error("❌ CLERK_SECRET_KEY is missing from environment variables.");
        process.exit(1);
    }

    const success = await registerClerkDomain(domain);

    if (success) {
        console.log("✅ Domain registered successfully (or already exists).");
    } else {
        console.error("❌ Failed to register domain.");
        process.exit(1);
    }
}

main();
