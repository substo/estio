const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const configs = await prisma.siteConfig.findMany({
        select: {
            id: true,
            domain: true,
            socialLinks: true,
            location: {
                select: {
                    name: true
                }
            }
        }
    });
    console.log(JSON.stringify(configs, null, 2));
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
