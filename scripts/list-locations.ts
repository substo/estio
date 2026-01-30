import db from '../lib/db';

async function main() {
    const locations = await db.location.findMany();
    console.log('Locations:', JSON.stringify(locations, null, 2));
}

main()
    .catch(console.error)
    .finally(() => db.$disconnect());
