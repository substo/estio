import { ghlFetchWithAuth } from '../lib/ghl/token';
import db from '../lib/db';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function main() {
    const locationId = process.argv[2] || 'ys9qMNTlv0jA6QPxXpbP';
    console.log(`Syncing Projects for Location ID: ${locationId}`);

    const location = await db.location.findFirst({
        where: { ghlLocationId: locationId }
    });

    if (!location) {
        console.error('Location not found in database.');
        return;
    }

    const objectKey = 'custom_objects.project';

    try {
        // 1. Get Object ID (Legacy ID preferred for records?)
        console.log(`Fetching Object Metadata for ${objectKey}...`);
        const metaRes = await ghlFetchWithAuth<any>(locationId, `/objects/${objectKey}?locationId=${locationId}`);

        let objectId = metaRes.object ? metaRes.object.id : metaRes.id;

        // Try to get Legacy ID from fields if available
        if (metaRes.fields && metaRes.fields.length > 0) {
            const legacyId = metaRes.fields[0].parentId;
            console.log(`Found Legacy ID from fields: ${legacyId}`);
            objectId = legacyId;
        } else {
            console.log(`Using Object ID (Fallback): ${objectId}`);
        }

        if (!objectId) {
            console.error('Failed to get Object ID from metadata.');
            return;
        }
        console.log(`Object ID: ${objectId}`);

        /*
        // 2. Try to CREATE a record to verify endpoint
        console.log('Attempting to CREATE a dummy record...');
        const dummyData = {
            locationId: locationId,
            properties: {
                "name": "Test Project 1"
            }
        };

        try {
            const createRes = await ghlFetchWithAuth<any>(locationId, `/objects/${objectKey}/records`, {
                method: 'POST',
                body: JSON.stringify(dummyData)
            });
            console.log('✅ Created Dummy Record:', JSON.stringify(createRes, null, 2));
        } catch (createErr: any) {
            console.error('❌ Creation Failed:', createErr.message);
        }
        */

        // 2. Fetch all records using Search Endpoint
        console.log(`Fetching records via Search: /objects/${objectKey}/records/search`);

        const response = await ghlFetchWithAuth<any>(locationId, `/objects/${objectKey}/records/search`, {
            method: 'POST',
            body: JSON.stringify({
                locationId: locationId,
                page: 1,
                pageLimit: 100
            })
        });
        const records = response.records || [];
        console.log(`Found ${records.length} projects in GHL.`);

        for (const record of records) {
            const props = record.properties || {};

            // Map GHL fields to Prisma fields
            // Note: Keys might be short names based on creation response
            const projectData = {
                ghlProjectId: record.id,
                locationId: location.id,
                name: props[`name`] || props[`${objectKey}.name`] || 'Untitled Project',
                description: props[`description`] || props[`${objectKey}.description`],
                developer: props[`developer`] || props[`${objectKey}.developer`],
                completionDate: (props[`completion_date`] || props[`${objectKey}.completion_date`]) ? new Date(props[`completion_date`] || props[`${objectKey}.completion_date`]) : null,
                totalUnits: (props[`total_units`] || props[`${objectKey}.total_units`]) ? parseInt(props[`total_units`] || props[`${objectKey}.total_units`]) : null,
                features: props[`features`] || props[`${objectKey}.features`] || [],
                projectLocation: props[`location`] || props[`${objectKey}.location`],
                website: props[`website`] || props[`${objectKey}.website`],
                brochure: (props[`brochure`] || props[`${objectKey}.brochure`]) ? (typeof (props[`brochure`] || props[`${objectKey}.brochure`]) === 'string' ? (props[`brochure`] || props[`${objectKey}.brochure`]) : (props[`brochure`] || props[`${objectKey}.brochure`])[0]) : null,
            };

            console.log(`Syncing Project: ${projectData.name} (${projectData.ghlProjectId})`);

            // @ts-ignore
            await db.project.upsert({
                where: { ghlProjectId: record.id },
                update: projectData,
                create: projectData
            });
        }

        console.log('✅ Project Sync Completed.');

    } catch (e: any) {
        console.error('❌ Sync Failed:', e.message);
    }
}

main()
    .catch(console.error)
    .finally(() => db.$disconnect());
