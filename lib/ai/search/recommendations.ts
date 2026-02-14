
import db from "@/lib/db";
import { Property, Prisma } from "@prisma/client";

/**
 * Find properties similar to a reference property.
 * Uses vector similarity on property embeddings.
 */
export async function findSimilarProperties(
    propertyId: string,
    limit: number = 5,
    excludeIds: string[] = []
): Promise<{ property: Property; similarity: number }[]> {
    // 1. Get the embedding of the reference property
    // We could fetch it from DB, but we need raw access to the vector column
    const refProperty = await db.$queryRaw<{ embedding: string }[]>`
    SELECT embedding::text 
    FROM "Property" 
    WHERE id = ${propertyId}
  `;

    if (!refProperty || refProperty.length === 0 || !refProperty[0].embedding) {
        return [];
    }

    const embeddingVector = refProperty[0].embedding; // String representation of vector

    // 2. Search for similar properties
    // exclude the reference property itself plus any others
    const allExcluded = [propertyId, ...excludeIds];

    const similarRaw = await db.$queryRaw<{ id: string; similarity: number }[]>`
    SELECT id, 1 - (embedding <=> ${embeddingVector}::vector) as similarity
    FROM "Property"
    WHERE status = 'ACTIVE'
      AND id NOT IN (${Prisma.join(allExcluded)})
    ORDER BY embedding <=> ${embeddingVector}::vector
    LIMIT ${limit}
  `;

    if (similarRaw.length === 0) return [];

    // 3. Hydrate content
    const ids = similarRaw.map(r => r.id);
    const properties = await db.property.findMany({
        where: { id: { in: ids } }
    });

    return similarRaw.map(r => {
        const p = properties.find(prop => prop.id === r.id);
        return p ? { property: p, similarity: r.similarity } : null;
    }).filter(Boolean) as { property: Property; similarity: number }[];
}
