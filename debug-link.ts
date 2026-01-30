import db from './lib/db';

async function main() {
    console.log('--- Debugging Location & User ---');

    // Fetch all locations
    const locations = await db.location.findMany({
        include: {
            siteConfig: true
        }
    });

    console.log(`Found ${locations.length} locations.`);

    for (const loc of locations) {
        console.log(`Location ID: ${loc.id}`);
        console.log(`Name: ${loc.name}`);
        console.log(`Domain (Location): ${loc.domain}`);
        console.log(`Domain (SiteConfig): ${loc.siteConfig?.domain}`);
        console.log('--------------------------------');
    }
}

main()
    .catch(e => console.error(e))
    .finally(async () => {
        await db.$disconnect();
    });
