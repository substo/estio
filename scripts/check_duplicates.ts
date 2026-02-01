
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const email = 'u3479347958@gmail.com';

    // Find all users with this email (Prisma findMany doesn't filter unique by default if constraint allows?)
    // Actually email is usually unique in schema, but let's check just in case or checking by ClerkId vs Local ID mismatch.
    // The user issue implies user was "deleted and re-created", meaning the OLD one might still be lingering if "delete" wasn't a hard DB delete?
    // Or maybe there are users with same email but different ClerkIDs?

    const users = await prisma.user.findMany({
        where: { email },
        include: { locations: true }
    });

    console.log(`Found ${users.length} users with email ${email}:`);
    users.forEach(u => {
        console.log(`- ID: ${u.id}, ClerkID: ${u.clerkId}, Created: ${u.createdAt}, Locations: ${u.locations.length}`);
    });
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
