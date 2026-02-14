
import db from "@/lib/db";
import { generateEmbedding } from "@/lib/ai/embeddings";
import { Property } from "@prisma/client";

/**
 * Generate a rich text description for a property that captures
 * all semantically searchable attributes.
 */
export function generatePropertyText(property: Property & { features?: string[] }): string {
    const parts = [
        property.title,
        property.description,
        `${property.type || 'Property'} in ${property.propertyLocation || property.city || ''}`,
        `${property.bedrooms || 0} bedrooms, ${property.bathrooms || 0} bathrooms`,
        `${property.areaSqm || 0} sqm${property.plotAreaSqm ? ', ' + property.plotAreaSqm + ' sqm plot' : ''}`,
        `Price: €${property.price?.toLocaleString() || 'N/A'}`,
        property.features?.join(", "),
        property.condition,
        // Add any other relevant fields
        property.viewingDirections,
        property.viewingNotes
    ].filter(Boolean);

    return parts.join(". ");
}

/**
 * Update embedding when a property is created or modified.
 * Called from the property create/update server actions.
 */
export async function updatePropertyEmbedding(propertyId: string) {
    try {
        const property = await db.property.findUnique({
            where: { id: propertyId },
        });

        if (!property) return;

        // Use a more generic approach if features aren't strictly typed/included in default findUnique
        // In this repo, features is string[] @default([]) so it's on the object
        const text = generatePropertyText(property);

        // Resolve API Key (Env -> SiteConfig)
        let apiKey = process.env.GOOGLE_API_KEY;
        if (!apiKey) {
            const siteConfig = await db.siteConfig.findFirst({
                where: { googleAiApiKey: { not: null } }
            });
            if (siteConfig?.googleAiApiKey) {
                apiKey = siteConfig.googleAiApiKey;
            }
        }

        // Pass the resolved key (or undefined, handling inside generateEmbedding needs to be robust but we pass it explicitly if we have it)
        const embedding = await generateEmbedding(text, apiKey);

        if (embedding.length === 0) {
            console.warn(`Failed to generate embedding for property ${propertyId}`);
            return;
        }

        await db.$executeRaw`
      UPDATE "Property" 
      SET embedding = ${JSON.stringify(embedding)}::vector
      WHERE id = ${propertyId}
    `;
    } catch (error) {
        console.error(`Error updating property embedding for ${propertyId}:`, error);
    }
}
