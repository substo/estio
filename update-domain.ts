import db from './lib/db';

async function main() {
    console.log('--- Updating Location Domains ---');

    const locations = await db.location.findMany({
        include: { siteConfig: true }
    });

    for (const loc of locations) {
        let domainToSet = loc.domain;

        // Strategy: Use SiteConfig domain if available, else default for dev
        if (!domainToSet && loc.siteConfig?.domain) {
            domainToSet = loc.siteConfig.domain;
        }

        // Hardcode for the test location if needed
        if (loc.id === 'cmingx6b10008rdycg7hwesyn') { // The one with siteConfig
            // Ensure port is included if needed? The public link logic prepends http://
            // If domain is 'test.localhost', link becomes 'http://test.localhost/...'
            // Localhost usually needs port 3000.
            if (!domainToSet?.includes(':3000')) {
                domainToSet = (domainToSet || 'test.localhost') + ':3000';
            }
        }

        if (domainToSet && domainToSet !== loc.domain) {
            console.log(`Updating Location ${loc.id} domain to: ${domainToSet}`);
            await db.location.update({
                where: { id: loc.id },
                data: { domain: domainToSet }
            });
        }
    }
}

main()
    .catch(e => console.error(e))
    .finally(async () => {
        await db.$disconnect();
    });
