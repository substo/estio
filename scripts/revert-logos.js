const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// REVERTED URLs (Correct Configuration)
const DARK_LOGO_URL = 'https://imagedelivery.net/CgOhaOjkCC4UB7N5l7b9sg/95814d38-2589-4c30-339c-2acfcccca500/public'; // Image 0 (Dark Text, for White Header)
const LIGHT_LOGO_URL = 'https://imagedelivery.net/CgOhaOjkCC4UB7N5l7b9sg/be55dd8e-3418-490a-f77a-482ced229300/public'; // Image 1 (White Text, for Dark/Transparent Header)

async function main() {
    const configs = await prisma.siteConfig.findMany();
    console.log(`Found ${configs.length} site configs. Reverting logos to correct state...`);

    for (const config of configs) {
        let theme = config.theme || {};
        if (!theme.logo) theme.logo = {};

        theme.logo.url = DARK_LOGO_URL;
        theme.logo.lightUrl = LIGHT_LOGO_URL;

        await prisma.siteConfig.update({
            where: { id: config.id },
            data: { theme: theme }
        });
    }
    console.log("Logos reverted to correct configuration.");
}

main()
    .catch(console.error)
    .finally(async () => await prisma.$disconnect());
