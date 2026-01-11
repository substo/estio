import { ghlFetch } from '../lib/ghl/client';
import { getLocationById, refreshGhlAccessToken } from '../lib/location';
import db from '../lib/db';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function main() {
    const locationId = 'ys9qMNTlv0jA6QPxXpbP'; // Default
    const testKey = 'custom_objects.test_object_v1';

    console.log(`Testing Creation of: ${testKey}`);

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

    // 2. Create Custom Object
    console.log('Creating new Custom Object...');
    const createBody = {
        labels: {
            singular: "Test Object",
            plural: "Test Objects"
        },
        description: "A temporary object for testing API capabilities",
        primaryDisplayProperty: `${testKey}.name`,
        key: testKey,
        locationId: locationId,
        objectType: "USER_DEFINED",
        searchableProperties: [
            `${testKey}.name`
        ],
        // Try adding properties during creation
        properties: [
            {
                label: "Name",
                key: `${testKey}.name`,
                dataType: "TEXT",
                position: 1
            }
        ]
    };

    let createdObject: any;
    try {
        createdObject = await ghlFetch('/objects/', accessToken!, {
            method: 'POST',
            body: JSON.stringify(createBody)
        });
        console.log('✅ Created Object Success:', JSON.stringify(createdObject, null, 2));
    } catch (e: any) {
        console.error('❌ Creation Failed:', e.status, JSON.stringify(e.data || e.message));
        // If it already exists, try to fetch it
        if (e.status === 409 || (e.data && e.data.message && e.data.message.includes('already exists'))) {
            console.log('Object might already exist. Fetching...');
            try {
                createdObject = await ghlFetch(`/objects/${testKey}?locationId=${locationId}`, accessToken!);
                console.log('✅ Fetched Existing Object.');
            } catch (fetchErr) {
                console.error('Failed to fetch existing object:', fetchErr);
                return;
            }
        } else {
            return;
        }
    }

    // 3. Try to Update (Add Property)
    console.log('\nTesting Update (Add Property) on Test Object...');

    // Construct new property
    const newProperty = {
        label: "Description",
        key: `${testKey}.description`,
        dataType: "LARGE_TEXT",
        position: 2
    };

    // Prepare update body based on CURRENT object state
    // The user suggested: "update the PUT call with similar schema but updated... keeping the call format"

    // NOTE: If the previous PUT failed with "property properties should not exist", 
    // it implies we CANNOT send 'properties' in the PUT body.
    // But let's try one more time with this fresh object.

    const updateBody = {
        labels: createdObject.labels,
        description: createdObject.description + " (Updated)",
        searchableProperties: [
            ...createdObject.searchableProperties,
            newProperty.key
        ],
        primaryDisplayProperty: createdObject.primaryDisplayProperty,
        locationId: locationId,
        // HYPOTHESIS: Maybe we include properties here?
        properties: [
            ...(createdObject.properties || []),
            newProperty
        ]
    };

    try {
        const res = await ghlFetch(`/objects/${testKey}`, accessToken!, {
            method: 'PUT',
            body: JSON.stringify(updateBody)
        });
        console.log('✅ Update Success:', JSON.stringify(res, null, 2));
    } catch (e: any) {
        console.error('❌ Update Failed:', e.status, JSON.stringify(e.data || e.message));

        // 4. Alternative: Try POST to /objects/:key/properties (if PUT failed)
        console.log('\nRetrying via POST /objects/:key/properties...');
        try {
            const res = await ghlFetch(`/objects/${testKey}/properties`, accessToken!, {
                method: 'POST',
                body: JSON.stringify(newProperty)
            });
            console.log('✅ POST Property Success:', JSON.stringify(res, null, 2));
        } catch (e2: any) {
            console.error('❌ POST Property Failed:', e2.status, JSON.stringify(e2.data || e2.message));
        }
    }
}

main()
    .catch(console.error)
    .finally(() => db.$disconnect());
