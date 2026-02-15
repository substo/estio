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

    const accessToken = location!.ghlAccessToken!;

    console.log('--- Sending Document for Signature (Test) ---');

    // We need a dummy template ID or document URL to test. 
    // Since we don't have a template ID, we might fail, but we want to see if the endpoint is reachable (404/400 vs 401/403).
    // If we have a valid template ID from the previous list, we could use it.
    // Let's list templates first to get a valid ID.

    let templateId = '';
    try {
        const templates = await ghlFetch<any>(`/proposals/templates?limit=1&locationId=${location!.ghlLocationId}`, accessToken);
        if (templates.data && templates.data.length > 0) {
            templateId = templates.data[0]._id;
            console.log('Found Template ID:', templateId);
        } else {
            console.log('No templates found. Cannot fully test sending without a template.');
            // We can try sending a raw document if possible, but the requirement is "E-Signature using GHL Templates"
            return;
        }
    } catch (e) {
        console.error('Failed to list templates', e);
        return;
    }

    if (!templateId) return;

    // Send the template
    try {
        const payload = {
            templateId: templateId,
            locationId: location!.ghlLocationId,
            name: `Test Contract ${Date.now()}`,
            // We need a dummy contact for specific recipients
            // This part is tricky without a real contact ID.
            // But we can check if we get a 400 "Contact required" which validates the endpoint calls.
        };

        console.log('Sending payload:', payload);

        // Endpoint: POST /proposals?locationId=...
        // Or POST /proposals/document/send ?
        // Based on search it might be POST /proposals with templateId

        const response = await fetch('https://services.leadconnectorhq.com/proposals', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Version': '2021-07-28',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const text = await response.text();
        console.log('Response:', response.status, text);

    } catch (e: any) {
        console.error('Send Failed:', e);
    }
}

main().catch(console.error).finally(() => db.$disconnect());
