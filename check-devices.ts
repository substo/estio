import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
    const devices = await prisma.smsRelayDevice.findMany({
        select: { id: true, label: true, platform: true, status: true, paired: true, lastSeenAt: true }
    });
    console.log(JSON.stringify(devices, null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());
