
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const phone = '+81660364234844';
    const contact = await prisma.contact.findFirst({
        where: {
            phone: {
                contains: '81660364234844'
            }
        },
        select: {
            id: true,
            name: true,
            phone: true,
            ghlContactId: true,
            googleContactId: true,
            locationId: true
        }
    });

    if (contact) {
        console.log('Contact found:', JSON.stringify(contact, null, 2));

        // Also check location GHL connection
        const location = await prisma.location.findUnique({
            where: { id: contact.locationId },
            select: { ghlAccessToken: true }
        });
        console.log('Location GHL Token present:', !!location?.ghlAccessToken);

    } else {
        console.log('Contact not found with that phone number.');
    }
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
