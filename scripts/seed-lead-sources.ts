
import { PrismaClient } from '@prisma/client';
import { LEAD_SOURCES } from '../app/(main)/admin/contacts/_components/contact-types';

const prisma = new PrismaClient();

async function main() {
    console.log('🚀 Starting Lead Source seeding...');

    try {
        // 1. Get all locations
        const locations = await prisma.location.findMany({ select: { id: true, name: true } });
        console.log(`📍 Found ${locations.length} locations.`);

        for (const location of locations) {
            console.log(`   Processing location: ${location.name} (${location.id})`);

            let createdCount = 0;
            let existingCount = 0;

            for (const source of LEAD_SOURCES) {
                // Upsert ensures we don't create duplicates if run multiple times
                // We use findFirst + create because we don't have a unique constraint on id yet (UUIDs)
                // But we added @@unique([locationId, name]) in schema, so upsert works best.

                await prisma.leadSource.upsert({
                    where: {
                        locationId_name: {
                            locationId: location.id,
                            name: source,
                        }
                    },
                    update: {}, // No updates, just ensure it exists
                    create: {
                        locationId: location.id,
                        name: source,
                        isActive: true
                    }
                });
                // We rely on prisma upsert counting
            }
            console.log(`      ✅ Ensured ${LEAD_SOURCES.length} sources.`);
        }

        console.log('✨ Lead Source seeding complete!');

    } catch (e) {
        console.error('❌ Seeding failed:', e);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

main();
