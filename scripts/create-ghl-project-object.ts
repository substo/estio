import { ghlFetchWithAuth } from '../lib/ghl/token';
import db from '../lib/db';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function main() {
    // 1. Get Location
    // Default to the known ID if not provided
    const locationId = process.argv[2] || 'ys9qMNTlv0jA6QPxXpbP';
    console.log(`Looking for location with GHL ID: ${locationId}`);

    const location = await db.location.findFirst({
        where: { ghlLocationId: locationId }
    });

    if (!location) {
        console.error('Location not found in database.');
        return;
    }

    console.log(`Found Location: ${location.name} (ID: ${location.id})`);

    // 2. Define Object and Fields
    const objectKey = 'custom_objects.project';
    const objectLabel = 'Project';
    const objectPluralLabel = 'Projects';

    const fields = [
        {
            label: "Name",
            key: `${objectKey}.name`,
            dataType: "TEXT",
            position: 1
        },
        {
            label: "Description",
            key: `${objectKey}.description`,
            dataType: "LARGE_TEXT",
            position: 2
        },
        {
            label: "Developer",
            key: `${objectKey}.developer`,
            dataType: "TEXT",
            position: 3
        },
        {
            label: "Completion Date",
            key: `${objectKey}.completion_date`,
            dataType: "DATE",
            position: 4
        },
        {
            label: "Total Units",
            key: `${objectKey}.total_units`,
            dataType: "NUMERICAL",
            position: 5
        },
        {
            label: "Features",
            key: `${objectKey}.features`,
            dataType: "MULTIPLE_OPTIONS",
            position: 6,
            options: [
                { label: "Gym", key: "gym" },
                { label: "Swimming Pool", key: "swimming_pool" },
                { label: "Covered Parking", key: "covered_parking" },
                { label: "Uncovered Parking", key: "uncovered_parking" },
                { label: "Designated Parking", key: "designated_parking" },
                { label: "Security", key: "security" },
                { label: "Gated", key: "gated" },
                { label: "Garden", key: "garden" },
                { label: "Elevator", key: "elevator" },
                { label: "Storage", key: "storage" }
            ]
        },
        {
            label: "Location",
            key: `${objectKey}.location`,
            dataType: "TEXT",
            position: 7
        },
        {
            label: "Website",
            key: `${objectKey}.website`,
            dataType: "TEXT",
            position: 8
        },
        {
            label: "Brochure",
            key: `${objectKey}.brochure`,
            dataType: "FILE_UPLOAD",
            position: 9,
            maxFileLimit: 5
        }
    ];

    // 3. Create or Fetch Object
    console.log(`\nChecking for Custom Object: ${objectKey}...`);
    let objectId: string | null = null;
    let existingObject: any = null;

    try {
        const res = await ghlFetchWithAuth<any>(locationId, `/objects/${objectKey}?locationId=${locationId}`);
        console.log('✅ Object already exists:', JSON.stringify(res, null, 2));
        existingObject = res;
        // CRITICAL FIX: The object.id might be a Mongo ID, but fields need the legacy ID.
        // We can grab it from the default 'Name' field which is always created.
        if (res.fields && res.fields.length > 0) {
            objectId = res.fields[0].parentId;
            console.log(`Found Parent ID from fields: ${objectId}`);
        } else {
            // Fallback (might fail if no fields)
            objectId = res.object ? res.object.id : res.id;
            console.log(`Using Object ID as Parent ID (Fallback): ${objectId}`);
        }
    } catch (e: any) {
        // Check if error message indicates 404
        if (e.message.includes('404')) {
            console.log('Object not found. Creating...');
            const createBody = {
                labels: {
                    singular: objectLabel,
                    plural: objectPluralLabel
                },
                description: "Real estate development projects.",
                key: objectKey,
                locationId: locationId,
                // objectType: "USER_DEFINED", // Removed based on error
                // primaryDisplayProperty: `${objectKey}.name`, // Removed based on error
                primaryDisplayPropertyDetails: {
                    name: "Name",
                    key: `${objectKey}.name`,
                    dataType: "TEXT"
                }
            };

            try {
                const created = await ghlFetchWithAuth<any>(locationId, '/objects/', {
                    method: 'POST',
                    body: JSON.stringify(createBody)
                });
                console.log('✅ Created Object Success:', JSON.stringify(created, null, 2));
                objectId = created.object ? created.object.id : created.id;
                existingObject = created;
            } catch (createError: any) {
                console.error('❌ Creation Failed:', createError.message);
                return;
            }
        } else {
            console.error('❌ Error checking object:', e.message);
            return;
        }
    }

    if (!objectId) {
        console.error('Failed to get Object ID.');
        return;
    }

    console.log(`Object ID: ${objectId}`);

    // 4. Sync Fields
    console.log('\nSyncing Fields...');

    const existingFieldsMap = new Map();
    if (existingObject.properties) {
        existingObject.properties.forEach((p: any) => {
            existingFieldsMap.set(p.key, p);
        });
    }

    for (const field of fields) {
        console.log(`Processing field: ${field.label} (${field.key})...`);

        if (existingFieldsMap.has(field.key)) {
            console.log(`   - Field exists. Skipping.`);
            continue;
        }

        // Create Field
        const createFieldBody = {
            parentId: objectId,
            objectKey: objectKey,
            locationId: locationId,
            fieldKey: field.key,
            dataType: field.dataType,
            name: field.label,
            position: field.position,
            options: field.options, // Only for option types
            maxFileLimit: (field as any).maxFileLimit // Only for FILE_UPLOAD
        };

        try {
            await ghlFetchWithAuth(locationId, '/custom-fields/', {
                method: 'POST',
                body: JSON.stringify(createFieldBody)
            });
            console.log(`   ✅ Created field: ${field.label}`);
        } catch (e: any) {
            console.error(`   ❌ Failed to create field ${field.label}:`, e.message);
        }
    }

    console.log('\n✅ Script execution completed.');
}

main()
    .catch(console.error)
    .finally(() => db.$disconnect());
