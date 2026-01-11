import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const locationId = 'ys9qMNTlv0jA6QPxXpbP';
    console.log(`Checking database for Location: ${locationId}...`);

    try {
        const loc = await prisma.location.findFirst({
            where: { ghlLocationId: locationId },
            select: { id: true, ghlAccessToken: true, ghlRefreshToken: true }
        });

        if (!loc) {
            console.log('RESULT: Location NOT FOUND in database.');
        } else {
            console.log(`RESULT: Location Found (Internal ID: ${loc.id})`);
            console.log(`Access Token: ${loc.ghlAccessToken ? 'PRESENT' : 'NULL'} ${loc.ghlAccessToken ? '(' + loc.ghlAccessToken.substring(0, 10) + '...)' : ''}`);
            console.log(`Refresh Token: ${loc.ghlRefreshToken ? 'PRESENT' : 'NULL'}`);
        }
    } catch (e) {
        console.error('Error querying database:', e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
