import db from '../lib/db';

async function main() {
    console.log("Checking for saved lead schema...");
    // crmLeadSchema is on Location, not User
    const locations = await db.location.findMany({
        select: { id: true, name: true, crmLeadSchema: true }
    });

    const location = locations.find(l => l.crmLeadSchema !== null);

    if (location) {
        console.log("Found location with saved lead schema:", location.name, `(${location.id})`);
        console.log(JSON.stringify(location.crmLeadSchema, null, 2));
    } else {
        console.log("No location found with saved lead schema.");
    }
}

main()
    .catch(console.error)
    .finally(() => db.$disconnect());
