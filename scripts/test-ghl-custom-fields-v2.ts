import { ghlFetch } from '../lib/ghl/client';
import { getLocationById, refreshGhlAccessToken } from '../lib/location';
import db from '../lib/db';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function main() {
    const locationId = 'ys9qMNTlv0jA6QPxXpbP'; // Default
    const objectKey = 'custom_objects.properties';

    console.log(`Testing Custom Fields V2 API for: ${objectKey}`);

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

    // 2a. Get Object ID
    console.log('\nFetching Object ID...');
    let objectId = 'ZFqEnUsyTzsEF6hsClOe'; // Hardcoded from logs
    try {
        const objRes = await ghlFetch<any>(`/objects/${objectKey}?locationId=${locationId}`, accessToken!);
        console.log('Object Keys:', Object.keys(objRes));
        if (objRes.id) objectId = objRes.id;
        console.log(`✅ Object ID: ${objectId}`);
    } catch (e) {
        console.error('Failed to fetch object ID');
        return;
    }

    // 2b. List Custom Fields (V2)
    console.log(`\nListing Custom Fields via /custom-fields/object-key/${objectKey}...`);
    try {
        const res = await ghlFetch<any>(`/custom-fields/object-key/${objectKey}?locationId=${locationId}`, accessToken!);
        console.log(`✅ Fetched ${res.customFields?.length || 0} Custom Fields.`);
        res.customFields?.forEach((f: any) => console.log(` - ${f.name} (${f.key}) [${f.dataType}]`));
    } catch (e: any) {
        console.error('❌ Failed to list custom fields (V2):', e.status, JSON.stringify(e.data || e.message));
    }

    // 3. Create Test Field (V2)
    console.log('\nCreating Test Field (test_field_v3) via POST /custom-fields/ ...');
    const newField = {
        name: "Test Field V3",
        dataType: "TEXT",
        objectKey: objectKey,
        locationId: locationId,
        fieldKey: `${objectKey}.test_field_v3`,
        parentId: objectId // Use hardcoded or fetched ID
    };

    try {
        const res = await ghlFetch<any>(`/custom-fields/`, accessToken!, {
            method: 'POST',
            body: JSON.stringify(newField)
        });
        console.log('✅ Created Field Success (V2):', JSON.stringify(res, null, 2));
    } catch (e: any) {
        console.error('❌ Creation Failed (V2):', e.status, JSON.stringify(e.data || e.message));
    }
}

main()
    .catch(console.error)
    .finally(() => db.$disconnect());
