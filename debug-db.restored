
import db from "./lib/db";

async function main() {
    console.log("--- Users ---");
    const users = await db.user.findMany();
    console.log(users);

    console.log("\n--- Recent Properties ---");
    const properties = await db.property.findMany({
        take: 5,
        orderBy: { updatedAt: 'desc' },
        select: {
            id: true,
            title: true,
            createdById: true,
            updatedById: true,
            createdAt: true,
            updatedAt: true
        }
    });
    console.log(properties);
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await db.$disconnect();
    });
