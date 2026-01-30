import db from '../lib/db';
import { ghlFetch } from '../lib/ghl/client';

async function main() {
    const locationId = process.argv[2];
    if (!locationId) {
        console.error('Please provide a Location ID');
        process.exit(1);
    }

    const location = await db.location.findFirst({
        where: { ghlLocationId: locationId }
    });

    if (!location || !location.ghlAccessToken) {
        console.error('Location not found or not connected');
        process.exit(1);
    }

    const accessToken = location.ghlAccessToken;
    console.log(`Testing token for location: ${location.name}`);

    // 1. Test Basic Scope (users.readonly)
    console.log('\n--- Testing /users/me (Basic Scope) ---');
    try {
        const user = await ghlFetch<any>('/users/me', accessToken);
        console.log('✅ Success. Token is valid.');
        console.log('   User:', user.name || user.email);
    } catch (e: any) {
        console.error('❌ Failed:', e.message);
        if (e.data) console.log('   Error Data:', JSON.stringify(e.data, null, 2));
    }

    // 1.5 Test Contacts Scope (contacts.readonly)
    console.log('\n--- Testing /contacts (Contacts Scope) ---');
    try {
        const contacts = await ghlFetch<any>('/contacts?limit=1', accessToken);
        console.log('✅ Success. Token has contacts scope.');
    } catch (e: any) {
        console.error('❌ Failed:', e.message);
        if (e.data) console.log('   Error Data:', JSON.stringify(e.data, null, 2));
    }

    // 2. Test Media Scope (medias.readonly)
    console.log('\n--- Testing /medias/files (Media Scope) ---');
    try {
        const list = await ghlFetch<any>('/medias/files?limit=1', accessToken);
        console.log('✅ Success. Token has media scopes.');
    } catch (e: any) {
        console.error('❌ Failed:', e.message);
        if (e.data) console.log('   Error Data:', JSON.stringify(e.data, null, 2));
    }
}

main()
    .catch(console.error)
    .finally(() => db.$disconnect());
