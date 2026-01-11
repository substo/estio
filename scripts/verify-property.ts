
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const property = await prisma.property.findFirst({
        orderBy: { createdAt: 'desc' },
        include: { media: true }
    });
    console.log('Latest Property:', property);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
