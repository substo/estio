import { GoogleGenerativeAI } from "@google/generative-ai";
import db from "@/lib/db";
import { getModelForTask } from "./model-router";

interface CallLLMOptions {
    jsonMode?: boolean;
    temperature?: number;
}

/**
 * Standardized wrapper for calling Gemini models.
 * Handles API key retrieval and model instantiation.
 */
export async function callLLM(
    modelId: string,
    systemPrompt: string,
    userContent?: string,
    options: CallLLMOptions = {}
): Promise<string> {
    // 1. Get API Key (try Env first, then DB config)
    // In a real app we might pass locationId to get specific config
    // For now, we default to env or generic site config if needed
    let apiKey = process.env.GOOGLE_API_KEY;

    if (!apiKey) {
        // Fallback: try to find ANY site config with a key
        // This is a bit hacky but works for single-tenant or simplified contexts
        const config = await db.siteConfig.findFirst({
            where: { googleAiApiKey: { not: null } }
        });
        apiKey = config?.googleAiApiKey || undefined;
    }

    if (!apiKey) throw new Error("No AI API Key found");

    const genAI = new GoogleGenerativeAI(apiKey);

    const model = genAI.getGenerativeModel({
        model: modelId,
        generationConfig: {
            responseMimeType: options.jsonMode ? "application/json" : "text/plain",
            temperature: options.temperature
        }
    });

    const prompt = userContent
        ? [systemPrompt, userContent]
        : [systemPrompt];

    const result = await model.generateContent(prompt);
    return result.response.text();
}

/**
 * Extended wrapper that returns usage metadata along with text.
 */
export async function callLLMWithMetadata(
    modelId: string,
    systemPrompt: string,
    userContent?: string,
    options: CallLLMOptions = {}
): Promise<{ text: string; usage: { promptTokens: number; completionTokens: number; totalTokens: number } }> {
    // 1. Get API Key
    let apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
        const config = await db.siteConfig.findFirst({
            where: { googleAiApiKey: { not: null } }
        });
        apiKey = config?.googleAiApiKey || undefined;
    }
    if (!apiKey) throw new Error("No AI API Key found");

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
        model: modelId,
        generationConfig: {
            responseMimeType: options.jsonMode ? "application/json" : "text/plain",
            temperature: options.temperature
        }
    });

    const prompt = userContent ? [systemPrompt, userContent] : [systemPrompt];
    const result = await model.generateContent(prompt);

    // Safety check for usageMetadata (it might be undefined in some cases)
    const usage = result.response.usageMetadata || { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 };

    return {
        text: result.response.text(),
        usage: {
            promptTokens: usage.promptTokenCount,
            completionTokens: usage.candidatesTokenCount,
            totalTokens: usage.totalTokenCount
        }
    };
}
