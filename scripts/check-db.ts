
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('Checking database connection...');
    try {
        // Try to count feeds - this will fail if table missing
        const count = await prisma.propertyFeed.count();
        console.log(`Successfully connected! Found ${count} feeds.`);
    } catch (e) {
        console.error('Error connecting or querying PropertyFeed:', e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
