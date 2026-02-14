
import db from "@/lib/db";
import { generateEmbedding } from "./embeddings";

interface InsightInput {
    contactId: string;
    conversationId?: string;
    dealId?: string;
    text: string;
    category: "preference" | "objection" | "timeline" | "motivation" | "relationship";
    importance?: number;
    source?: string;
}

/**
 * Store a new insight with its vector embedding.
 * Called by agent skills when they discover something noteworthy.
 */
export async function storeInsight(input: InsightInput): Promise<void> {
    const embedding = await generateEmbedding(input.text);

    // Create the record
    const insight = await db.insight.create({
        data: {
            contactId: input.contactId,
            conversationId: input.conversationId,
            dealId: input.dealId,
            text: input.text,
            category: input.category,
            importance: input.importance ?? 5,
            source: input.source ?? "agent_extracted",
        },
    });

    // Store the embedding via raw SQL (Prisma doesn't support vector type)
    // Cast to vector type required by pgvector
    if (embedding.length > 0) {
        await db.$executeRaw`
        UPDATE insights 
        SET embedding = ${JSON.stringify(embedding)}::vector
        WHERE id = ${insight.id}
      `;
    }
}

/**
 * Retrieve the most relevant insights for a given query.
 * Used to inject context into agent prompts.
 * 
 * @param contactId - Scope to a specific contact
 * @param query - Natural language query (e.g., "What does this client prefer?")
 * @param limit - Max results (default: 5)
 * @returns Array of relevant insights ranked by similarity
 */
export async function retrieveContext(
    contactId: string,
    query: string,
    limit: number = 5
): Promise<{ text: string; category: string; importance: number; similarity: number }[]> {
    const queryEmbedding = await generateEmbedding(query);
    if (queryEmbedding.length === 0) return [];

    // Use Prisma's $queryRaw for the vector similarity search
    const results = await db.$queryRaw`
    SELECT
      text,
      category,
      importance,
      1 - (embedding <=> ${JSON.stringify(queryEmbedding)}::vector) AS similarity
    FROM insights
    WHERE "contactId" = ${contactId}
      AND (expiresAt IS NULL OR expiresAt > NOW())
    ORDER BY embedding <=> ${JSON.stringify(queryEmbedding)}::vector
    LIMIT ${limit}
  `;

    return results as any[];
}

/**
 * Retrieve ALL insights for a contact (for full context injection).
 */
export async function getContactInsights(contactId: string) {
    return db.insight.findMany({
        where: { contactId },
        orderBy: { importance: "desc" },
        take: 20,
    });
}
