import { ghlFetch } from '../lib/ghl/client';
import db from '../lib/db';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function main() {
    const locationId = 'ys9qMNTlv0jA6QPxXpbP'; // The location in question
    const objectKey = 'custom_objects.properties'; // The key found in logs

    console.log(`Inspecting schema for ${objectKey} in location ${locationId}...`);

    const location = await db.location.findFirst({
        where: { ghlLocationId: locationId }
    });

    if (!location || !location.ghlAccessToken) {
        console.error('Location or access token not found');
        return;
    }

    try {
        const res = await ghlFetch<any>(`/objects/${objectKey}?locationId=${locationId}`, location.ghlAccessToken);
        console.log('Object Details:', JSON.stringify(res, null, 2));

        const fields = res.fields || res.properties || [];
        console.log(`Found ${fields.length} fields.`);

        const floorField = fields.find((f: any) => f.key === 'floor' || f.fieldKey === 'floor' || f.name === 'Floor');
        if (floorField) {
            console.log('✅ Floor field FOUND:', JSON.stringify(floorField, null, 2));
        } else {
            console.log('❌ Floor field NOT FOUND.');
            console.log('Available fields:', fields.map((f: any) => `${f.name} (${f.key})`).join(', '));
        }

    } catch (e: any) {
        console.error('Error fetching object:', e.message);
        if (e.data) console.error('Error data:', JSON.stringify(e.data, null, 2));
    }
}

main()
    .catch(console.error)
    .finally(() => db.$disconnect());
