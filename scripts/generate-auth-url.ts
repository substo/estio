import { GHL_CONFIG } from '../config/ghl';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function main() {
    const clientId = process.env.GHL_CLIENT_ID;
    const redirectUri = process.env.GHL_REDIRECT_URI;

    if (!clientId || !redirectUri) {
        console.error('Missing GHL_CLIENT_ID or GHL_REDIRECT_URI in .env.local');
        process.exit(1);
    }

    const params = new URLSearchParams();
    params.append("client_id", clientId);
    params.append("redirect_uri", redirectUri);
    params.append("response_type", "code");
    params.append("scope", GHL_CONFIG.SCOPES.join(" "));

    // Optional: Add state if needed, but for manual re-auth it might not be strictly necessary 
    // if the callback handles it loosely, but our callback expects state for locationId.
    // Updated with the user's specific location ID
    const state = JSON.stringify({ locationId: 'ys9qMNTlv0jA6QPxXpbP' });
    params.append("state", state);

    const authUrl = `https://marketplace.leadconnectorhq.com/oauth/chooselocation?${params.toString()}`;

    console.log('\n=== GHL Re-Authorization URL ===');
    console.log('Please visit this URL in your browser to grant the new Media scopes:');
    console.log('\n' + authUrl + '\n');
    console.log('================================');
}

main().catch(console.error);
