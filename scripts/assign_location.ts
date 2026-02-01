
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const email = 'u3479347958@gmail.com';

    // Find the user
    const user = await prisma.user.findUnique({
        where: { email },
    });

    if (!user) {
        console.error('User not found!');
        return;
    }

    // Find a location to assign
    const location = await prisma.location.findFirst({
        where: { name: "Martin's Business" }
    });

    if (!location) {
        console.error('Location not found!');
        return;
    }

    // Assign location
    await prisma.user.update({
        where: { id: user.id },
        data: {
            locations: {
                connect: { id: location.id }
            }
        }
    });

    console.log(`Successfully assigned location "${location.name}" to user ${user.email}`);
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
