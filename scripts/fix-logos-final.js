const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// User Specified Mapping
// DARK_MODE_LOGO_URL = White Text (for Dark Mode / Transparent Header)
const DARK_MODE_LOGO_URL = 'https://imagedelivery.net/CgOhaOjkCC4UB7N5l7b9sg/ffbb3f4d-bd33-4c16-5ac9-35196406c000/public';

// LIGHT_MODE_LOGO_URL = Dark Text (for Light Mode / Scrolled Header)
const LIGHT_MODE_LOGO_URL = 'https://imagedelivery.net/CgOhaOjkCC4UB7N5l7b9sg/2e45c3ca-107b-43d9-c379-c81b57c14900/public';

async function main() {
    const configs = await prisma.siteConfig.findMany();
    console.log(`Found ${configs.length} site configs. Applying User Specified Logos...`);

    for (const config of configs) {
        let theme = config.theme || {};
        if (!theme.logo) theme.logo = {};

        // Assign to schema fields
        theme.logo.url = LIGHT_MODE_LOGO_URL;       // Main URL = Light Mode Logo (Dark Text)
        theme.logo.lightUrl = DARK_MODE_LOGO_URL;   // Light URL = Dark Mode Logo (White Text)

        console.log(`Updating config for ${config.domain}...`);
        await prisma.siteConfig.update({
            where: { id: config.id },
            data: { theme: theme }
        });
    }
    console.log("Logos updated successfully.");
}

main()
    .catch(console.error)
    .finally(async () => await prisma.$disconnect());
