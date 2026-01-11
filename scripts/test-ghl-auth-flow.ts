import { getAccessToken, ghlFetchWithAuth } from '../lib/ghl/token';
import db from '../lib/db';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function main() {
    const locationId = process.argv[2] || 'ys9qMNTlv0jA6QPxXpbP';
    console.log(`Testing Auth Flow for Location ID: ${locationId}`);

    // 1. Test getAccessToken
    console.log('\n--- Testing getAccessToken ---');
    const token = await getAccessToken(locationId);
    if (token) {
        console.log('✅ Retrieved Access Token:', token.substring(0, 10) + '...');
    } else {
        console.error('❌ Failed to retrieve access token');
        return;
    }

    // 2. Test ghlFetchWithAuth (Simple User Fetch)
    console.log('\n--- Testing ghlFetchWithAuth (GET /users/me) ---');
    try {
        const user = await ghlFetchWithAuth<any>(locationId, '/users/me');
        console.log('✅ API Call Success:', user.name || user.email || 'User found');
    } catch (e: any) {
        console.error('❌ API Call Failed:', e.message);
    }

    // 3. Simulate Expiry & Refresh (Optional - careful with rate limits/revocation)
    // We won't force a refresh here to avoid breaking the token for the user immediately,
    // but the logic is there in the token manager.

    console.log('\n✅ Auth Flow Test Completed');
}

main()
    .catch(console.error)
    .finally(() => db.$disconnect());
