import { ghlFetch } from '../lib/ghl/client';
import { getLocationById, refreshGhlAccessToken } from '../lib/location';
import db from '../lib/db';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

// --- Configuration ---
const COMMON_KEYS = [
    'custom_objects.properties', // Correct key found via debug
    'custom_object.properties',
    'property',
    'properties',
    'custom_object.property',
    'real_estate.property',
    'listing',
    'listings'
];

// GHL Field Types
type GHLFieldType = 'TEXT' | 'LARGE_TEXT' | 'NUMERICAL' | 'MONETORY' | 'DATE' | 'FILE_UPLOAD' | 'SINGLE_OPTIONS' | 'MULTIPLE_OPTIONS' | 'CHECKBOX';

interface GHLFieldDefinition {
    key: string;
    name: string;
    dataType: GHLFieldType;
    options?: string[];
}

// Desired Schema (Source of Truth)
const DESIRED_SCHEMA: GHLFieldDefinition[] = [
    { key: 'property_reference', name: 'Property Reference', dataType: 'TEXT' },
    { key: 'title', name: 'Title', dataType: 'TEXT' },
    { key: 'status', name: 'Status', dataType: 'SINGLE_OPTIONS', options: ['Active', 'Reserved', 'Sold', 'Rented', 'Withdrawn'] },
    { key: 'goal', name: 'Goal', dataType: 'SINGLE_OPTIONS', options: ['For Sale', 'For Rent'] },
    { key: 'publication_status', name: 'Publication Status', dataType: 'SINGLE_OPTIONS', options: ['Published', 'Pending', 'Draft', 'Unlisted'] },
    { key: 'location', name: 'Location', dataType: 'SINGLE_OPTIONS', options: ['Paphos', 'Limassol', 'Larnaca', 'Nicosia', 'Famagusta'] },
    { key: 'location_area', name: 'Location Area', dataType: 'TEXT' },
    { key: 'address_line', name: 'Address Line', dataType: 'TEXT' },
    { key: 'type_category', name: 'Type Category', dataType: 'SINGLE_OPTIONS', options: ['house', 'apartment', 'commercial', 'land'] },
    { key: 'type_subtype', name: 'Type Subtype', dataType: 'TEXT' },
    { key: 'bedrooms', name: 'Bedrooms', dataType: 'NUMERICAL' },
    { key: 'bathrooms', name: 'Bathrooms', dataType: 'NUMERICAL' },
    { key: 'internal_size_sqm', name: 'Internal Size (sqm)', dataType: 'NUMERICAL' },
    { key: 'plot_size_sqm', name: 'Plot Size (sqm)', dataType: 'NUMERICAL' },
    { key: 'build_year', name: 'Build Year', dataType: 'NUMERICAL' },
    { key: 'floor', name: 'Floor', dataType: 'NUMERICAL' },
    { key: 'owner_name', name: 'Owner Name', dataType: 'TEXT' },
    { key: 'price', name: 'Price', dataType: 'MONETORY' },
    { key: 'currency', name: 'Currency', dataType: 'SINGLE_OPTIONS', options: ['EUR', 'GBP', 'USD'] },
    { key: 'condition', name: 'Condition', dataType: 'SINGLE_OPTIONS', options: ['New', 'Resale', 'Off-plan', 'Under Construction'] },
    { key: 'source', name: 'Source', dataType: 'TEXT' },
    { key: 'features', name: 'Features', dataType: 'MULTIPLE_OPTIONS', options: ['Air Conditioning', 'Pool', 'Garden', 'Parking', 'Sea View', 'Mountain View'] },
    { key: 'headline_features', name: 'Headline Features', dataType: 'LARGE_TEXT' },
    { key: 'internal_notes', name: 'Internal Notes', dataType: 'LARGE_TEXT' },
    { key: 'is_featured', name: 'Is Featured', dataType: 'CHECKBOX' },
];

async function findCustomObject(accessToken: string, locationId: string, providedKey?: string): Promise<any | null> {
    // Helper to try V1
    const tryV1 = async (key: string) => {
        // ... (V1 logic kept as fallback, though likely unused)
        return null;
    };

    if (providedKey) {
        console.log(`Checking provided key: ${providedKey}...`);
        // Try V2 (Direct Object Endpoint)
        try {
            // NOTE: For some custom objects, the endpoint is /objects/{key} NOT /objects/schemas/{key}
            const res = await ghlFetch<any>(`/objects/${providedKey}?locationId=${locationId}`, accessToken);
            console.log(`✅ Found Custom Object (V2): ${res.title || res.name} (${res.key})`);
            return res;
        } catch (e: any) {
            // Try standard schema endpoint as fallback
            try {
                const res = await ghlFetch<any>(`/objects/schemas/${providedKey}?locationId=${locationId}`, accessToken);
                console.log(`✅ Found Custom Object (V2 Schema): ${res.title} (${res.key})`);
                return res;
            } catch (e2) {
                console.warn(`   ❌ V2 failed for '${providedKey}'.`);
            }
        }
    }

    console.log('🔍 Attempting to discover Custom Object...');

    // 1. Try to list all (if API allows)
    // ... (List logic)

    // 2. Guess keys (V2 then V1)
    for (const key of COMMON_KEYS) {
        process.stdout.write(`Checking key: ${key}... `);
        try {
            // Try direct object endpoint first
            const res = await ghlFetch<any>(`/objects/${key}?locationId=${locationId}`, accessToken);
            console.log(`✅ FOUND (V2)!`);
            return res;
        } catch (e) {
            // Try schema endpoint
            try {
                const res = await ghlFetch<any>(`/objects/schemas/${key}?locationId=${locationId}`, accessToken);
                console.log(`✅ FOUND (V2 Schema)!`);
                return res;
            } catch (e2) {
                console.log(`❌`);
            }
        }
    }

    return null;
}

async function syncLocation(location: any, providedKey?: string) {
    console.log(`\n==================================================`);
    console.log(`Processing Location: ${location.name} (${location.id})`);
    console.log(`GHL Location ID: ${location.ghlLocationId}`);
    console.log(`==================================================`);

    if (!location.ghlAccessToken || !location.ghlLocationId) {
        console.warn(`Skipping: Missing Access Token or GHL Location ID`);
        return;
    }

    let accessToken = location.ghlAccessToken;
    try {
        const refreshed = await refreshGhlAccessToken(location);
        accessToken = refreshed.ghlAccessToken!;
    } catch (e) {
        console.error(`Failed to refresh token:`, e);
        return;
    }

    try {
        // 1. Discovery
        let customObject = await findCustomObject(accessToken, location.ghlLocationId, providedKey);
        let objectKey = customObject?.key;

        if (!customObject) {
            console.log(`⚠️ Custom Object not found.`);
            // Create logic
            console.log('Creating Custom Object "Property"...');
            const createPayload = {
                title: 'Property',
                key: 'custom_object.property', // Default key
                description: 'Real Estate Property from Estio App',
                primaryDisplayProperty: 'title',
                locationId: location.ghlLocationId
            };

            try {
                const res = await ghlFetch<any>('/objects/schemas', accessToken, {
                    method: 'POST',
                    body: JSON.stringify(createPayload)
                });
                console.log('✅ Custom Object created.');
                customObject = res;
                objectKey = res.key;
            } catch (createError: any) {
                console.error('❌ Failed to create Custom Object:', JSON.stringify(createError, null, 2));
                return;
            }
        }

        // 2. Comparison & Update
        // Extract Object ID and Key correctly
        // Based on logs, the response keys are ['object', 'fields', ...].
        // So customObject is the wrapper.
        const existingProperties = customObject.fields || customObject.properties || [];
        let objectId = customObject.object?.id || customObject.customObject?.id || customObject.id;

        // Prefer parentId from existing fields if available (most reliable)
        if (existingProperties.length > 0 && existingProperties[0].parentId) {
            objectId = existingProperties[0].parentId;
            console.log(`   Using parentId from existing field: ${objectId}`);
        }

        objectKey = customObject.object?.key || customObject.customObject?.key || customObject.key;

        console.log(`\n🔍 Analyzing Schema for '${objectKey}' (ID: ${objectId})...`);
        console.log(`   Custom Object Keys: ${Object.keys(customObject)}`);
        console.log(`   Existing Properties Count: ${existingProperties.length}`);
        if (existingProperties.length > 0) {
            console.log(`   Sample Property: ${JSON.stringify(existingProperties[0])}`);
        }

        for (const desiredField of DESIRED_SCHEMA) {
            // Check if field exists by key (handle fully qualified keys)
            const existingField = existingProperties.find((p: any) =>
                p.key === desiredField.key ||
                p.fieldKey === desiredField.key ||
                p.fieldKey === `${objectKey}.${desiredField.key}` ||
                (p.fieldKey && p.fieldKey.endsWith(`.${desiredField.key}`))
            );

            if (!existingField) {
                console.log(`➕ Field '${desiredField.name}' (${desiredField.key}) is MISSING. Adding...`);

                // Fix for Checkbox/Options: requires 'key' and 'label', not 'value'
                let fieldOptions = desiredField.options ? desiredField.options.map(opt => ({ label: opt, key: opt.toLowerCase().replace(/\s+/g, '_') })) : undefined;
                if (desiredField.dataType === 'CHECKBOX' && !fieldOptions) {
                    fieldOptions = [
                        { label: 'Yes', key: 'yes' },
                        { label: 'No', key: 'no' }
                    ];
                }

                const payload = {
                    name: desiredField.name,
                    dataType: desiredField.dataType,
                    objectKey: objectKey,
                    locationId: location.ghlLocationId,
                    fieldKey: desiredField.key,
                    parentId: objectId,
                    options: fieldOptions
                };
                // console.log('   Payload:', JSON.stringify(payload));

                try {
                    // Endpoint: POST /custom-fields/
                    await ghlFetch(`/custom-fields/`, accessToken, {
                        method: 'POST',
                        body: JSON.stringify(payload)
                    });
                    console.log(`   ✅ Added.`);
                } catch (e: any) {
                    console.error(`   ❌ Failed to add: ${e.message} - ${JSON.stringify(e.data)}`);
                }
            } else {
                // Field exists, check for updates (e.g. Options)
                if (desiredField.options && existingField.options) {
                    // Compare Labels AND Keys to avoid duplicates
                    const existingOptionLabels = existingField.options.map((o: any) => o.label);
                    const existingOptionKeys = existingField.options.map((o: any) => o.key);

                    const missingOptions = desiredField.options.filter(opt => {
                        const generatedKey = opt.toLowerCase().replace(/\s+/g, '_');
                        return !existingOptionLabels.includes(opt) && !existingOptionKeys.includes(generatedKey);
                    });

                    if (missingOptions.length > 0) {
                        console.log(`   ⚠️ Field '${desiredField.name}' has missing options: ${missingOptions.join(', ')}. Updating...`);
                        try {
                            // Endpoint: PUT /custom-fields/{id}
                            await ghlFetch(`/custom-fields/${existingField.id}`, accessToken, {
                                method: 'PUT',
                                body: JSON.stringify({
                                    name: desiredField.name, // Keep name
                                    locationId: location.ghlLocationId,
                                    options: [
                                        ...existingField.options,
                                        ...missingOptions.map(opt => ({
                                            label: opt,
                                            key: opt.toLowerCase().replace(/\s+/g, '_')
                                        }))
                                    ]
                                })
                            });
                            console.log(`   ✅ Updated options.`);
                        } catch (e: any) {
                            console.error(`   ❌ Failed to update options: ${e.message} - ${JSON.stringify(e.data)}`);
                        }
                    }
                }
            }
        }
        console.log(`\n✅ Schema Sync Complete for ${location.name}`);

    } catch (error) {
        console.error(`Error processing location ${location.name}:`, error);
    }
}

// Defaults (from successful debug sessions)
const DEFAULT_LOCATION_ID = 'ys9qMNTlv0jA6QPxXpbP'; // 
const DEFAULT_OBJECT_KEY = 'custom_object.properties'; // Standard GHL Custom Object Key format

async function main() {
    let locationId = process.argv[2];
    let objectKey = process.argv[3];

    if (!locationId) {
        console.log(`No arguments provided. Using defaults:`);
        console.log(`Location ID: ${DEFAULT_LOCATION_ID}`);
        console.log(`Object Key: ${DEFAULT_OBJECT_KEY}`);
        console.log(`\nTo specify custom values: npx tsx scripts/sync-ghl-schema.ts <LOCATION_ID> [OBJECT_KEY]`);

        locationId = DEFAULT_LOCATION_ID;
        objectKey = DEFAULT_OBJECT_KEY;
    }

    if (locationId === '--all') {
        console.log('Syncing ALL locations with GHL connection...');
        const locations = await db.location.findMany({
            where: {
                ghlAccessToken: { not: null }
            }
        });

        console.log(`Found ${locations.length} locations.`);
        for (const loc of locations) {
            await syncLocation(loc, objectKey);
        }
    } else {
        // Try to find by Internal ID first
        let location = await getLocationById(locationId);

        // If not found, try by GHL Location ID
        if (!location) {
            console.log(`Location not found by ID '${locationId}'. Trying GHL Location ID...`);
            location = await db.location.findFirst({
                where: { ghlLocationId: locationId }
            });
        }

        if (!location) {
            console.error(`Location '${locationId}' not found (checked both Internal ID and GHL Location ID).`);
            process.exit(1);
        }
        await syncLocation(location, objectKey);
    }
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await db.$disconnect();
    });
