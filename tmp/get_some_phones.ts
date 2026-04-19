import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const contacts = await prisma.contact.findMany({
    where: {
      phone: { not: null, not: "" }
    },
    take: 10,
    select: {
      locationId: true,
      country: true,
      phone: true,
      location: { select: { name: true } }
    }
  });

  console.table(contacts);
}

main().finally(() => prisma.$disconnect());
