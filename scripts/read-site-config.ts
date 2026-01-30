import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    const configs = await prisma.siteConfig.findMany();
    console.log(`Found ${configs.length} site configs.`);

    for (const config of configs) {
        console.log(`\nDomain: ${config.domain}`);
        const theme = config.theme as any;
        console.log('Full Theme Object:', JSON.stringify(theme, null, 2));
    }
}

main()
    .catch(console.error)
    .finally(async () => await prisma.$disconnect());
