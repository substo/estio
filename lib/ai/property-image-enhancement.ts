import { z } from "zod";
import type {
    EnhancementAggression,
    EnhancementModelTier,
    ImageEnhancementAnalysis,
    ImageEnhancementDetectedElement,
    ImageEnhancementSuggestedFix,
} from "@/lib/ai/property-image-enhancement-types";

export const PROPERTY_IMAGE_ENHANCEMENT_MODELS: Record<EnhancementModelTier, string> = {
    nano_banana_2: "gemini-2.5-flash-image",
    nano_banana_pro: "gemini-3-pro-image-preview",
};

const DEFAULT_IMAGE_MIME_TYPE = "image/jpeg";
const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

const ENHANCEMENT_BASE_POLICY_PROMPT = `
Role: You are an Expert AI Image Enhancer and Photoshop Specialist focused on real-estate listing photos.
Objective: Transform flawed mobile photos into professional, photoreal, listing-ready images while preserving truthfulness of the property.

Core protocol:
- Fix framing (horizon tilt, awkward crop) and improve composition.
- Improve technical quality (noise, softness, exposure, white balance, color consistency).
- Remove distractions and clutter that reduce listing quality.
- Keep materials, architecture, and layout realistic.
- Never add misleading structural elements that change what the property is.
`.trim();

const AGGRESSION_GUIDANCE: Record<EnhancementAggression, string> = {
    conservative: "Conservative mode: minimal intervention. Preserve geometry, layout, and materials strictly. Only correct technical defects and obvious distractions.",
    balanced: "Balanced mode: moderate enhancement. Improve composition, lighting, and cleanup while preserving scene identity and property truthfulness.",
    aggressive: "Aggressive mode: stronger polish and cleanup allowed, but still photoreal and truthful to the property. Do not invent misleading property features.",
};

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
    detectedElements: z.array(DetectedElementSchema).max(40).default([]),
    suggestedFixes: z.array(SuggestedFixSchema).max(40).default([]),
    promptPolish: z.string().trim().min(1).max(4000).default("Enhance this real-estate photo professionally while preserving photoreal property truth."),
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
};

type AnalyzeImageForEnhancementInput = {
    apiKey: string;
    sourceImageBase64: string;
    sourceImageMimeType: string;
    modelTier?: EnhancementModelTier;
    priorPrompt?: string;
    userInstructions?: string;
};

type GenerateEnhancedImageInput = {
    apiKey: string;
    sourceImageBase64: string;
    sourceImageMimeType: string;
    analysis: ImageEnhancementAnalysis;
    selectedFixIds: string[];
    aggression: EnhancementAggression;
    modelTier?: EnhancementModelTier;
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

export function resolveEnhancementModelForTier(tier?: EnhancementModelTier): string {
    const target = tier && tier in PROPERTY_IMAGE_ENHANCEMENT_MODELS
        ? tier
        : "nano_banana_2";
    return PROPERTY_IMAGE_ENHANCEMENT_MODELS[target];
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
            detectedElements: [],
            suggestedFixes: [],
            promptPolish: "Create a professional, photoreal, listing-ready version of this property photo while preserving scene truthfulness.",
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
        detectedElements: normalizedElements,
        suggestedFixes: Array.from(uniqueFixes.values()),
        promptPolish: String(parsed.data.promptPolish || "").trim(),
        actionLogDraft: parsed.data.actionLogDraft.map((line) => toSingleLine(line)).filter(Boolean),
    };
}

export function buildAnalysisPrompt(input?: { priorPrompt?: string; userInstructions?: string }): string {
    const priorPrompt = String(input?.priorPrompt || "").trim();
    const userInstructions = String(input?.userInstructions || "").trim();
    return `
${ENHANCEMENT_BASE_POLICY_PROMPT}

Task:
1) Analyze the input property photo.
2) Identify scene elements and concrete listing-quality issues.
3) Propose practical fixes users can toggle on/off in UI chips.
4) Produce a polished generation prompt for the next step.

Output strict JSON only:
{
  "sceneSummary": "string",
  "detectedElements": [
    {
      "id": "string",
      "label": "string",
      "category": "string",
      "severity": "low|medium|high",
      "confidence": 0.0,
      "rationale": "string",
      "bbox": { "x": 0.1, "y": 0.1, "width": 0.2, "height": 0.2 }
    }
  ],
  "suggestedFixes": [
    {
      "id": "string",
      "label": "string",
      "description": "string",
      "impact": "low|medium|high",
      "defaultSelected": true,
      "promptInstruction": "short imperative instruction"
    }
  ],
  "promptPolish": "string",
  "actionLogDraft": ["string"]
}

Rules:
- Keep bbox optional and normalized to 0..1 when provided.
- Keep labels concise and UI-friendly.
- Focus on real-estate listing improvements (composition, cleanup, lighting, clarity, realism).
- Do not suggest changes that misrepresent property structure.
- Pay close attention to operator-reported issues. If the user asks to inspect or remove something specific, prefer returning a candidate fix rather than omitting it entirely, unless it is clearly absent.
${userInstructions ? `\nOperator instructions / suspected issues:\n${userInstructions}` : ""}
${priorPrompt ? `\nReference legacy enhancement instructions:\n${priorPrompt}` : ""}
`.trim();
}

export function buildGenerationPrompt(input: {
    analysis: ImageEnhancementAnalysis;
    selectedFixIds: string[];
    aggression: EnhancementAggression;
    priorPrompt?: string;
    userInstructions?: string;
}): string {
    const selectedSet = new Set((input.selectedFixIds || []).map((id) => String(id || "").trim()).filter(Boolean));
    const selectedFixes = input.analysis.suggestedFixes.filter((fix) => selectedSet.has(fix.id));
    const selectedInstructions = selectedFixes.map((fix) => `- ${fix.promptInstruction}`);
    const selectedLabels = selectedFixes.map((fix) => fix.label);
    const priorPrompt = String(input.priorPrompt || "").trim();
    const userInstructions = String(input.userInstructions || "").trim();
    const aggressionGuidance = AGGRESSION_GUIDANCE[input.aggression] || AGGRESSION_GUIDANCE.balanced;

    return `
${ENHANCEMENT_BASE_POLICY_PROMPT}

Editing mode:
${aggressionGuidance}

Scene summary:
${input.analysis.sceneSummary}

Refined prompt context:
${input.analysis.promptPolish}

User-approved fixes:
${selectedInstructions.length > 0 ? selectedInstructions.join("\n") : "- Keep composition and only apply gentle technical polish."}

Manual operator instructions:
${userInstructions ? userInstructions : "None provided."}

Important guardrails:
- Preserve room layout, dimensions, architecture, and material truthfulness.
- Remove distractions only when they are non-essential clutter.
- Keep output photoreal and listing-ready.
- No fake staging objects unless naturally implied by scene.

Response requirements:
1) Return an edited image.
2) Include a short plain-text action log line list describing applied changes.
3) If a requested fix is not feasible from this image, mention it in action log.

Selected fix labels:
${selectedLabels.length > 0 ? selectedLabels.join(", ") : "None (technical polish only)"}

${priorPrompt ? `Legacy prompt reference:\n${priorPrompt}` : ""}
`.trim();
}

export function buildReusablePromptContext(input: {
    analysis: ImageEnhancementAnalysis;
    selectedFixIds: string[];
    aggression: EnhancementAggression;
    userInstructions?: string;
}): string {
    const selectedSet = new Set((input.selectedFixIds || []).map((id) => String(id || "").trim()).filter(Boolean));
    const selectedFixes = input.analysis.suggestedFixes.filter((fix) => selectedSet.has(fix.id));
    const selectedInstructions = selectedFixes.map((fix) => `- ${fix.promptInstruction}`);
    const userInstructions = String(input.userInstructions || "").trim();
    const aggressionGuidance = AGGRESSION_GUIDANCE[input.aggression] || AGGRESSION_GUIDANCE.balanced;

    return `
Reusable enhancement context for similar property photos of the same scene:
- Keep edits consistent across adjacent shots of this room or exterior.
- ${aggressionGuidance}

Scene summary:
${input.analysis.sceneSummary}

Refined prompt context:
${input.analysis.promptPolish}

Preferred fixes:
${selectedInstructions.length > 0 ? selectedInstructions.join("\n") : "- Gentle technical polish only."}

Operator notes:
${userInstructions || "None provided."}

Global guardrails:
- Preserve architecture, layout, materials, and room proportions.
- Keep the result photoreal and listing-ready.
- Avoid introducing staged or misleading property features.
`.trim();
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
}> {
    const model = resolveEnhancementModelForTier(input.modelTier);
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

    return { analysis, model };
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
    const model = resolveEnhancementModelForTier(input.modelTier);
    const prompt = buildGenerationPrompt({
        analysis: input.analysis,
        selectedFixIds: input.selectedFixIds,
        aggression: input.aggression,
        priorPrompt: input.priorPrompt,
        userInstructions: input.userInstructions,
    });
    const reusablePrompt = buildReusablePromptContext({
        analysis: input.analysis,
        selectedFixIds: input.selectedFixIds,
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
    const fallbackActionLog = input.analysis.actionLogDraft.length > 0
        ? input.analysis.actionLogDraft
        : input.analysis.suggestedFixes
            .filter((fix) => input.selectedFixIds.includes(fix.id))
            .map((fix) => fix.label);

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
    };
}
