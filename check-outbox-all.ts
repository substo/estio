import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
    const jobs = await prisma.smsRelayOutbox.findMany({
        orderBy: { id: 'desc' },
        take: 5,
    });
    console.log("Outbox jobs:", JSON.stringify(jobs, null, 2));

    const messages = await prisma.message.findMany({
        where: { source: "sms_relay" },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, body: true, status: true, source: true, createdAt: true, conversationId: true }
    });
    console.log("\nSMS Relay messages:", JSON.stringify(messages, null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());
