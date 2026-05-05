import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
    // Check outbox jobs
    const jobs = await prisma.smsRelayOutbox.findMany({
        orderBy: { id: 'desc' },
        take: 5,
    });
    console.log("Outbox jobs:", JSON.stringify(jobs, null, 2));

    // Check recent sms_relay messages
    const messages = await prisma.message.findMany({
        where: { conversationId: "cmmna7umo00a1a4i7bj7ujw61", source: "sms_relay" },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, body: true, status: true, source: true, createdAt: true }
    });
    console.log("\nSMS Relay messages:", JSON.stringify(messages, null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());
