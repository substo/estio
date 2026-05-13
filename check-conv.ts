import db from "./lib/db";

async function checkConv() {
  const conv = await db.conversation.findUnique({
    where: { id: 'import_1777999489560' },
    include: { contact: true }
  });
  console.log("Conversation:", JSON.stringify(conv, null, 2));
}

checkConv().catch(console.error).finally(() => db.$disconnect());
