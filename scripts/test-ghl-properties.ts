import { listProperties, createProperty, getPropertyById, getPropertyByReference, updateProperty } from '../lib/properties/repository';
import { getGHLUser } from '../lib/ghl/client';
import { GHLProperty } from '../lib/ghl/types';

async function main() {
    const accessToken = process.env.GHL_ACCESS_TOKEN;
    if (!accessToken) {
        console.error('Please set GHL_ACCESS_TOKEN environment variable');
        process.exit(1);
    }

    console.log('Testing GHL Properties Module...');

    try {
        // 1. Test Auth / User Fetch
        console.log('\n1. Fetching User...');
        const user = await getGHLUser('me', accessToken);
        console.log('User:', user ? user.name : 'Failed to fetch user');

        // 2. Create Property
        const propertyRef = `REF-${Date.now()}`;
        const propertyData: Partial<GHLProperty['properties']> = {
            title: `Test Property ${Date.now()}`,
            property_reference: propertyRef,
            status: 'Active',
            goal: 'For Sale',
            location: 'Paphos',
            location_area: 'Universal',
            type_category: 'house',
            type_subtype: 'detached_villa',
            price: 350000,
            currency: 'EUR',
            bedrooms: 3,
            bathrooms: 2,
            internal_size_sqm: 150,
        };

        console.log(`\n2. Creating Property with ref ${propertyRef}...`);
        const created = await createProperty(accessToken, propertyData);
        console.log('Created Property ID:', created.id);

        // 3. Get by ID
        console.log('\n3. Getting Property by ID...');
        const fetchedById = await getPropertyById(accessToken, created.id);
        if (fetchedById) {
            console.log('Fetched:', fetchedById.properties.title);
        } else {
            console.error('Failed to fetch property by ID');
        }

        // 4. Get by Reference
        console.log('\n4. Getting Property by Reference...');
        const fetchedByRef = await getPropertyByReference(accessToken, propertyRef);
        console.log('Fetched by Ref:', fetchedByRef ? 'Found' : 'Not Found');

        // 5. Update Property
        console.log('\n5. Updating Property...');
        const updated = await updateProperty(accessToken, created.id, {
            price: 120000
        });
        console.log('Updated Price:', updated.properties.price);

        // 6. List Properties
        console.log('\n6. Listing Properties...');
        const list = await listProperties(accessToken, { limit: 5 });
        console.log(`Found ${list.customObjects?.length || 0} properties`);

    } catch (error) {
        console.error('Test failed:', error);
    }
}

main();
