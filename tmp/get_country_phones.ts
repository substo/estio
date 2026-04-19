import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const contacts = await prisma.contact.findMany({
    where: {
      phone: { not: null, not: "" },
      country: { not: null, not: "" },
    },
    distinct: ['locationId', 'country'],
    select: {
      locationId: true,
      country: true,
      phone: true,
      location: { select: { name: true } },
    }
  });

  const parsed = contacts.map(c => ({
    locationId: c.locationId,
    locationName: c.location?.name ?? 'Unknown',
    country: c.country,
    phone: c.phone
  }));

  if (parsed.length === 0) {
    console.log("No contacts with phone and country found.");
  } else {
    console.table(parsed);
    require('fs').writeFileSync('tmp/phones.json', JSON.stringify(parsed, null, 2));
    console.log("Saved results to tmp/phones.json");
  }
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
