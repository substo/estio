import { ghlFetch } from '../lib/ghl/client';
import { getLocationById, refreshGhlAccessToken } from '../lib/location';
import { GHL_CONFIG } from '../config/ghl';
import dotenv from 'dotenv';
import db from '../lib/db';

dotenv.config();

async function main() {
    // Get the first location with a token
    const location = await db.location.findFirst({
        where: { ghlAccessToken: { not: null } }
    });

    if (!location) {
        console.error('No location with GHL token found.');
        return;
    }

    console.log(`Testing with Location: ${location.name} (${location.id})`);
    console.log(`GHL Location ID: ${location.ghlLocationId}`);

    const ghlLocationId = location.ghlLocationId;
    let accessToken = location.ghlAccessToken;

    if (!ghlLocationId) {
        console.error('Missing GHL Location ID');
        return;
    }

    // Test 1: Get Location (Basic connectivity)
    console.log('\n--- Test 1: Get Location ---');
    try {
        const loc = await ghlFetch(`/locations/${ghlLocationId}`, accessToken!);
        console.log('Success:', loc ? 'OK' : 'Empty');
    } catch (e: any) {
        console.error('Error:', e.status, e.data?.message);
    }

    // Refresh Token first as requested (Manual implementation to test Client ID fix)
    console.log('Refreshing Access Token (Testing Client ID fix)...');
    try {
        // Strip suffix from Client ID if present
        const clientId = process.env.GHL_CLIENT_ID?.split('-')[0];
        const clientSecret = process.env.GHL_CLIENT_SECRET;

        console.log(`Using Client ID: ${clientId} (Original: ${process.env.GHL_CLIENT_ID})`);

        const params = new URLSearchParams();
        params.append('client_id', clientId!);
        params.append('client_secret', clientSecret!);
        params.append('grant_type', 'refresh_token');
        params.append('refresh_token', location.ghlRefreshToken!);

        const response = await fetch(`${GHL_CONFIG.API_BASE_URL}${GHL_CONFIG.ENDPOINTS.TOKEN}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: params,
        });

        if (!response.ok) {
            const error = await response.text();
            console.error("Failed to refresh GHL token (Manual):", error);
            // Fallback to existing token if refresh fails, just to try the endpoint
            console.log("Proceeding with existing token...");
        } else {
            const data = await response.json();
            accessToken = data.access_token;
            console.log('Token Refreshed Successfully (Manual)!');
        }

    } catch (e) {
        console.error('Failed to refresh token:', e);
    }

    // Test: User Requested Specific Endpoint
    // GET https://services.leadconnectorhq.com/objects/custom_objects.properties?locationId=ys9qMNTlv0jA6QPxXpbP
    console.log('\n--- Test: User Requested Endpoint ---');
    console.log('GET /objects/custom_objects.properties');
    try {
        const res = await ghlFetch(`/objects/custom_objects.properties?locationId=${ghlLocationId}`, accessToken!, {
            headers: {
                'Version': '2021-07-28'
            }
        });
        console.log('Success:', JSON.stringify(res, null, 2));
    } catch (e: any) {
        console.log(`Failed (${e.status}):`, JSON.stringify(e.data || e, null, 2));
    }
}

main()
    .catch(console.error)
    .finally(() => db.$disconnect());
