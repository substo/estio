
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const oldEmail = 'martindowntowncyprus@gmail.com';
    const newEmail = 'u3479347958@gmail.com';
    const newClerkId = 'user_384etwBIPPWakPq7ReNp92EvKtT';

    console.log('--- MIGRATING USER IDENTITY ---');

    // 1. Get the "Duplicate/New" user (we will delete this one, but first check we are deleting the right thing)
    const conflictingUser = await prisma.user.findUnique({
        where: { email: newEmail }
    });

    if (conflictingUser) {
        console.log(`Deleting temporary duplicate user: ${conflictingUser.id} (${conflictingUser.email})`);
        // Delete the duplicate user
        await prisma.user.delete({
            where: { id: conflictingUser.id }
        });
    } else {
        console.log('No conflicting duplicate user found.');
    }

    // 2. Update the "Original/Correct" user with the new Identity details
    const originalUser = await prisma.user.findUnique({
        where: { email: oldEmail }
    });

    if (!originalUser) {
        console.error(`Original user ${oldEmail} not found! Cannot migrate.`);
        return;
    }

    console.log(`Updating original user ${originalUser.id} with new Clerk ID and Email...`);
    await prisma.user.update({
        where: { id: originalUser.id },
        data: {
            clerkId: newClerkId,
            email: newEmail // Update email to match login so ensureUserExists finds it next time
        }
    });

    console.log('Migration Complete. Please refresh via Dashboard.');
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
