import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function run() {
    const dryRun = process.argv.includes("--dry-run");
    const locationId = process.argv.find((arg) => arg.startsWith("--location="))?.split("=")[1] || null;

    const leakedContacts = await db.contact.findMany({
        where: {
            ...(locationId ? { locationId } : {}),
            contactType: "Ref-GroupMember",
        },
        select: {
            id: true,
            name: true,
            phone: true,
            locationId: true,
            conversations: {
                select: { id: true },
            },
            conversationParticipations: {
                select: { id: true },
            },
        },
    });

    const standalone = leakedContacts.filter(
        (contact) => contact.conversations.length > 0 && contact.conversationParticipations.length === 0
    );

    console.log(JSON.stringify({
        locationId,
        dryRun,
        totalRefGroupMembers: leakedContacts.length,
        standaloneCount: standalone.length,
        standalone: standalone.map((contact) => ({
            id: contact.id,
            name: contact.name,
            phone: contact.phone,
            conversations: contact.conversations.length,
        })),
    }, null, 2));

    if (dryRun || standalone.length === 0) {
        return;
    }

    const result = await db.contact.updateMany({
        where: { id: { in: standalone.map((contact) => contact.id) } },
        data: { contactType: "Lead" },
    });

    console.log(JSON.stringify({ updatedCount: result.count }, null, 2));
}

run()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await db.$disconnect();
    });
