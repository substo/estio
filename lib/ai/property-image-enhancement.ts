import { z } from "zod";
import type {
    ImageEnhancementAnalysis,
    ImageEnhancementDetectedElement,
    ImageEnhancementSuggestedFix,
} from "@/lib/ai/property-image-enhancement-types";
import {
    buildAnalysisPrompt,
    buildGenerationPrompt,
    buildReusablePromptContext,
    getRemovedDetectedElements,
    getSelectedFixes,
} from "@/lib/ai/property-image-enhancement-prompt";

export {
    buildAnalysisPrompt,
    buildGenerationPrompt,
    buildReusablePromptContext,
} from "@/lib/ai/property-image-enhancement-prompt";

const DEFAULT_IMAGE_MIME_TYPE = "image/jpeg";
const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

const BboxSchema = z.object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().min(0).max(1),
    height: z.number().min(0).max(1),
}).strict();

const DetectedElementSchema = z.object({
    id: z.string().trim().min(1).max(120).optional(),
    label: z.string().trim().min(1).max(120),
    category: z.string().trim().min(1).max(80),
    severity: z.enum(["low", "medium", "high"]).default("medium"),
    confidence: z.number().min(0).max(1).default(0.6),
    rationale: z.string().trim().max(300).optional(),
    bbox: BboxSchema.optional(),
}).strict();

const SuggestedFixSchema = z.object({
    id: z.string().trim().min(1).max(120).optional(),
    label: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(280),
    impact: z.enum(["low", "medium", "high"]).default("medium"),
    defaultSelected: z.boolean().default(true),
    promptInstruction: z.string().trim().min(1).max(400),
}).strict();

const AnalysisSchema = z.object({
    sceneSummary: z.string().trim().min(1).max(600).default("Property listing photo ready for technical enhancement."),
    sceneContext: z.string().trim().min(1).max(2000).optional(),
    promptPolish: z.string().trim().min(1).max(4000).optional(),
    detectedElements: z.array(DetectedElementSchema).max(40).default([]),
    suggestedFixes: z.array(SuggestedFixSchema).max(40).default([]),
    actionLogDraft: z.array(z.string().trim().min(1).max(200)).max(30).default([]),
}).strict();

type ParsedDetectedElement = z.infer<typeof DetectedElementSchema>;
type ParsedSuggestedFix = z.infer<typeof SuggestedFixSchema>;

type GeminiGenerateContentResponse = {
    candidates?: Array<{
        content?: {
            parts?: Array<{
                text?: string;
                inline_data?: { mime_type?: string; data?: string };
                inlineData?: { mimeType?: string; data?: string };
            }>;
        };
    }>;
    promptFeedback?: unknown;
    usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        totalTokenCount?: number;
    };
};

type AnalyzeImageForEnhancementInput = {
    apiKey: string;
    model: string;
    sourceImageBase64: string;
    sourceImageMimeType: string;
    priorPrompt?: string;
    userInstructions?: string;
};

type GenerateEnhancedImageInput = {
    apiKey: string;
    model: string;
    sourceImageBase64: string;
    sourceImageMimeType: string;
    analysis: ImageEnhancementAnalysis;
    selectedFixIds: string[];
    removedDetectedElementIds?: string[];
    aggression: "conservative" | "balanced" | "aggressive";
    priorPrompt?: string;
    userInstructions?: string;
};

type GenerateEnhancedImageResult = {
    imageBase64: string;
    mimeType: string;
    actionLog: string[];
    finalPrompt: string;
    reusablePrompt: string;
    model: string;
    usageMetadata?: GeminiGenerateContentResponse["usageMetadata"];
};

function toSingleLine(text: string): string {
    return String(text || "").replace(/\s+/g, " ").trim();
}

function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
}

function slugifyId(raw: string): string {
    const slug = String(raw || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
    return slug;
}

function normalizeElement(
    element: ParsedDetectedElement,
    index: number
): ImageEnhancementDetectedElement {
    const label = toSingleLine(element.label) || `Element ${index + 1}`;
    return {
        id: slugifyId(element.id || label) || `element_${index + 1}`,
        label,
        category: toSingleLine(element.category) || "scene",
        severity: element.severity || "medium",
        confidence: clamp01(Number(element.confidence)),
        rationale: element.rationale ? toSingleLine(element.rationale) : undefined,
        bbox: element.bbox,
    };
}

function normalizeFix(
    fix: ParsedSuggestedFix,
    index: number
): ImageEnhancementSuggestedFix {
    const label = toSingleLine(fix.label) || `Fix ${index + 1}`;
    return {
        id: slugifyId(fix.id || label) || `fix_${index + 1}`,
        label,
        description: toSingleLine(fix.description) || "Improve this issue for listing-quality presentation.",
        impact: fix.impact || "medium",
        defaultSelected: fix.defaultSelected !== false,
        promptInstruction: toSingleLine(fix.promptInstruction) || `Improve ${label.toLowerCase()}.`,
    };
}

function requireSelectedModel(model: string, step: "analysis" | "generation"): string {
    const normalized = String(model || "").trim();
    if (!normalized) {
        throw new Error(`A compatible ${step} model is required.`);
    }
    return normalized;
}

export function parseJsonObjectFromModelText(rawText: string): Record<string, unknown> | null {
    const clean = String(rawText || "")
        .replace(/```json/gi, "")
        .replace(/```/g, "")
        .trim();

    if (!clean) return null;

    try {
        const parsed = JSON.parse(clean);
        return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
    } catch {
        const firstBrace = clean.indexOf("{");
        const lastBrace = clean.lastIndexOf("}");
        if (firstBrace >= 0 && lastBrace > firstBrace) {
            try {
                const parsed = JSON.parse(clean.slice(firstBrace, lastBrace + 1));
                return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
            } catch {
                return null;
            }
        }
        return null;
    }
}

export function normalizeImageEnhancementAnalysis(raw: unknown): ImageEnhancementAnalysis {
    const parsed = AnalysisSchema.safeParse(raw);
    if (!parsed.success) {
        return {
            sceneSummary: "Property listing photo with opportunities for composition, lighting, and cleanup improvements.",
            sceneContext: "Property photo showing the true room layout, materials, and lighting conditions for a realistic listing-photo enhancement.",
            detectedElements: [],
            suggestedFixes: [],
            actionLogDraft: [],
        };
    }

    const normalizedElements = parsed.data.detectedElements.map(normalizeElement);
    const normalizedFixes = parsed.data.suggestedFixes.map(normalizeFix);
    const uniqueFixes = new Map<string, ImageEnhancementSuggestedFix>();
    for (const fix of normalizedFixes) {
        if (!uniqueFixes.has(fix.id)) uniqueFixes.set(fix.id, fix);
    }

    return {
        sceneSummary: toSingleLine(parsed.data.sceneSummary),
        sceneContext: toSingleLine(parsed.data.sceneContext || parsed.data.promptPolish || parsed.data.sceneSummary),
        detectedElements: normalizedElements,
        suggestedFixes: Array.from(uniqueFixes.values()),
        actionLogDraft: parsed.data.actionLogDraft.map((line) => toSingleLine(line)).filter(Boolean),
    };
}

function getTextPartsFromResponse(response: GeminiGenerateContentResponse): string[] {
    const lines: string[] = [];
    for (const candidate of response.candidates || []) {
        for (const part of candidate.content?.parts || []) {
            if (typeof part.text === "string" && part.text.trim()) {
                lines.push(part.text.trim());
            }
        }
    }
    return lines;
}

function getFirstInlineImageFromResponse(response: GeminiGenerateContentResponse): { mimeType: string; data: string } | null {
    for (const candidate of response.candidates || []) {
        for (const part of candidate.content?.parts || []) {
            const inlineLegacy = part.inline_data;
            if (inlineLegacy?.data) {
                return {
                    mimeType: inlineLegacy.mime_type || "image/png",
                    data: inlineLegacy.data,
                };
            }
            const inlineCamel = part.inlineData;
            if (inlineCamel?.data) {
                return {
                    mimeType: inlineCamel.mimeType || "image/png",
                    data: inlineCamel.data,
                };
            }
        }
    }
    return null;
}

async function callGeminiGenerateContent(input: {
    apiKey: string;
    model: string;
    body: Record<string, unknown>;
}): Promise<GeminiGenerateContentResponse> {
    const apiKey = String(input.apiKey || "").trim();
    if (!apiKey) {
        throw new Error("Google AI API key is missing.");
    }

    const url = `${GEMINI_API_BASE_URL}/${input.model}:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input.body),
    });

    if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new Error(`Gemini request failed (${response.status}): ${errorText || response.statusText}`);
    }

    const data = await response.json() as GeminiGenerateContentResponse;
    return data;
}

function normalizeImageMimeType(contentType: string | null | undefined, imageUrl?: string): string {
    const normalized = String(contentType || "").toLowerCase().split(";")[0].trim();
    if (normalized.startsWith("image/")) {
        return normalized;
    }

    const lowerUrl = String(imageUrl || "").toLowerCase();
    if (lowerUrl.endsWith(".png")) return "image/png";
    if (lowerUrl.endsWith(".webp")) return "image/webp";
    if (lowerUrl.endsWith(".gif")) return "image/gif";
    return DEFAULT_IMAGE_MIME_TYPE;
}

export async function fetchImageBuffer(imageUrl: string): Promise<{ mimeType: string; buffer: Buffer }> {
    const normalizedUrl = String(imageUrl || "").trim();
    if (!normalizedUrl) {
        throw new Error("Source image URL is required.");
    }

    const response = await fetch(normalizedUrl, {
        method: "GET",
        cache: "no-store",
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch source image (${response.status}).`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (!buffer.length) {
        throw new Error("Source image is empty.");
    }

    return {
        mimeType: normalizeImageMimeType(response.headers.get("content-type"), normalizedUrl),
        buffer,
    };
}

export async function fetchImageAsInlineData(imageUrl: string): Promise<{ mimeType: string; base64: string }> {
    const source = await fetchImageBuffer(imageUrl);
    return {
        mimeType: source.mimeType,
        base64: source.buffer.toString("base64"),
    };
}

export async function analyzeImageForEnhancement(input: AnalyzeImageForEnhancementInput): Promise<{
    analysis: ImageEnhancementAnalysis;
    model: string;
    usageMetadata?: GeminiGenerateContentResponse["usageMetadata"];
}> {
    const model = requireSelectedModel(input.model, "analysis");
    const prompt = buildAnalysisPrompt({
        priorPrompt: input.priorPrompt,
        userInstructions: input.userInstructions,
    });
    const response = await callGeminiGenerateContent({
        apiKey: input.apiKey,
        model,
        body: {
            contents: [{
                parts: [
                    { text: prompt },
                    {
                        inline_data: {
                            mime_type: input.sourceImageMimeType || DEFAULT_IMAGE_MIME_TYPE,
                            data: input.sourceImageBase64,
                        },
                    },
                ],
            }],
            generationConfig: {
                responseMimeType: "application/json",
                temperature: 0.2,
            },
        },
    });

    const textOutput = getTextPartsFromResponse(response).join("\n").trim();
    const parsedJson = parseJsonObjectFromModelText(textOutput);
    const analysis = normalizeImageEnhancementAnalysis(parsedJson);

    return { analysis, model, usageMetadata: response.usageMetadata };
}

function normalizeActionLog(lines: string[]): string[] {
    const normalized = lines
        .flatMap((line) => line.split("\n"))
        .map((line) => line.replace(/^[-*•\d.\s]+/, "").trim())
        .filter(Boolean);
    const deduped = Array.from(new Set(normalized));
    return deduped.slice(0, 12);
}

export async function generateEnhancedImage(input: GenerateEnhancedImageInput): Promise<GenerateEnhancedImageResult> {
    const model = requireSelectedModel(input.model, "generation");
    const prompt = buildGenerationPrompt({
        analysis: input.analysis,
        selectedFixIds: input.selectedFixIds,
        removedDetectedElementIds: input.removedDetectedElementIds,
        aggression: input.aggression,
        priorPrompt: input.priorPrompt,
        userInstructions: input.userInstructions,
    });
    const reusablePrompt = buildReusablePromptContext({
        analysis: input.analysis,
        selectedFixIds: input.selectedFixIds,
        removedDetectedElementIds: input.removedDetectedElementIds,
        aggression: input.aggression,
        userInstructions: input.userInstructions,
    });

    const response = await callGeminiGenerateContent({
        apiKey: input.apiKey,
        model,
        body: {
            contents: [{
                parts: [
                    { text: prompt },
                    {
                        inline_data: {
                            mime_type: input.sourceImageMimeType || DEFAULT_IMAGE_MIME_TYPE,
                            data: input.sourceImageBase64,
                        },
                    },
                ],
            }],
            generationConfig: {
                responseModalities: ["IMAGE", "TEXT"],
            },
        },
    });

    const image = getFirstInlineImageFromResponse(response);
    if (!image?.data) {
        throw new Error("The model did not return an image output.");
    }

    const modelTextParts = getTextPartsFromResponse(response);
    const removedElements = getRemovedDetectedElements(input.analysis, input.removedDetectedElementIds || []);
    const fallbackActionLog = input.analysis.actionLogDraft.length > 0
        ? input.analysis.actionLogDraft
        : [
            ...getSelectedFixes(input.analysis, input.selectedFixIds).map((fix) => fix.label),
            ...removedElements.map((element) => `Remove ${element.label}`),
        ];

    const actionLog = normalizeActionLog([
        ...modelTextParts,
        ...fallbackActionLog,
    ]);

    return {
        imageBase64: image.data,
        mimeType: image.mimeType || "image/png",
        actionLog,
        finalPrompt: prompt,
        reusablePrompt,
        model,
        usageMetadata: response.usageMetadata,
    };
}
