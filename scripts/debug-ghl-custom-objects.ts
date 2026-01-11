import { ghlFetch } from '../lib/ghl/client';
import { getLocationContext } from '../lib/auth/location-context';
import * as dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function listCustomObjects() {
    try {
        // We need a valid access token. 
        // Since this is a script, we might not have a request context.
        // We'll try to get it from the DB for a specific location if provided, 
        // or just ask the user to provide one if they are running this manually.

        // For simplicity in this environment, let's assume we can get a location context 
        // if we mock the headers or just fetch the first connected location from DB.

        const db = require('../lib/db').default;

        console.log('Fetching a GHL-connected location...');
        const location = await db.location.findFirst({
            where: {
                ghlAccessToken: { not: null }
            }
        });

        if (!location) {
            console.error('No GHL-connected location found in local DB.');
            process.exit(1);
        }

        console.log(`Using Location: ${location.name} (${location.id})`);

        // Fetch Custom Objects Schemas
        // Endpoint: /objects/schemas
        const schemas = await ghlFetch<any>(
            '/objects/schemas',
            location.ghlAccessToken
        );

        console.log('\n--- GHL Custom Object Schemas ---');
        if (schemas && schemas.schemas) {
            schemas.schemas.forEach((schema: any) => {
                console.log(`Name: ${schema.name}`);
                console.log(`Key: ${schema.key}`); // This is what we need!
                console.log(`ID: ${schema.id}`);
                console.log('-----------------------------------');
            });
        } else {
            console.log('No schemas found or unexpected response structure:', schemas);
        }

    } catch (error: any) {
        console.error('Error fetching custom objects:', error.message);
        if (error.response) {
            console.error('Response status:', error.response.status);
            console.error('Response data:', error.response.data);
        }
    }
}

listCustomObjects();
