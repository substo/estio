import db from "./lib/db";

async function checkAll() {
  console.log('--- Recent SmsRelayOutbox Rows ---');
  const outboxRows = await db.smsRelayOutbox.findMany({
    include: { device: true },
    orderBy: { scheduledAt: 'desc' },
    take: 10
  });
  console.log(JSON.stringify(outboxRows, null, 2));
}

checkAll().catch(console.error).finally(() => db.$disconnect());
