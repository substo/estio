
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('Enabling pgvector extension...');
    try {
        await prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS vector;');
        console.log('✅ pgvector extension enabled.');
    } catch (e) {
        console.error('❌ Failed to enable pgvector extension:', e);
        // Proceeding anyway, maybe it's already enabled or we don't have permissions
    }

    console.log('Adding embedding column to insights table...');
    try {
        await prisma.$executeRawUnsafe('ALTER TABLE insights ADD COLUMN IF NOT EXISTS embedding vector(768);');
        console.log('✅ embedding column added.');
    } catch (e) {
        console.error('❌ Failed to add embedding column:', e);
    }

    console.log('Adding index to embedding column...');
    try {
        await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS insights_embedding_idx ON insights USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);');
        console.log('✅ Index added.');
    } catch (e) {
        console.error('❌ Failed to add index:', e);
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
