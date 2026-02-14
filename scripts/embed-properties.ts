
import db from "@/lib/db";
import { generateEmbedding } from "@/lib/ai/embeddings";
import { generatePropertyText } from "@/lib/ai/search/property-embeddings";

async function main() {
    console.log("🚀 Starting Property Embedding...");

    // 1. Resolve API Key
    let apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
        console.log("⚠️ GOOGLE_API_KEY not found in env. Checking SiteConfig...");
        const siteConfig = await db.siteConfig.findFirst({
            where: { googleAiApiKey: { not: null } }
        });
        if (siteConfig?.googleAiApiKey) {
            apiKey = siteConfig.googleAiApiKey.trim();
            console.log(`✅ Using API Key from SiteConfig (Location: ${siteConfig.locationId})`);
        } else {
            console.error("❌ No API Key found in env or SiteConfig. Exiting.");
            process.exit(1);
        }
    }

    // 2. Ensure PgVector Extension & Column Exist
    try {
        await db.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS vector;`);

        // We use vector(3072) because we are using gemini-embedding-001
        await db.$executeRawUnsafe(`ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS embedding vector(3072);`);

        // Create Index for performance
        try {
            await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_property_embedding ON "Property" USING hnsw (embedding vector_cosine_ops);`);
        } catch (e: any) {
            console.log("Index creation failed (likely exists):", e.message);
        }

    } catch (e: any) {
        console.error("Failed to setup vector extension:", e);
    }

    // 2. Fetch all active properties
    const properties = await db.property.findMany({
        where: { status: "ACTIVE" },
    });

    console.log(`Found ${properties.length} active properties to embed.`);

    for (const property of properties) {
        try {
            const text = generatePropertyText(property);
            const embedding = await generateEmbedding(text, apiKey);

            if (embedding.length === 0) {
                console.warn(`Skipping property ${property.id}: Failed to generate embedding.`);
                continue;
            }

            await db.$executeRaw`
            UPDATE "Property"
            SET embedding = ${JSON.stringify(embedding)}::vector
            WHERE id = ${property.id}
        `;

            console.log(`✅ Embedded: ${property.title} (${property.id})`);
        } catch (error) {
            console.error(`❌ Failed to embed property ${property.id}:`, error);
        }
    }

    console.log("🎉 Property embedding complete!");
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await db.$disconnect();
    });
