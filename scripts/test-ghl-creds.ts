import { GHL_CONFIG } from '../config/ghl';
import * as dotenv from 'dotenv';
dotenv.config();

async function main() {
    console.log('Testing GHL Credentials...');
    console.log('Client ID:', process.env.GHL_CLIENT_ID?.slice(0, 5) + '...');
    console.log('Client Secret:', process.env.GHL_CLIENT_SECRET?.slice(0, 5) + '...');

    const params = new URLSearchParams();
    params.append('client_id', process.env.GHL_CLIENT_ID || '');
    params.append('client_secret', process.env.GHL_CLIENT_SECRET || '');
    params.append('grant_type', 'authorization_code');
    params.append('code', 'invalid_code_test'); // We expect "Invalid grant" or "Authorization code not found", NOT "Invalid client credentials"
    params.append('redirect_uri', 'https://estio.co/api/oauth/callback');

    try {
        const response = await fetch(`${GHL_CONFIG.API_BASE_URL}/oauth/token`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: params
        });

        const text = await response.text();
        console.log('Response Status:', response.status);
        console.log('Response Body:', text);

        if (text.includes('Invalid client credentials')) {
            console.error('❌ FAILURE: Client credentials are still rejected.');
        } else if (text.includes('Authorization code not found') || text.includes('invalid_grant')) {
            console.log('✅ SUCCESS: Credentials accepted! (Error was about the code, which is expected).');
        } else {
            console.log('❓ UNKNOWN: Unexpected response.');
        }

    } catch (e) {
        console.error('Error:', e);
    }
}

main();
