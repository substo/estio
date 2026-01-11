import { ghlFetch } from '../lib/ghl/client';
import { getLocationById, refreshGhlAccessToken } from '../lib/location';
import db from '../lib/db';
import dotenv from 'dotenv';

// Load environment variables from .env.local
dotenv.config({ path: '.env.local' });

async function main() {
    // 1. Get Location
    // Default to the known ID if not provided
    const locationId = process.argv[2] || 'ys9qMNTlv0jA6QPxXpbP';
    console.log(`Looking for location with GHL ID: ${locationId}`);

    let location = await db.location.findFirst({
        where: { ghlLocationId: locationId }
    });

    if (!location) {
        console.error('Location not found in database.');
        return;
    }

    console.log(`Found Location: ${location.name} (ID: ${location.id})`);

    // 2. Check Token Validity / Refresh
    let accessToken = location.ghlAccessToken;

    if (!accessToken) {
        console.log('No access token found. Attempting refresh...');
        try {
            const refreshed = await refreshGhlAccessToken(location);
            accessToken = refreshed.ghlAccessToken;
            console.log('Token refreshed successfully.');
        } catch (e: any) {
            console.error('Failed to refresh token:', e.message);
            return;
        }
    } else {
        console.log('Access token found. Verifying validity...');
        try {
            // Test with a lightweight call
            await ghlFetch('/users/me', accessToken);
            console.log('Token is valid.');
        } catch (e: any) {
            console.log(`Token invalid or expired (${e.status}). Refreshing...`);
            try {
                const refreshed = await refreshGhlAccessToken(location);
                accessToken = refreshed.ghlAccessToken;
                console.log('Token refreshed successfully.');
            } catch (refreshError: any) {
                console.error('Failed to refresh token:', refreshError.message);
                return;
            }
        }
    }

    if (!accessToken) {
        console.error('Could not obtain valid access token.');
        return;
    }

    // 3. Get Custom Object
    const objectKey = 'custom_objects.properties'; // The key we verified works
    console.log(`\nFetching Custom Object: ${objectKey}...`);

    try {
        // User verified endpoint: /objects/custom_objects.properties
        const res = await ghlFetch(`/objects/${objectKey}?locationId=${locationId}`, accessToken);
        console.log('\n✅ SUCCESS! Custom Object Schema:');
        console.log(JSON.stringify(res, null, 2));
    } catch (e: any) {
        console.error(`\n❌ Failed to get custom object: ${e.status} - ${JSON.stringify(e.data || e.message)}`);
    }
}

main()
    .catch(console.error)
    .finally(() => db.$disconnect());
