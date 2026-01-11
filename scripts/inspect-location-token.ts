import db from '../lib/db';

async function main() {
    const locationId = process.argv[2];
    if (!locationId) {
        console.error('Please provide a Location ID');
        process.exit(1);
    }

    const location = await db.location.findFirst({
        where: { ghlLocationId: locationId }
    });

    if (!location) {
        console.error('Location not found');
        process.exit(1);
    }

    console.log('Location:', location.name);
    console.log('GHL Location ID:', location.ghlLocationId);
    console.log('Access Token (first 10):', location.ghlAccessToken?.substring(0, 10));
    console.log('Expires At:', location.ghlExpiresAt);
    console.log('Updated At:', location.updatedAt);

    // Check if token is expired
    if (location.ghlExpiresAt) {
        const now = new Date();
        const expires = new Date(location.ghlExpiresAt);
        console.log('Token Expired?', now > expires);
        console.log('Time until expiry:', (expires.getTime() - now.getTime()) / 1000 / 60, 'minutes');
        // Test API Calls
        console.log('\n--- Testing Token Permissions ---');

        const baseUrl = 'https://services.leadconnectorhq.com';
        const headers = {
            'Authorization': `Bearer ${location.ghlAccessToken}`,
            'Version': '2021-07-28',
            'Content-Type': 'application/json'
        };

        // 1. Try fetching Location (should work with locations.readonly)
        try {
            console.log('Fetching Location details...');
            const locRes = await fetch(`${baseUrl}/locations/${locationId}`, { headers });
            if (locRes.ok) {
                console.log('✅ Location fetch SUCCESS');
            } else {
                console.error('❌ Location fetch FAILED:', await locRes.text());
            }
        } catch (e) { console.error('Location fetch error:', e); }

        // 2. Try fetching Calendars (the failing endpoint)
        try {
            console.log('Fetching Calendars...');
            const calRes = await fetch(`${baseUrl}/calendars/?locationId=${locationId}`, { headers });
            if (calRes.ok) {
                console.log('✅ Calendar fetch SUCCESS');
                const data = await calRes.json();
                console.log(`Found ${data.calendars?.length || 0} calendars`);
            } else {
                console.error('❌ Calendar fetch FAILED:', await calRes.text());
            }
        } catch (e) { console.error('Calendar fetch error:', e); }
    }
}

main()
    .catch(console.error)
    .finally(() => db.$disconnect());
