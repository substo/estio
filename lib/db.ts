import { PrismaClient } from '@prisma/client';

const prismaClientSingleton = () => {
    let url = process.env.DATABASE_URL;

    if (url) {
        // Fix for Supabase transaction pooler "prepared statement already exists" error
        if (!url.includes('pgbouncer=true')) {
            url += (url.includes('?') ? '&' : '?') + 'pgbouncer=true';
        }
        console.log("Initializing Prisma with URL:", url.replace(/:[^:@]*@/, ":****@")); // Mask password
    } else {
        console.error("DATABASE_URL is missing!");
    }

    return new PrismaClient({
        datasources: {
            db: {
                url,
            },
        },
    });
};

declare global {
    var prisma: undefined | ReturnType<typeof prismaClientSingleton>;
}

const db = globalThis.prisma ?? prismaClientSingleton();

export default db;

if (process.env.NODE_ENV !== 'production') globalThis.prisma = db;
