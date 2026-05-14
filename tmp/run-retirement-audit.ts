import { PrismaClient } from '@prisma/client';
import { getEvolutionRetirementAudit } from '../lib/whatsapp/evolution-retirement';

async function main() {
  const db = new PrismaClient();
  try {
    const audit = await getEvolutionRetirementAudit(db);
    console.log(JSON.stringify(audit, null, 2));
  } catch (error) {
    console.error('Error running audit:', error);
  } finally {
    await db.$disconnect();
  }
}

main();
