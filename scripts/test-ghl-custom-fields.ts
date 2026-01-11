import { ghlFetch } from '../lib/ghl/client';
import { getLocationById, refreshGhlAccessToken } from '../lib/location';
import db from '../lib/db';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function main() {
    const locationId = 'ys9qMNTlv0jA6QPxXpbP'; // Default
    const objectKey = 'custom_objects.properties';

    console.log(`Testing Custom Fields API for: ${objectKey}`);

    // 1. Get Location & Token
    const location = await db.location.findFirst({ where: { ghlLocationId: locationId } });
    if (!location) throw new Error('Location not found');

    let accessToken = location.ghlAccessToken;
    try {
        const refreshed = await refreshGhlAccessToken(location);
        accessToken = refreshed.ghlAccessToken;
    } catch (e) {
        console.error('Refresh failed:', e);
        return;
    }

    // 2. List Custom Fields
    console.log('\nListing Custom Fields...');
    try {
        // Endpoint: /locations/{locationId}/customFields
        const res = await ghlFetch<any>(`/locations/${locationId}/customFields`, accessToken!);
        console.log(`✅ Fetched ${res.customFields?.length || 0} Custom Fields.`);
        // console.log('Raw Fields:', JSON.stringify(res.customFields, null, 2));

        // Filter for our object
        const objectFields = res.customFields?.filter((f: any) => f.objectKey === objectKey || (f.key && f.key.startsWith(objectKey)));
        console.log(`Found ${objectFields?.length || 0} fields for ${objectKey}:`);
        objectFields?.forEach((f: any) => console.log(` - ${f.name} (${f.key}) [${f.dataType}]`));

    } catch (e: any) {
        console.error('❌ Failed to list custom fields:', e.status, JSON.stringify(e.data || e.message));
        return;
    }

    // 3. Create Test Field
    console.log('\nCreating Test Field (test_field_v2)...');
    const newField = {
        name: "Test Field V2",
        dataType: "TEXT",
        objectKey: objectKey, // Critical: Link to Custom Object
        key: `${objectKey}.test_field_v2`, // Explicit key? Or generated?
        // Some docs say 'key' is generated from name, but for custom objects maybe we specify it?
        // Let's try specifying it to be safe, or let GHL generate it if it ignores it.
    };

    try {
        const res = await ghlFetch<any>(`/locations/${locationId}/customFields`, accessToken!, {
            method: 'POST',
            body: JSON.stringify(newField)
        });
        console.log('✅ Created Field Success:', JSON.stringify(res, null, 2));
    } catch (e: any) {
        console.error('❌ Creation Failed:', e.status, JSON.stringify(e.data || e.message));
    }
}

main()
    .catch(console.error)
    .finally(() => db.$disconnect());
