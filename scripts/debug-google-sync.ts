
import db from '../lib/db';
import { syncContactToGoogle } from '../lib/google/people';

const CONTACT_ID = 'cml5ce95e00a1a4tkypx0xk06';

async function main() {
    console.log(`Checking contact ${CONTACT_ID}...`);
    const contact = await db.contact.findUnique({
        where: { id: CONTACT_ID },
        include: { location: true }
    });

    if (!contact) {
        console.error('Contact not found!');
        return;
    }

    console.log(`Contact: ${contact.name} (${contact.email})`);
    console.log(`Location: ${contact.locationId}`);
    console.log(`Google Contact ID: ${contact.googleContactId}`);
    console.log(`Last Sync: ${contact.lastGoogleSync}`);

    console.log('--- Checking Users in Location ---');
    const users = await db.user.findMany({
        where: {
            locations: { some: { id: contact.locationId } }
        },
        select: {
            id: true,
            name: true,
            email: true,
            googleSyncEnabled: true,
            googleRefreshToken: true
        }
    });

    let syncUser = null;

    for (const user of users) {
        const hasToken = !!user.googleRefreshToken;
        console.log(`User: ${user.name} (${user.email})`);
        console.log(`  - Sync Enabled: ${user.googleSyncEnabled}`);
        console.log(`  - Has Refresh Token: ${hasToken}`);

        if (user.googleSyncEnabled && hasToken) {
            syncUser = user;
            console.log('  -> CANDIDATE FOR SYNC');
        }
    }

    if (!syncUser) {
        console.error('NO VALID USER FOUND FOR SYNC! This is why sync is not working.');
    } else {
        console.log(`\nAttempting manual sync with user ${syncUser.name}...`);
        try {
            await syncContactToGoogle(syncUser.id, contact.id);
            console.log('Sync function completed without throwing.');
        } catch (e) {
            console.error('Sync function threw error:', e);
        }
    }
}

main()
    .catch(e => console.error(e))
    .finally(async () => {
        await db.$disconnect();
    });
