
import db from "./lib/db";

async function main() {
    const userId = 'cmingx6lt0009rdycpxeor80j';
    console.log(`--- Checking User ${userId} ---`);
    const user = await db.user.findUnique({
        where: { id: userId }
    });
    console.log(user);
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await db.$disconnect();
    });
