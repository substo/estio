
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { generateEmbedding } from "../embeddings";
import { DEFERRED_TOOLS } from "./tool-categories";
import { toolRegistry } from "./registry";

interface ToolMetadata {
    name: string;
    description: string;
    embedding: number[];
    schema: Record<string, any>;
}

// Pre-computed embeddings for all deferred tool descriptions
let toolIndex: ToolMetadata[] = [];
let toolIndexBuiltWithApiKey: string | null = null;

function getDeferredTools() {
    return toolRegistry.filter(t => DEFERRED_TOOLS.includes(t.name));
}

async function buildToolIndex(deferredTools: { name: string; description: string; inputSchema: Record<string, any> }[], apiKey: string) {
    toolIndex = [];
    for (const tool of deferredTools) {
        try {
            const embedding = await generateEmbedding(tool.description || tool.name, apiKey);
            if (embedding.length > 0) {
                toolIndex.push({
                    name: tool.name,
                    description: tool.description || "",
                    embedding,
                    schema: tool.inputSchema,
                });
            }
        } catch (e) {
            console.error(`Failed to index tool ${tool.name}`, e);
        }
    }
    toolIndexBuiltWithApiKey = apiKey;
}

/**
 * Initialize the tool search index at server startup.
 * Embeds all deferred tool descriptions for semantic search.
 */
export async function initToolSearchIndex(server: McpServer) {
    const allTools = toolRegistry;
    const deferredTools = getDeferredTools();

    console.log(`Analyzing ${allTools.length} tools. Found ${deferredTools.length} deferred tools to index.`);

    if (deferredTools.length === 0) {
        return;
    }

    const bootstrapApiKey = process.env.GOOGLE_API_KEY;
    if (!bootstrapApiKey) {
        // Do not warn during builds/deploys; per-location key can be used lazily at runtime.
        toolIndex = [];
        toolIndexBuiltWithApiKey = null;
        console.log("Tool Search Index: deferred indexing skipped (no global GOOGLE_API_KEY at bootstrap).");
        return;
    }

    // Note: We're doing this sequentially here for simplicity and to avoid rate limits if any.
    await buildToolIndex(deferredTools, bootstrapApiKey);

    console.log(`Tool Search Index: ${toolIndex.length} deferred tools indexed`);
}

/**
 * Search for relevant tools based on a natural language query.
 * Returns the top-K tools that match the query semantically.
 */
export async function searchTools(
    query: string,
    maxResults: number = 3,
    apiKey?: string
): Promise<ToolMetadata[]> {
    const effectiveApiKey = apiKey || process.env.GOOGLE_API_KEY;

    // Lazy-build the deferred tool index with the runtime/location API key when needed.
    if (effectiveApiKey && (toolIndex.length === 0 || toolIndexBuiltWithApiKey !== effectiveApiKey)) {
        await buildToolIndex(getDeferredTools(), effectiveApiKey);
    }

    const queryEmbedding = await generateEmbedding(query, effectiveApiKey);
    if (queryEmbedding.length === 0) return [];

    // Compute cosine similarity against all deferred tools
    const scored = toolIndex.map(tool => ({
        ...tool,
        similarity: cosineSimilarity(queryEmbedding, tool.embedding),
    }));

    // Return top matches above threshold
    // Initial threshold can be 0.3 or higher depending on embedding quality
    return scored
        .filter(t => t.similarity > 0.3)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, maxResults);
}

function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    const dot = a.reduce((sum, ai, i) => sum + ai * b[i], 0);
    const magA = Math.sqrt(a.reduce((sum, ai) => sum + ai * ai, 0));
    const magB = Math.sqrt(b.reduce((sum, bi) => sum + bi * bi, 0));
    return magA && magB ? dot / (magA * magB) : 0;
}
