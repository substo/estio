
import { PrismaClient } from '@prisma/client';

const url = process.env.DATABASE_URL || '';
const newUrl = url.includes('?') ? `${url}&pgbouncer=true` : `${url}?pgbouncer=true`;

const prisma = new PrismaClient({
    datasources: {
        db: {
            url: newUrl,
        },
    },
});

const COMPANIES = [
    {
        name: 'Pafilia Property Developers',
        website: 'https://www.pafilia.com',
        email: 'info@pafilia.com',
        phone: '+357 26 848 800',
        type: 'developer'
    },
    {
        name: 'Aristo Developers',
        website: 'https://www.aristodevelopers.com',
        email: 'info@aristodevelopers.com',
        phone: '+357 26 841 800',
        type: 'developer'
    },
    {
        name: 'Leptos Estates',
        website: 'https://www.leptosestates.com',
        email: 'info@leptosestates.com',
        phone: '+357 26 880 100',
        type: 'developer'
    },
    {
        name: 'Korantina Homes',
        website: 'https://korantinahomes.com',
        email: 'info@korantinahomes.com',
        phone: '+357 26 623 536',
        type: 'developer'
    },
    {
        name: 'Cybarco',
        website: 'https://www.cybarco.com',
        email: 'info@cybarco.com',
        phone: '+357 25 362 800',
        type: 'developer'
    },
    {
        name: 'D. Zavos Group',
        website: 'https://zavos.com',
        email: 'info@zavos.com',
        phone: '+357 25 818 555',
        type: 'developer'
    },
    {
        name: 'Cyfield Group',
        website: 'https://www.cyfieldgroup.com',
        email: 'info@cyfieldgroup.com',
        phone: '+357 22 427 230',
        type: 'developer'
    },
    {
        name: 'Prime Property Group',
        website: 'https://www.prime-property.com',
        email: 'info@prime-property.com',
        phone: '+357 25 315 300',
        type: 'developer'
    },
    {
        name: 'Domenica Group',
        website: 'https://domenicagroup.com',
        email: 'info@domenicagroup.com',
        phone: '+357 26 600 700',
        type: 'developer'
    },
    {
        name: 'Imperio Properties',
        website: 'https://www.imperioproperties.com',
        email: 'info@imperioproperties.com',
        phone: '+357 25 581 005',
        type: 'developer'
    }
];

async function main() {
    // 1. Get the specific Location by GHL ID
    const targetGhlLocationId = 'ys9qMNTlv0jA6QPxXpbP';
    const location = await prisma.location.findUnique({
        where: { ghlLocationId: targetGhlLocationId }
    });

    if (!location) {
        throw new Error(`No Location found with ghlLocationId: ${targetGhlLocationId}. Please ensure the location is synced.`);
    }
    console.log(`Seeding companies for Location: ${location.name} (${location.id})`);

    // 2. Create Companies
    for (const company of COMPANIES) {
        // Check if company already exists to avoid duplicates (optional, but good practice)
        const existing = await prisma.company.findFirst({
            where: {
                locationId: location.id,
                name: company.name
            }
        });

        if (existing) {
            console.log(`Skipping existing company: ${company.name}`);
            continue;
        }

        const created = await prisma.company.create({
            data: {
                locationId: location.id,
                name: company.name,
                website: company.website,
                email: company.email,
                phone: company.phone,
                type: company.type
            }
        });
        console.log(`Created company: ${created.name}`);
    }
    console.log('Company seeding complete.');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
