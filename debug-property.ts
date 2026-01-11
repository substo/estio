
import db from "./lib/db";

async function main() {
    const propertyId = 'cmiqeoafu0002ee5uhyxs7tty';
    console.log(`--- Checking Property ${propertyId} ---`);
    const property = await db.property.findUnique({
        where: { id: propertyId },
        include: {
            creator: true,
            updater: true
        }
    });
    console.log(property);

    if (property) {
        console.log('Creator:', property.creator);
        console.log('Updater:', property.updater);
    }
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await db.$disconnect();
    });
