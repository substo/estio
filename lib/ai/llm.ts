import { withAiWorkflowInstructions } from "./workflow-capabilities";
import { GoogleGenerativeAI, type Schema } from "@google/generative-ai";
import {
    OPENAI_MODEL_VALUE_PREFIX,
    resolveOpenAiApiKey,
    stripOpenAiModelPrefix,
} from "@/lib/ai/openai-models";
import {
    callPreferredPersonalChatGptWithMetadata,
    callChatGptSubscriptionWithMetadata,
    isChatGptSubscriptionModelId,
    withChatGptSubscriptionModelPrefix,
} from "@/lib/ai/chatgpt-subscription";
import { resolveEstioGlobalGoogleAiApiKey, resolveLocationGoogleAiApiKey } from "@/lib/ai/location-google-key";
import { resolveAuthenticatedDbUserId } from "@/lib/auth/current-user";
import { CRM_DEFAULT_OUTPUT_TOKENS, loadCrmRoutePlan, runLocationCrmRoute } from "@/lib/ai/crm-route-loader";
import type { CrmRoutedOperation, CrmRouteRecord, CrmRouteStep } from "@/lib/ai/crm-routing";
import { AiProviderRejectedError, AiRouteUnavailableError } from "@/lib/ai/route-errors";
import { GEMINI_FLASH_LATEST_ALIAS } from "@/lib/ai/models";

interface CallLLMOptions {
    jsonMode?: boolean;
    jsonSchema?: Record<string, unknown>;
    jsonSchemaName?: string;
    temperature?: number;
    maxOutputTokens?: number;
    thinkingBudget?: number;
    locationId?: string;
    allowEstioGlobal?: boolean;
    executionMode?: "interactive" | "background";
    /** Which chain operation this call is (capability + task-family model). Default: shared CRM text. */
    operation?: CrmRoutedOperation;
    /** The model argument is the requester's pick for this request (it beats the Location task model on its own kind). */
    modelSelection?: "explicit" | "hint";
}

export type { CallLLMOptions };

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
    fundingScope: "user_chatgpt" | "location_chatgpt" | "location_openai" | "location_gemini" | "estio_global";
    executionMode: "interactive" | "background";
    /** Location chain record (requested vs actual kind/model and the switch reason); absent for Estio-global calls. */
    route?: CrmRouteRecord;
};

export type { LLMResultWithMetadata };

export function buildGenerationConfig(options: CallLLMOptions): Record<string, unknown> {
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
        && options.thinkingBudget >= 0
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
            format: options.jsonSchema
                ? {
                    type: "json_schema",
                    name: options.jsonSchemaName || "structured_response",
                    strict: true,
                    schema: options.jsonSchema,
                }
                : { type: "json_object" },
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
    const apiKey = await resolveOpenAiApiKey(options.locationId, {
        allowEstioGlobal: options.allowEstioGlobal === true,
    });
    if (!apiKey) {
        throw new AiRouteUnavailableError("No authorized OpenAI API connection is configured for this location.");
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

    if (!response.ok) {
        console.warn("[OpenAI] Request failed", { status: response.status, model: stripOpenAiModelPrefix(modelId) });
        throw new AiProviderRejectedError("The OpenAI connection could not complete this request. Test the connection in Settings → Integrations.", response.status);
    }

    const payload = await response.json();
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
        fundingScope: options.locationId ? "location_openai" : "estio_global",
        executionMode: options.executionMode || "background",
    };
}

const ZERO_EXTRA_USAGE = { thoughtsTokens: 0, toolUsePromptTokens: 0, cachedContentTokens: 0 };
function fromChatGpt(result: Awaited<ReturnType<typeof callChatGptSubscriptionWithMetadata>>, executionMode: "interactive" | "background"): LLMResultWithMetadata {
    return {
        text: result.text,
        provider: "chatgpt_subscription",
        model: result.model,
        usage: { promptTokens: result.usage.promptTokens, completionTokens: result.usage.completionTokens, totalTokens: result.usage.totalTokens, ...ZERO_EXTRA_USAGE, raw: result.usage.raw },
        fundingScope: result.fundingScope,
        executionMode,
    };
}

async function callGeminiWithMetadata(modelId: string, systemPrompt: string, userContent: string | undefined, options: CallLLMOptions): Promise<LLMResultWithMetadata> {
    const apiKey = options.locationId
        ? await resolveLocationGoogleAiApiKey(options.locationId)
        : options.allowEstioGlobal === true
            ? resolveEstioGlobalGoogleAiApiKey()
            : null;
    if (!apiKey) throw new AiRouteUnavailableError("No AI API Key found");

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
        model: modelId,
        generationConfig: {
            ...buildGenerationConfig(options),
            ...(options.jsonSchema ? { responseSchema: options.jsonSchema as unknown as Schema } : {}),
        },
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
        },
        fundingScope: options.locationId ? "location_gemini" : "estio_global",
        executionMode: options.executionMode || "background",
    };
}

/**
 * One step of a Location's chain on its server adapter. The requester's own ChatGPT (the chain's Codex step, interactive
 * only) and the Location's hosted ChatGPT use separate credentials: a Location step never reads a personal login.
 * `systemPrompt` must already carry the capability contract.
 */
export async function executeCrmRouteStep(
    step: CrmRouteStep,
    systemPrompt: string,
    userContent: string | undefined,
    options: CallLLMOptions & { locationId: string },
    requesterDbUserId?: string,
): Promise<LLMResultWithMetadata> {
    const executionMode = options.executionMode || "background";
    if (step.kind === "device_codex") {
        const personal = executionMode === "interactive" && requesterDbUserId
            ? await callPreferredPersonalChatGptWithMetadata(systemPrompt, userContent, {
                jsonSchema: options.jsonSchema,
                modelId: step.model,
                executionContext: { executionMode: "interactive", locationId: options.locationId, userId: requesterDbUserId },
            })
            : null;
        if (!personal) throw new AiRouteUnavailableError("Your ChatGPT isn't connected");
        return fromChatGpt(personal, "interactive");
    }
    if (step.kind === "chatgpt_subscription") {
        const result = await callChatGptSubscriptionWithMetadata(withChatGptSubscriptionModelPrefix(step.model || ""), systemPrompt, userContent, {
            jsonSchema: options.jsonSchema,
            // Location credential only: the background context never selects a personal login.
            executionContext: { executionMode: "background", locationId: options.locationId, userId: null },
        });
        return fromChatGpt(result, executionMode);
    }
    if (step.kind === "openai_key") {
        return callOpenAIWithMetadata(`${OPENAI_MODEL_VALUE_PREFIX}${stripOpenAiModelPrefix(step.model || "")}`, systemPrompt, userContent, { ...options, allowEstioGlobal: false });
    }
    if (step.kind === "gemini_key") {
        return callGeminiWithMetadata(step.model || GEMINI_FLASH_LATEST_ALIAS, systemPrompt, userContent, { ...options, allowEstioGlobal: false });
    }
    throw new AiRouteUnavailableError(`${step.label} can't run CRM requests`);
}

/** Estio-global platform calls (no Location): the model value alone picks the adapter; there is no chain. */
async function callUnroutedWithMetadata(modelId: string, systemPrompt: string, userContent: string | undefined, options: CallLLMOptions): Promise<LLMResultWithMetadata> {
    if (isOpenAiModelId(modelId)) return callOpenAIWithMetadata(modelId, systemPrompt, userContent, options);
    if (isChatGptSubscriptionModelId(modelId)) {
        const result = await callChatGptSubscriptionWithMetadata(modelId, systemPrompt, userContent, {
            jsonSchema: options.jsonSchema,
            executionContext: { executionMode: "background", locationId: null, userId: null, allowEstioGlobal: options.allowEstioGlobal },
        });
        return fromChatGpt(result, options.executionMode || "background");
    }
    return callGeminiWithMetadata(modelId || GEMINI_FLASH_LATEST_ALIAS, systemPrompt, userContent, options);
}

/**
 * Shared CRM text call. With a Location, the provider and model come from the Location's ordered chain and task-family
 * model (`modelId` is only a hint for its own connection kind, or the requester's pick with `modelSelection: "explicit"`).
 * The next step runs only when the previous one failed before generation; a started or uncertain run is never replayed.
 * Background work never uses a personal login. The result carries `route` (requested vs actual and the reason).
 */
export async function callLLMWithMetadata(
    modelId: string | null | undefined,
    systemPrompt: string,
    userContent?: string,
    options: CallLLMOptions = {}
): Promise<LLMResultWithMetadata> {
    systemPrompt = withAiWorkflowInstructions(systemPrompt, "crm_shared_text");
    const model = String(modelId || "").trim();
    const locationId = String(options.locationId || "").trim();
    if (!locationId) return callUnroutedWithMetadata(model, systemPrompt, userContent, options);

    const interactive = options.executionMode === "interactive";
    const requesterDbUserId = interactive ? await resolveAuthenticatedDbUserId() || undefined : undefined;
    const plan = await loadCrmRoutePlan({
        locationId, operation: options.operation, interactive: interactive && !!requesterDbUserId,
        hintModel: model || null, explicitModel: options.modelSelection === "explicit",
    });
    const maxOutputTokens = Number.isFinite(options.maxOutputTokens) && options.maxOutputTokens! > 0
        ? Math.max(1, Math.floor(options.maxOutputTokens!)) : CRM_DEFAULT_OUTPUT_TOKENS;
    const routed = await runLocationCrmRoute(plan, locationId,
        { inputChars: systemPrompt.length + (userContent?.length ?? 0) + JSON.stringify(options.jsonSchema ?? "").length, outputTokens: maxOutputTokens + (options.thinkingBudget ?? 0) },
        step => executeCrmRouteStep(step, systemPrompt, userContent, { ...options, locationId, maxOutputTokens }, requesterDbUserId),
        value => ({
            model: value.model,
            inputTokens: value.usage.promptTokens + value.usage.toolUsePromptTokens,
            outputTokens: value.usage.completionTokens + value.usage.thoughtsTokens,
        }));
    const route = { ...routed.route, actual: { kind: routed.step.kind, model: routed.value.model } };
    console.info("[AI route]", JSON.stringify({ locationId, ...route }));
    return { ...routed.value, route };
}

/** Text-only form of callLLMWithMetadata (same routing). */
export async function callLLM(
    modelId: string | null | undefined,
    systemPrompt: string,
    userContent?: string,
    options: CallLLMOptions = {}
): Promise<string> {
    return (await callLLMWithMetadata(modelId, systemPrompt, userContent, options)).text;
}

/** For callers that persist usage rows: the route as metadata fields. */
export function routeUsageMetadata(result: Pick<LLMResultWithMetadata, "route">): Record<string, unknown> {
    const route = result.route;
    if (!route) return {};
    return {
        routeOperation: route.operation,
        requestedKind: route.requested?.kind ?? null,
        requestedModel: route.requested?.model ?? null,
        actualKind: route.actual.kind,
        actualModel: route.actual.model,
        switchReason: route.switchReason,
    };
}
