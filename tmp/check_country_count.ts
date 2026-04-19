import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const count = await prisma.contact.count({
    where: {
      country: { not: null, not: "" }
    }
  });

  console.log("Contacts with non-null country:", count);
}

main().finally(() => prisma.$disconnect());
