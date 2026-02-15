import db from '../lib/db';

async function main() {
    console.log('Checking for recent GHL token updates...');

    const locations = await db.location.findMany({
        where: {
            ghlAccessToken: { not: null }
        },
        orderBy: { updatedAt: 'desc' },
        take: 5
    });

    if (locations.length === 0) {
        console.log('No locations with tokens found.');
        return;
    }

    console.log(`Found ${locations.length} locations. Most recent updates:`);
    locations.forEach(loc => {
        console.log(`- [${loc.name}] (ID: ${loc.ghlLocationId})`);
        console.log(`  Updated: ${loc.updatedAt.toISOString()}`);
        console.log(`  Token Preview: ${loc.ghlAccessToken?.substring(0, 10)}...`);
        console.log('---');
    });
}

main()
    .catch(console.error)
    .finally(() => db.$disconnect());
