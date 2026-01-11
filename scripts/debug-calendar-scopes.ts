import db from '../lib/db';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function main() {
    const locationId = process.argv[2];
    if (!locationId) {
        console.error('Please provide a Location ID');
        process.exit(1);
    }

    console.log('--- GHL Scope Debugger ---');
    console.log('Using Client ID:', process.env.GHL_CLIENT_ID ? `${process.env.GHL_CLIENT_ID.substring(0, 15)}...` : 'MISSING');

    // 1. Get Token
    const allLocations = await db.location.findMany();
    const location = allLocations.find(l => {
        if (!l.ghlLocationId) return false;
        console.log(`Checking '${l.ghlLocationId}' (len: ${l.ghlLocationId.length}) against '${locationId}' (len: ${locationId.length})`);
        return l.ghlLocationId.trim() === locationId.trim();
    });

    if (location) {
        console.log('Found Location Object. Keys:', Object.keys(location));
        console.log('Has Token?', !!location.ghlAccessToken);
    } else {
        console.log('Did NOT find location object despite match??');
    }

    if (!location || !location.ghlAccessToken || !location.ghlRefreshToken) {
        console.error('Location or token not found for ID:', locationId);

        const all = await db.location.findMany({ select: { ghlLocationId: true } });
        console.log('Available Location IDs in DB:', all.map(l => l.ghlLocationId));

        process.exit(1);
    }

    // 2. Define Endpoints
    const baseUrl = 'https://services.leadconnectorhq.com';

    // 1.5. FORCE REFRESH to see Scopes
    console.log('\n--- FORCING TOKEN REFRESH (to inspect scopes) ---');
    const params = new URLSearchParams();
    params.append('client_id', process.env.GHL_CLIENT_ID!);
    params.append('client_secret', process.env.GHL_CLIENT_SECRET!);
    params.append('grant_type', 'refresh_token');
    params.append('refresh_token', location.ghlRefreshToken);

    let accessToken = location.ghlAccessToken;

    try {
        const tokenRes = await fetch(`${baseUrl}/oauth/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params
        });

        const tokenData = await tokenRes.json();
        console.log('>>> TOKEN RESPONSE (Truth):');
        console.log(JSON.stringify(tokenData, null, 2));
        console.log('--------------------------------------------------');

        if (tokenRes.ok) {
            console.log('✅ Refresh Successful. Updating DB...');
            accessToken = tokenData.access_token;

            // Critical: Update DB so the app doesn't break
            await db.location.update({
                where: { id: location.id },
                data: {
                    ghlAccessToken: tokenData.access_token,
                    ghlRefreshToken: tokenData.refresh_token,
                    ghlExpiresAt: new Date(Date.now() + (tokenData.expires_in * 1000))
                }
            });
            console.log('✅ DB Updated with new tokens.');

            if (tokenData.scope) {
                console.log('\n🔎 ANALYZING SCOPES:');
                const scopes = tokenData.scope.split(' ');
                console.log('Has calendars.readonly?', scopes.includes('calendars.readonly') ? '✅ YES' : '❌ NO');
                console.log('Has calendars/events.readonly?', scopes.includes('calendars/events.readonly') ? '✅ YES' : '❌ NO');
            }
        } else {
            console.error('❌ Refresh Failed. Using old token.');
        }

    } catch (e) {
        console.error('Refresh Error:', e);
    }

    // 2. Define Endpoints
    const headers = {
        'Authorization': `Bearer ${accessToken}`, // Use new token
        'Version': '2021-07-28',
        'Content-Type': 'application/json'
    };

    // 3. Test Setup
    const tests = [
        {
            name: 'Minimal Calendar Access',
            url: `${baseUrl}/calendars/?locationId=${locationId}`,
            requiredScope: 'calendars.readonly'
        },
        {
            name: 'Calendar Events Access',
            url: `${baseUrl}/calendars/events?locationId=${locationId}&startTime=${new Date().toISOString()}&endTime=${new Date().toISOString()}`,
            requiredScope: 'calendars/events.readonly'
        }
    ];

    // 4. Run Tests
    for (const test of tests) {
        console.log(`\nTesting: ${test.name}`);
        console.log(`URL: ${test.url}`);
        console.log(`Expecting Scope: ${test.requiredScope}`);

        try {
            const res = await fetch(test.url, { headers });
            const status = res.status;
            let body = await res.text();

            try { body = JSON.stringify(JSON.parse(body), null, 2); } catch { }

            if (res.ok) {
                console.log(`✅ SUCCESS (${status})`);
            } else {
                console.log(`❌ FAILED (${status})`);
                console.log('Response:', body);

                if (body.includes('authorized for this scope')) {
                    console.log(`⚠️  DIAGNOSIS: Token definitely missing '${test.requiredScope}'`);
                }
            }
        } catch (error) {
            console.error('Request Error:', error);
        }
    }
}

main()
    .catch(console.error)
    .finally(() => db.$disconnect());
