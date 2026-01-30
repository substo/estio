
import { PrismaClient, PublicationStatus } from '@prisma/client';

const url = process.env.DATABASE_URL || '';
const newUrl = url.includes('?') ? `${url}&pgbouncer=true` : `${url}?pgbouncer=true`;

const prisma = new PrismaClient({
    datasources: {
        db: {
            url: newUrl,
        },
    },
});

async function main() {
    // 1. Get a Location
    const location = await prisma.location.findFirst();
    if (!location) throw new Error('No location found');

    // 2. Create a property with PENDING status
    const property = await prisma.property.create({
        data: {
            locationId: location.id,
            title: 'Pending Property Verification',
            slug: `pending-verify-${Date.now()}`,
            publicationStatus: 'PENDING' as PublicationStatus, // Cast to avoid TS error if types are stale in this script context
            status: 'ACTIVE',
            goal: 'SALE',
            price: 100000,
            currency: 'EUR',
            source: 'VERIFICATION_SCRIPT'
        }
    });

    console.log('Created Property:', property.id, property.title, property.publicationStatus);

    // 3. Verify it was saved correctly
    const fetched = await prisma.property.findUnique({
        where: { id: property.id }
    });

    if (fetched?.publicationStatus === 'PENDING') {
        console.log('SUCCESS: Property saved with PENDING status.');
    } else {
        console.error('FAILURE: Property status mismatch:', fetched?.publicationStatus);
    }
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
