import { ghlFetch } from '../lib/ghl/client';
import db from '../lib/db';
import { GHL_CONFIG } from '../config/ghl';
import * as dotenv from 'dotenv';
dotenv.config();

async function main() {
    const code = process.argv[2];
    if (!code) {
        console.error('Please provide the Authorization Code');
        process.exit(1);
    }

    console.log('Exchanging code for token...');

    // We need to manually construct the request because our library functions assume refresh token flow or existing token
    // This is a one-off exchange script

    // NOTE: client_id and client_secret should be in env
    // We will assume they are set in process.env

    const params = new URLSearchParams();
    params.append('client_id', '69244fe2f2f0fa6dc9d67a03-mlnwz68a');
    params.append('client_secret', '0cacbcca-e37b-4022-814c-ca7bc74fb740');
    params.append('grant_type', 'authorization_code');
    params.append('code', code);
    params.append('redirect_uri', 'https://estio.co/api/oauth/callback'); // From user's URL

    try {
        const response = await fetch(`${GHL_CONFIG.API_BASE_URL}/oauth/token`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: params
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Exchange failed:', response.status, errorText);
            process.exit(1);
        }

        const data = await response.json();
        console.log('✅ Token exchanged successfully!');
        // console.log(data);

        const { access_token, refresh_token, locationId, userType } = data;

        if (!locationId) {
            console.error('No locationId returned in token data');
            process.exit(1);
        }

        // Update the location in DB
        console.log(`Updating location ${locationId}...`);

        // Find existing location or create? 
        // We assume it exists or we update based on ghlLocationId

        const location = await db.location.findFirst({
            where: { ghlLocationId: locationId }
        });

        if (location) {
            await db.location.update({
                where: { id: location.id },
                data: {
                    ghlAccessToken: access_token,
                    ghlRefreshToken: refresh_token,
                    // Store scopes if we had a field for it, but we parse them from token/config usually
                }
            });
            console.log('✅ Database updated for existing location:', location.name);
        } else {
            console.log('⚠️ Location not found in DB with this GHL ID. Creating new...');
            await db.location.create({
                data: {
                    name: 'GHL Imported Location',
                    ghlLocationId: locationId,
                    ghlAccessToken: access_token,
                    ghlRefreshToken: refresh_token,
                }
            });
            console.log('✅ New location created.');
        }

    } catch (e) {
        console.error('Error:', e);
    }
}

main().catch(console.error).finally(() => db.$disconnect());
