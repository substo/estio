import { ghlFetch } from '../lib/ghl/client';
import { getLocationById, refreshGhlAccessToken } from '../lib/location';
import db from '../lib/db';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function main() {
    const locationId = 'ys9qMNTlv0jA6QPxXpbP'; // Default
    const objectKey = 'custom_objects.properties';

    console.log(`Testing Schema Update for: ${objectKey}`);

    // 1. Get Location & Token
    const location = await db.location.findFirst({ where: { ghlLocationId: locationId } });
    if (!location) throw new Error('Location not found');

    let accessToken = location.ghlAccessToken;
    // Refresh to be safe
    try {
        const refreshed = await refreshGhlAccessToken(location);
        accessToken = refreshed.ghlAccessToken;
    } catch (e) {
        console.error('Refresh failed:', e);
        return;
    }

    // 2. Get Current Schema
    console.log('Fetching current schema...');
    let currentSchema: any;
    try {
        currentSchema = await ghlFetch(`/objects/${objectKey}?locationId=${locationId}`, accessToken!);
        console.log('✅ Fetched Schema.');
    } catch (e: any) {
        console.error('❌ Failed to fetch schema:', e.status);
        return;
    }

    // 3. Test Update (Description)
    console.log('Testing PUT /objects/:key to update description...');
    const updateBody = {
        labels: currentSchema.labels,
        description: `Real estate properties (Updated at ${new Date().toISOString()})`,
        searchableProperties: currentSchema.searchableProperties,
        primaryDisplayProperty: currentSchema.primaryDisplayProperty,
        locationId: locationId
    };

    try {
        const res = await ghlFetch<any>(`/objects/${objectKey}`, accessToken!, {
            method: 'PUT',
            body: JSON.stringify(updateBody)
        });
        console.log('✅ Update Description Success:', res.description);
    } catch (e: any) {
        console.error('❌ Update Description Failed:', e.status, JSON.stringify(e.data || e.message));
    }

    // 4. Test Adding Property via PUT
    console.log('Testing PUT /objects/:key to add property...');

    // Construct new property
    const newProperty = {
        label: "Test Field V1",
        key: "custom_objects.properties.test_field_v1", // Full key format?
        dataType: "TEXT",
        position: 999
    };

    // Append to existing properties (if any) or create new array
    // Note: The GET response usually has 'properties' array.
    const updatedProperties = currentSchema.properties ? [...currentSchema.properties, newProperty] : [newProperty];

    const updateBodyWithProp = {
        ...updateBody,
        properties: updatedProperties
    };

    try {
        const res = await ghlFetch<any>(`/objects/${objectKey}`, accessToken!, {
            method: 'PUT',
            body: JSON.stringify(updateBodyWithProp)
        });
        console.log('✅ Update with Property Success:', JSON.stringify(res, null, 2));
    } catch (e: any) {
        console.error('❌ Update with Property Failed:', e.status, JSON.stringify(e.data || e.message));
    }
}

main()
    .catch(console.error)
    .finally(() => db.$disconnect());
