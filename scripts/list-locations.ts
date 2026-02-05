import db from '../lib/db';

async function main() {
    const locations = await db.location.findMany({
        select: { id: true, name: true, ghlLocationId: true }
    });
    console.log('Locations:', JSON.stringify(locations, null, 2));
}

main()
    .catch(console.error)
    .finally(() => db.$disconnect());
