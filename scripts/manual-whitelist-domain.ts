
// Usage: npx tsx scripts/manual-whitelist-domain.ts <domain>
import { whitelistClerkDomain } from "../lib/auth/clerk-domains";

const domain = process.argv[2];

if (!domain) {
    console.error("Please provide a domain argument. Usage: npx tsx scripts/manual-whitelist-domain.ts <domain>");
    process.exit(1);
}

console.log(`Manually whitelisting domain: ${domain}...`);

whitelistClerkDomain(domain).then((success) => {
    if (success) {
        console.log("✅ Success! The domain is now allowed in Clerk.");
        process.exit(0);
    } else {
        console.error("❌ Failed. Check server logs for details.");
        process.exit(1);
    }
});
