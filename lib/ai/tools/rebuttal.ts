
import db from "@/lib/db";
import { generateEmbedding } from "../embeddings";
import { Prisma } from "@prisma/client";

/**
 * Retrieve the most relevant rebuttal strategies from the Sales Playbook.
 * Uses vector similarity search against the embedded playbook entries.
 */
export async function retrieveRebuttal(
    objectionText: string,
    category?: string,
    apiKey?: string
): Promise<{ strategy: string; rebuttal: string; examples: string[] }[]> {
    const embedding = await generateEmbedding(objectionText, apiKey);

    if (embedding.length === 0) return [];

    // Raw SQL for cosine distance
    const results = await db.$queryRaw`
    SELECT text, category, 
           1 - (embedding <=> ${JSON.stringify(embedding)}::vector) AS similarity
    FROM playbook_entries
    ${category ? Prisma.sql`WHERE category = ${category}` : Prisma.empty}
    ORDER BY embedding <=> ${JSON.stringify(embedding)}::vector
    LIMIT 3
  `;

    // Map result to simpler format for the agent
    return (results as any[]).map(r => ({
        strategy: r.category,
        rebuttal: r.text,
        examples: [], // Examples embedded in text usually
        similarity: r.similarity
    }));
}
