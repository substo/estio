import db from '../lib/db';

async function main() {
    console.log("Checking for saved lead schema...");
    const users = await db.user.findMany({
        select: { id: true, crmLeadSchema: true }
    });

    const user = users.find(u => u.crmLeadSchema !== null);

    if (user) {
        console.log("Found user with saved lead schema:", user.id);
        console.log(JSON.stringify(user.crmLeadSchema, null, 2));
    } else {
        console.log("No user found with saved lead schema.");
    }
}

main()
    .catch(console.error)
    .finally(() => db.$disconnect());
