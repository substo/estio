
import db from "@/lib/db";
import { generateEmbedding } from "@/lib/ai/embeddings";
import fs from "fs";
import path from "path";
import matter from "gray-matter";

const PLAYBOOK_PATH = path.join(process.cwd(), "lib/ai/skills/objection_handler/references/sales-playbook.md");

async function main() {
    console.log("🚀 Starting Playbook Embedding...");

    // 0. Resolve API Key
    let apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
        console.log("⚠️ GOOGLE_API_KEY not found in env. Checking SiteConfig...");
        const siteConfig = await db.siteConfig.findFirst({
            where: { googleAiApiKey: { not: null } }
        });
        if (siteConfig?.googleAiApiKey) {
            apiKey = siteConfig.googleAiApiKey.trim();
            console.log(`✅ Using API Key from SiteConfig (Location: ${siteConfig.locationId})`);
            console.log(`🔑 Key Prefix: ${apiKey.substring(0, 10)}...`);
        } else {
            console.error("❌ No API Key found in env or SiteConfig. Exiting.");
            process.exit(1);
        }
    }

    // 1. Ensure PgVector Extension & Column Exist
    try {
        await db.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS vector;`);

        // Ensure column exists (might comprise 768 dims if old)
        await db.$executeRawUnsafe(`ALTER TABLE playbook_entries ADD COLUMN IF NOT EXISTS embedding vector(3072);`);

        // Unconditionally try to update dimension (migrating 768 -> 3072 if needed)
        // Must drop index first
        try {
            await db.$executeRawUnsafe(`DROP INDEX IF EXISTS playbook_entries_embedding_idx;`);
            await db.$executeRawUnsafe(`ALTER TABLE playbook_entries ALTER COLUMN embedding TYPE vector(3072);`);
        } catch (e: any) {
            console.warn("Alter column/type failed (might be correct already):", e.message);
        }

        // Re-create Index for performance
        try {
            await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS playbook_entries_embedding_idx ON playbook_entries USING ivfflat (embedding vector_cosine_ops);`);
        } catch (e: any) {
            console.log("Index creation failed (likely exists):", e.message);
        }

    } catch (e: any) {
        console.error("Failed to setup vector extension:", e);
    }

    // 2. Read Playbook
    if (!fs.existsSync(PLAYBOOK_PATH)) {
        console.error("Playbook file not found at:", PLAYBOOK_PATH);
        process.exit(1);
    }

    const content = fs.readFileSync(PLAYBOOK_PATH, "utf-8");

    // Simple parser: Split by "## Objection:"
    // We want to capture the objection header and the content below it
    const sections = content.split(/^## Objection:/gm).slice(1); // Skip preamble

    console.log(`Found ${sections.length} objection sections.`);

    for (const section of sections) {
        const [headerLine, ...bodyLines] = section.split("\n");
        const objectionTitle = headerLine.trim().replace(/^"|"$/g, ''); // Remove quotes
        const body = bodyLines.join("\n").trim();

        const fullText = `Objection: ${objectionTitle}\n${body}`;
        const embedding = await generateEmbedding(fullText, apiKey);

        if (embedding.length === 0) {
            console.warn(`Failed to embed section: ${objectionTitle}`);
            continue;
        }

        // Infer category based on keywords (simple heuristic)
        let category = "OBJECTION"; // Default
        const lowerBody = body.toLowerCase();
        if (lowerBody.includes("price") || lowerBody.includes("expensive") || lowerBody.includes("budget")) category = "PRICE";
        else if (lowerBody.includes("location") || lowerBody.includes("area") || lowerBody.includes("far")) category = "LOCATION";
        else if (lowerBody.includes("wait") || lowerBody.includes("time") || lowerBody.includes("ready")) category = "TIMING";
        else if (lowerBody.includes("trust") || lowerBody.includes("reviews")) category = "TRUST";
        else if (lowerBody.includes("cheaper") || lowerBody.includes("other agent")) category = "COMPETITOR";
        else if (lowerBody.includes("small") || lowerBody.includes("renovation")) category = "PROPERTY_SPECIFIC";

        // Insert into DB
        // We Use upsert logic or delete and re-insert?
        // Since id is CUID, difficult to upsert without stable ID. 
        // For simplicity, we create new entries. Ideally we should wipe table first or check exact text.
        // Let's create new ones.

        const entry = await db.playbookEntry.create({
            data: {
                text: fullText,
                category
            }
        });

        await db.$executeRaw`
            UPDATE playbook_entries
            SET embedding = ${JSON.stringify(embedding)}::vector
            WHERE id = ${entry.id}
        `;

        console.log(`✅ Embedded: ${objectionTitle} (${category})`);
    }

    console.log("🎉 Playbook embedding complete!");
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await db.$disconnect();
    });
