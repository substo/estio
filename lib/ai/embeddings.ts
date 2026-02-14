
import { GoogleGenerativeAI } from "@google/generative-ai";

/**
 * Generate a 3072-dimensional embedding for a text string.
 * Uses Google's gemini-embedding-001 model.
 * 
 * @param text The text to embed
 * @param apiKey Optional API key. If not provided, falls back to process.env.GOOGLE_API_KEY
 */
export async function generateEmbedding(text: string, apiKey?: string): Promise<number[]> {
    const key = apiKey || process.env.GOOGLE_API_KEY;

    if (!key) {
        console.warn("GOOGLE_API_KEY is not set and no key provided. Embeddings will fail.");
        return [];
    }

    try {
        const genAI = new GoogleGenerativeAI(key);
        // Using gemini-embedding-001 (3072 dimensions) since text-embedding-004 is unavailable
        const model = genAI.getGenerativeModel({ model: "gemini-embedding-001" });

        const result = await model.embedContent(text);
        return result.embedding.values;
    } catch (error) {
        console.error("Failed to generate embedding", error);
        return [];
    }
}
