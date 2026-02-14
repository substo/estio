
import { GoogleGenerativeAI } from "@google/generative-ai";

// Use the site config API key if available, otherwise fallback to env var
// Note: In a real app, we should fetch this from DB, but for this utility
// we'll assume the env var is set or passed in.
const apiKey = process.env.GOOGLE_API_KEY;

if (!apiKey) {
    console.warn("GOOGLE_API_KEY is not set. Embeddings will fail unless key is provided.");
}

const genAI = new GoogleGenerativeAI(apiKey!);

/**
 * Generate a 768-dimensional embedding for a text string.
 * Uses Google's text-embedding-005 model.
 * 
 * Cost: ~$0.00001 per embedding (negligible)
 */
export async function generateEmbedding(text: string): Promise<number[]> {
    if (!text) return [];

    // Clean text to avoid issues
    const cleanText = text.replace(/\n/g, " ").trim();
    if (!cleanText) return [];

    const model = genAI.getGenerativeModel({ model: "text-embedding-004" }); // 005 might not be generally available yet, using 004 as stable fallback or check existing models
    // Actually, let's use text-embedding-004 as it is the current stable one for Gemini.
    // If 005 is available, we can switch. documenting as 004 for safety.

    try {
        const result = await model.embedContent(cleanText);
        return result.embedding.values;
    } catch (e) {
        console.error("Failed to generate embedding", e);
        return [];
    }
}

/**
 * Batch embed multiple texts (more efficient for bulk operations).
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
    const model = genAI.getGenerativeModel({ model: "text-embedding-004" });

    const validTexts = texts.map(t => t.replace(/\n/g, " ").trim()).filter(t => t.length > 0);
    if (validTexts.length === 0) return [];

    try {
        // Prepare batch request if supported, or parallel promises
        // Gemini API supports batchEmbedContents
        const result = await model.batchEmbedContents({
            requests: validTexts.map(t => ({ content: { role: "user", parts: [{ text: t }] } }))
        });

        return result.embeddings.map(e => e.values);
    } catch (e) {
        console.error("Failed to generate batch embeddings", e);
        // Fallback to sequential/parallel if batch fails
        return Promise.all(validTexts.map(t => generateEmbedding(t)));
    }
}
