import { GoogleGenerativeAI } from "@google/generative-ai";
import db from "@/lib/db";
import {
    OPENAI_MODEL_VALUE_PREFIX,
    resolveOpenAiApiKey,
    stripOpenAiModelPrefix,
} from "@/lib/ai/openai-models";
import {
    callChatGptSubscriptionWithMetadata,
    isChatGptSubscriptionModelId,
} from "@/lib/ai/chatgpt-subscription";

interface CallLLMOptions {
    jsonMode?: boolean;
    temperature?: number;
    maxOutputTokens?: number;
    thinkingBudget?: number;
    locationId?: string;
}

type LLMUsage = {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    thoughtsTokens: number;
    toolUsePromptTokens: number;
    cachedContentTokens: number;
    raw: string;
};

type LLMResultWithMetadata = {
    text: string;
    provider: "google_gemini" | "openai" | "chatgpt_subscription";
    model: string;
    usage: LLMUsage;
};

function buildGenerationConfig(options: CallLLMOptions): Record<string, unknown> {
    const generationConfig: Record<string, unknown> = {
        responseMimeType: options.jsonMode ? "application/json" : "text/plain",
    };

    if (typeof options.temperature === "number" && Number.isFinite(options.temperature)) {
        generationConfig.temperature = options.temperature;
    }

    if (
        typeof options.maxOutputTokens === "number"
        && Number.isFinite(options.maxOutputTokens)
        && options.maxOutputTokens > 0
    ) {
        generationConfig.maxOutputTokens = Math.floor(options.maxOutputTokens);
    }

    if (
        typeof options.thinkingBudget === "number"
        && Number.isFinite(options.thinkingBudget)
        && options.thinkingBudget > 0
    ) {
        generationConfig.thinkingConfig = {
            thinkingBudget: Math.floor(options.thinkingBudget),
        };
    }

    return generationConfig;
}

function isOpenAiModelId(modelId: string): boolean {
    return String(modelId || "").trim().startsWith(OPENAI_MODEL_VALUE_PREFIX);
}

function readUsageCount(source: Record<string, unknown>, key: string): number {
    const value = Number(source[key]);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function readNestedUsageCount(source: Record<string, unknown>, objectKey: string, key: string): number {
    const nested = source[objectKey];
    if (!nested || typeof nested !== "object") return 0;
    return readUsageCount(nested as Record<string, unknown>, key);
}

function extractOpenAiOutputText(response: any): string {
    const directText = typeof response?.output_text === "string" ? response.output_text.trim() : "";
    if (directText) return directText;

    const output = Array.isArray(response?.output) ? response.output : [];
    const chunks: string[] = [];
    for (const item of output) {
        const content = Array.isArray(item?.content) ? item.content : [];
        for (const part of content) {
            const text = typeof part?.text === "string"
                ? part.text
                : typeof part?.content === "string"
                    ? part.content
                    : "";
            if (text) chunks.push(text);
        }
    }
    return chunks.join("\n").trim();
}

function buildOpenAiRequestBody(modelId: string, systemPrompt: string, userContent: string | undefined, options: CallLLMOptions) {
    const body: Record<string, unknown> = {
        model: stripOpenAiModelPrefix(modelId),
        instructions: systemPrompt,
        input: userContent || "",
    };

    if (typeof options.temperature === "number" && Number.isFinite(options.temperature)) {
        body.temperature = options.temperature;
    }

    if (
        typeof options.maxOutputTokens === "number"
        && Number.isFinite(options.maxOutputTokens)
        && options.maxOutputTokens > 0
    ) {
        body.max_output_tokens = Math.floor(options.maxOutputTokens);
    }

    if (options.jsonMode) {
        body.text = {
            format: { type: "json_object" },
        };
    }

    return body;
}

async function callOpenAIWithMetadata(
    modelId: string,
    systemPrompt: string,
    userContent?: string,
    options: CallLLMOptions = {}
): Promise<LLMResultWithMetadata> {
    const apiKey = await resolveOpenAiApiKey(options.locationId);
    if (!apiKey) {
        throw new Error("No OpenAI API key configured. Add a personal or organization OpenAI key in Settings > Integrations > OpenAI.");
    }

    const requestBody = buildOpenAiRequestBody(modelId, systemPrompt, userContent, options);
    const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
        const message = payload?.error?.message || `${response.status} ${response.statusText}`;
        throw new Error(`OpenAI request failed: ${message}`);
    }

    const text = extractOpenAiOutputText(payload);
    if (!text) {
        throw new Error("OpenAI response was empty.");
    }

    const usage = (payload?.usage || {}) as Record<string, unknown>;
    const inputTokens = readUsageCount(usage, "input_tokens");
    const outputTokens = readUsageCount(usage, "output_tokens");
    const totalTokens = readUsageCount(usage, "total_tokens") || inputTokens + outputTokens;

    return {
        text,
        provider: "openai",
        model: stripOpenAiModelPrefix(modelId),
        usage: {
            promptTokens: inputTokens,
            completionTokens: outputTokens,
            totalTokens,
            thoughtsTokens: 0,
            toolUsePromptTokens: 0,
            cachedContentTokens: readNestedUsageCount(usage, "input_tokens_details", "cached_tokens"),
            raw: JSON.stringify(usage),
        },
    };
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
    if (isOpenAiModelId(modelId)) {
        const result = await callOpenAIWithMetadata(modelId, systemPrompt, userContent, options);
        return result.text;
    }
    if (isChatGptSubscriptionModelId(modelId)) {
        const result = await callChatGptSubscriptionWithMetadata(modelId, systemPrompt, userContent);
        return result.text;
    }

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
        generationConfig: buildGenerationConfig(options),
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
): Promise<LLMResultWithMetadata> {
    if (isOpenAiModelId(modelId)) {
        return callOpenAIWithMetadata(modelId, systemPrompt, userContent, options);
    }
    if (isChatGptSubscriptionModelId(modelId)) {
        const result = await callChatGptSubscriptionWithMetadata(modelId, systemPrompt, userContent);
        return {
            text: result.text,
            provider: "chatgpt_subscription",
            model: result.model,
            usage: {
                promptTokens: result.usage.promptTokens,
                completionTokens: result.usage.completionTokens,
                totalTokens: result.usage.totalTokens,
                thoughtsTokens: 0,
                toolUsePromptTokens: 0,
                cachedContentTokens: 0,
                raw: result.usage.raw,
            },
        };
    }

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
        generationConfig: buildGenerationConfig(options),
    });

    const prompt = userContent ? [systemPrompt, userContent] : [systemPrompt];
    const result = await model.generateContent(prompt);

    // Safety check for usageMetadata (it might be undefined in some cases)
    const usageMeta = (result.response.usageMetadata || {}) as Record<string, unknown>;
    const readUsage = (key: string) => {
        const value = Number(usageMeta[key]);
        return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
    };

    return {
        text: result.response.text(),
        provider: "google_gemini",
        model: modelId,
        usage: {
            promptTokens: readUsage("promptTokenCount"),
            completionTokens: readUsage("candidatesTokenCount"),
            totalTokens: readUsage("totalTokenCount"),
            thoughtsTokens: readUsage("thoughtsTokenCount"),
            toolUsePromptTokens: readUsage("toolUsePromptTokenCount"),
            cachedContentTokens: readUsage("cachedContentTokenCount"),
            raw: JSON.stringify(usageMeta)
        }
    };
}
