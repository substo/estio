
import * as dotenv from 'dotenv';
import path from 'path';

// Load .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function debugInstance() {
    const key = process.env.CLERK_SECRET_KEY;
    if (!key) {
        console.error("No CLERK_SECRET_KEY found");
        return;
    }

    console.log(`Using Key: ${key.substring(0, 10)}... (Test Key: ${key.startsWith('sk_test')})`);

    try {
        const res = await fetch("https://api.clerk.com/v1/instance", {
            headers: { Authorization: `Bearer ${key}` }
        });

        if (!res.ok) {
            console.error("Failed to fetch instance:", await res.text());
            return;
        }

        const data = await res.json();
        console.log("Instance Data:", JSON.stringify(data, null, 2));

    } catch (e) {
        console.error("Error:", e);
    }
}

debugInstance();
