
import db from "@/lib/db";
import { generateEmbedding } from "@/lib/ai/embeddings";
import { Property, Prisma } from "@prisma/client";

export interface SearchParams {
    // Structured filters
    locationId: string;
    district?: string;
    minPrice?: number;
    maxPrice?: number;
    bedrooms?: number;
    propertyType?: string;
    dealType?: "sale" | "rent";

    // Semantic search
    naturalLanguageQuery?: string;

    // Contextual
    excludePropertyIds?: string[];

    limit?: number;
}

export interface SearchResult {
    property: Property;
    score: number;
    matchReasons: string[];
    semanticSimilarity?: number;
}

/**
 * Hybrid search combining structured filters + semantic similarity.
 * Uses Reciprocal Rank Fusion (RRF) to merge results.
 */
export async function hybridPropertySearch(
    params: SearchParams
): Promise<SearchResult[]> {
    const limit = params.limit ?? 5;

    // ── Strategy 1: Structured SQL Filter ──
    // Build price filter properly (both min and max can coexist)
    const priceFilter: Record<string, number> = {};
    if (params.minPrice) priceFilter.gte = params.minPrice;
    if (params.maxPrice) priceFilter.lte = params.maxPrice;

    const structuredWhere: Prisma.PropertyWhereInput = {
        locationId: params.locationId,
        status: "ACTIVE",
        ...(params.district && {
            OR: [
                { propertyLocation: { contains: params.district, mode: 'insensitive' } },
                { city: { contains: params.district, mode: 'insensitive' } },
                { addressLine1: { contains: params.district, mode: 'insensitive' } }
            ]
        }),
        ...(Object.keys(priceFilter).length > 0 && { price: priceFilter }),
        ...(params.bedrooms && { bedrooms: { gte: params.bedrooms } }),
        ...(params.propertyType && { type: { contains: params.propertyType, mode: 'insensitive' } }),
        ...(params.dealType === "sale" && { goal: "SALE" }),
        ...(params.dealType === "rent" && { goal: "RENT" }),
        ...(params.excludePropertyIds && { id: { notIn: params.excludePropertyIds } }),
    };

    const structuredResults = await db.property.findMany({
        where: structuredWhere,
        take: limit * 2,
        orderBy: { createdAt: "desc" },
    });

    // ── Strategy 2: Semantic Vector Search ──
    let semanticResults: { property: Property, similarity: number }[] = [];

    if (params.naturalLanguageQuery) {
        // Resolve API key (env -> SiteConfig) for embedding generation
        let apiKey = process.env.GOOGLE_API_KEY;
        if (!apiKey) {
            const siteConfig = await db.siteConfig.findFirst({
                where: { googleAiApiKey: { not: null } }
            });
            if (siteConfig?.googleAiApiKey) apiKey = siteConfig.googleAiApiKey;
        }
        const queryEmbedding = await generateEmbedding(params.naturalLanguageQuery, apiKey);

        if (queryEmbedding.length > 0) {
            // We use raw SQL for pgvector similarity
            const excludeClause = params.excludePropertyIds?.length
                // Prisma.join is safe for raw query parts if used correctly, 
                // but here we might need to manually construct the string safely or use direct param if simple
                // A safer way with Prisma.sql and join:
                ? Prisma.sql`AND id NOT IN (${Prisma.join(params.excludePropertyIds)})`
                : Prisma.empty;

            const priceClause = params.maxPrice
                ? Prisma.sql`AND price <= ${params.maxPrice}`
                : Prisma.empty;

            // Note: casting ::vector is required for pgvector
            const vectorQuery = Prisma.sql`
          SELECT id, 1 - (embedding <=> ${JSON.stringify(queryEmbedding)}::vector) as similarity
          FROM "Property"
          WHERE "locationId" = ${params.locationId}
            AND status = 'ACTIVE'
            ${priceClause}
            ${excludeClause}
          ORDER BY embedding <=> ${JSON.stringify(queryEmbedding)}::vector
          LIMIT ${limit * 2}
        `;

            const rawResults = await db.$queryRaw<{ id: string, similarity: number }[]>(vectorQuery);

            // Hydrate
            if (rawResults.length > 0) {
                const ids = rawResults.map(r => r.id);
                const properties = await db.property.findMany({ where: { id: { in: ids } } });

                // Map back to maintain order and attach similarity
                semanticResults = rawResults.map(r => {
                    const p = properties.find(prop => prop.id === r.id);
                    return p ? { property: p, similarity: r.similarity } : null;
                }).filter(Boolean) as { property: Property, similarity: number }[];
            }
        }
    }

    // ── Reciprocal Rank Fusion ──
    return fuseResults(structuredResults, semanticResults, limit);
}

function fuseResults(
    structured: Property[],
    semantic: { property: Property, similarity: number }[],
    limit: number,
    k: number = 60
): SearchResult[] {
    const scoreMap = new Map<string, { score: number; reasons: string[]; property: Property; similarity?: number }>();

    const addScore = (p: Property, rank: number, reason: string, sim?: number) => {
        const existing = scoreMap.get(p.id) ?? { score: 0, reasons: [], property: p };
        existing.score += 1 / (k + rank);
        if (!existing.reasons.includes(reason)) existing.reasons.push(reason);
        if (sim) existing.similarity = sim;
        scoreMap.set(p.id, existing);
    };

    structured.forEach((p, i) => addScore(p, i, "Matches your criteria"));
    semantic.forEach((item, i) => addScore(item.property, i, "Matches your description", item.similarity));

    return Array.from(scoreMap.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(val => ({
            property: val.property,
            score: val.score,
            matchReasons: val.reasons,
            semanticSimilarity: val.similarity
        }));
}
