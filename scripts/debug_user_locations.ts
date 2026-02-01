
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const clerkId = 'user_384etwBIPPWakPq7ReNp92EvKtT';
    const email = 'u3479347958@gmail.com';
    const localId = 'cml2rqkq80000a4om5dp66bsv';

    console.log('--- DEBUG USER LOCATIONS ---');

    // 1. Fetch User by Clerk ID
    const userByClerk = await prisma.user.findUnique({
        where: { clerkId },
        include: { locations: true }
    });
    console.log('User by Clerk ID:', userByClerk ? {
        id: userByClerk.id,
        email: userByClerk.email,
        name: userByClerk.name,
        // agencyId: userByClerk.agencyId,
        locationCount: userByClerk.locations.length,
        locations: userByClerk.locations.map(l => ({ id: l.id, name: l.name }))
    } : 'NOT FOUND');

    // 2. Fetch User by ID (from logs)
    const userByLocalId = await prisma.user.findUnique({
        where: { id: localId },
        include: { locations: true }
    });
    console.log('User by Local ID:', userByLocalId ? {
        id: userByLocalId.id,
        email: userByLocalId.email,
        locationCount: userByLocalId.locations.length
    } : 'NOT FOUND');

    // 3. Count all locations
    const locationCount = await prisma.location.count();
    console.log('Total Locations in DB:', locationCount);

    // 4. List first 5 locations
    const locations = await prisma.location.findMany({ take: 5 });
    console.log('Sample Locations:', locations.map(l => ({ id: l.id, name: l.name })));

}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
