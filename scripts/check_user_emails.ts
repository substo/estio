
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('--- DEBUG USER EMAILS ---');

    const emailsToCheck = ['u3479347958@gmail.com', 'martindowntowncyprus@gmail.com'];

    const users = await prisma.user.findMany({
        where: {
            email: { in: emailsToCheck }
        },
        include: { locations: true }
    });

    console.log(`Found ${users.length} users matching emails:`);
    users.forEach(u => {
        console.log(`- ID: ${u.id}`);
        console.log(`  Email: ${u.email}`);
        console.log(`  ClerkID: ${u.clerkId}`);
        console.log(`  Locations: ${u.locations.length}`);
        console.log(`  Created: ${u.createdAt}`);
        console.log('---');
    });
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
