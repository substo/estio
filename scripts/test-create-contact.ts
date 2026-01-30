import db from '../lib/db';

async function main() {
    console.log('Testing Contact creation...');

    try {
        // 1. Create a test contact
        const contact = await db.contact.create({
            data: {
                locationId: 'test-location-id', // Using a dummy ID, might fail if foreign key constraints exist. 
                // Better to fetch an existing location first.
                name: 'Test Contact',
                email: 'test@example.com',
                phone: '1234567890',
                status: 'new',
            },
        });

        console.log('Successfully created contact:', contact);

        // 2. Verify we can fetch it back
        const fetchedContact = await db.contact.findUnique({
            where: { id: contact.id },
        });

        if (fetchedContact) {
            console.log('Successfully fetched contact:', fetchedContact);
        } else {
            console.error('Failed to fetch contact!');
        }

        // 3. Clean up
        await db.contact.delete({
            where: { id: contact.id },
        });
        console.log('Successfully deleted test contact.');

    } catch (error) {
        console.error('Error testing contact creation:', error);
    } finally {
        await db.$disconnect();
    }
}

// We need a valid location ID for the foreign key constraint.
// Let's try to fetch one first.
async function run() {
    try {
        const location = await db.location.findFirst();
        if (!location) {
            console.error("No location found to link contact to.");
            return;
        }

        console.log(`Using location: ${location.id}`);

        const contact = await db.contact.create({
            data: {
                locationId: location.id,
                name: 'Test Contact Refactor',
                email: 'test-refactor@example.com',
                phone: '555-0199',
                status: 'new',
            }
        });

        console.log('✅ Created Contact:', contact.id);

        const retrieved = await db.contact.findUnique({
            where: { id: contact.id }
        });

        if (retrieved && retrieved.name === 'Test Contact Refactor') {
            console.log('✅ Verified Contact Retrieval');
        } else {
            console.error('❌ Failed to retrieve contact');
        }

        await db.contact.delete({
            where: { id: contact.id }
        });
        console.log('✅ Cleaned up test contact');

    } catch (e) {
        console.error("Test failed:", e);
    } finally {
        await db.$disconnect();
    }
}

run();
