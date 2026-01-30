
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const locations = await prisma.location.findMany();
    console.log('Locations found:', locations);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
