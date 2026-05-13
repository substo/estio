import db from "./lib/db";

async function check() {
  const conversationId = 'import_1777999489560';
  
  console.log('--- SmsRelayOutbox Rows ---');
  const outboxRows = await db.smsRelayOutbox.findMany({
    where: { conversationId },
    include: { device: true },
    orderBy: { scheduledAt: 'desc' },
    take: 5
  });
  console.log(JSON.stringify(outboxRows, null, 2));

  console.log('\n--- Recent Outbound SMS Messages ---');
  const messages = await db.message.findMany({
    where: { conversationId, type: 'TYPE_SMS', direction: 'outbound' },
    orderBy: { createdAt: 'desc' },
    take: 5
  });
  console.log(JSON.stringify(messages, null, 2));
}

check().catch(console.error).finally(() => db.$disconnect());
