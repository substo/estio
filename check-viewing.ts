import { PrismaClient } from '@prisma/client';

const db = new PrismaClient({
    datasources: {
        db: {
            url: "postgresql://postgres.oxxkmbxfqswtomzernzu:ropCys-dewpif-didnu7@aws-1-eu-north-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connect_timeout=30"
        }
    }
});

async function main() {
    const viewings = await db.viewing.findMany({
        where: { contact: { phone: { contains: '972523420936' } } },
        include: { syncRecords: true, outboxJobs: true },
        orderBy: { createdAt: 'desc' },
        take: 5
    });
    console.dir(viewings, { depth: null });
}

main().catch(console.error).finally(() => db.$disconnect());
