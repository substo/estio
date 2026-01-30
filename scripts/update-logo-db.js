const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const DARK_LOGO_URL = 'https://imagedelivery.net/CgOhaOjkCC4UB7N5l7b9sg/95814d38-2589-4c30-339c-2acfcccca500/public'; // Image 0 (For White Header)
const LIGHT_LOGO_URL = 'https://imagedelivery.net/CgOhaOjkCC4UB7N5l7b9sg/be55dd8e-3418-490a-f77a-482ced229300/public'; // Image 1 (For Transparent/Dark Header)

async function main() {
    const configs = await prisma.siteConfig.findMany();
    console.log(`Found ${configs.length} site configs.`);

    for (const config of configs) {
        let theme = config.theme || {};

        // Ensure logo object exists
        if (!theme.logo) theme.logo = {};

        // Update URLs
        theme.logo.url = DARK_LOGO_URL;
        theme.logo.lightUrl = LIGHT_LOGO_URL;

        console.log(`Updating Location ${config.locationId}...`);
        await prisma.siteConfig.update({
            where: { id: config.id },
            data: { theme: theme }
        });
    }
    console.log("Done.");
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
