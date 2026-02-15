import { ghlFetch } from '../lib/ghl/client';
import db from '../lib/db';
import { refreshGhlAccessToken } from '../lib/location';

async function main() {
    const locationId = process.argv[2];
    if (!locationId) {
        console.error('Please provide a Location ID');
        process.exit(1);
    }

    let location = await db.location.findFirst({
        where: { OR: [{ id: locationId }, { ghlLocationId: locationId }] }
    });

    if (!location || !location.ghlAccessToken) {
        console.error('Location not found or not connected');
        process.exit(1);
    }

    // Refresh token just in case
    try {
        const refreshed = await refreshGhlAccessToken(location);
        if (refreshed.ghlAccessToken) location = refreshed;
    } catch (e) { console.error('Token refresh failed', e); }

    if (!location) {
        console.error('Location not found in DB');
        process.exit(1);
    }
    const accessToken = location.ghlAccessToken!;

    console.log('--- Listing Proposals/Documents ---');
    try {
        // Try proposals endpoint first (V2)
        const proposals = await ghlFetch<any>(`/proposals?limit=5&locationId=${location.ghlLocationId}`, accessToken);
        console.log('✅ Proposals List Success:', JSON.stringify(proposals, null, 2));
    } catch (e: any) {
        console.error('❌ Proposals List Failed:', e.status || e.message);
    }

    console.log('\n--- Listing Templates ---');
    try {
        // Try templates endpoint
        // Endpoint could be /proposals/templates or similar
        // Based on search results, might be under documents
        const templates = await ghlFetch<any>(`/proposals/templates?limit=5&locationId=${location.ghlLocationId}`, accessToken);
        console.log('✅ Templates List Success:', JSON.stringify(templates, null, 2));
    } catch (e: any) {
        console.error('❌ Templates List Failed:', e.status, e.message);
    }
}

main().catch(console.error).finally(() => db.$disconnect());
