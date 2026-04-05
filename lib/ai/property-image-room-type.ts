import {
    PROPERTY_IMAGE_ROOM_TYPE_PRESETS,
    PROPERTY_IMAGE_ROOM_TYPE_UNCLASSIFIED_KEY,
    resolvePropertyImageRoomType,
} from "@/lib/ai/property-image-room-types";
import type { PropertyImageRoomType } from "@/lib/ai/property-image-enhancement-types";

const DEFAULT_IMAGE_MIME_TYPE = "image/jpeg";
const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

type GeminiGenerateContentResponse = {
    candidates?: Array<{
        content?: {
            parts?: Array<{
                text?: string;
            }>;
        };
    }>;
    usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        totalTokenCount?: number;
    };
};

function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
}

function parseJsonObjectFromModelText(rawText: string): Record<string, unknown> | null {
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

async function callGeminiGenerateContent(input: {
    apiKey: string;
    model: string;
    body: Record<string, unknown>;
}): Promise<GeminiGenerateContentResponse> {
    const apiKey = String(input.apiKey || "").trim();
    if (!apiKey) {
        throw new Error("Google AI API key is missing.");
    }

    const model = String(input.model || "").trim();
    if (!model) {
        throw new Error("A compatible analysis model is required.");
    }

    const url = `${GEMINI_API_BASE_URL}/${model}:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input.body),
    });

    if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new Error(`Gemini request failed (${response.status}): ${errorText || response.statusText}`);
    }

    return await response.json() as GeminiGenerateContentResponse;
}

function buildRoomTypePredictionPrompt(): string {
    const presetList = PROPERTY_IMAGE_ROOM_TYPE_PRESETS
        .map((preset) => `- ${preset.key}: ${preset.label}`)
        .join("\n");

    return `
Role: You classify real-estate listing photos into room or scene types.

Task:
1) Inspect the image.
2) Return the most likely room/scene type.
3) Return up to 5 ranked candidates.

Output strict JSON only:
{
  "suggestedRoomType": {
    "key": "string",
    "label": "string",
    "confidence": 0.0
  },
  "candidates": [
    {
      "key": "string",
      "label": "string",
      "confidence": 0.0
    }
  ]
}

Preferred preset keys:
${presetList}

Rules:
- Prefer preset keys when possible.
- If the scene does not fit a preset clearly, return a concise custom label and a slug-style key.
- If uncertain, use key "${PROPERTY_IMAGE_ROOM_TYPE_UNCLASSIFIED_KEY}" with confidence <= 0.55.
- confidence must be 0..1.
`.trim();
}

function normalizeRoomTypeCandidate(input: unknown): PropertyImageRoomType | null {
    if (!input || typeof input !== "object" || Array.isArray(input)) return null;
    const source = input as Record<string, unknown>;
    const resolved = resolvePropertyImageRoomType({
        key: typeof source.key === "string" ? source.key : "",
        label: typeof source.label === "string" ? source.label : "",
        confidence: Number(source.confidence),
    });

    return {
        key: resolved.key,
        label: resolved.label,
        confidence: clamp01(Number(resolved.confidence)),
    };
}

export async function predictPropertyImageRoomType(input: {
    apiKey: string;
    model: string;
    sourceImageBase64: string;
    sourceImageMimeType?: string;
}): Promise<{
    suggestedRoomType: PropertyImageRoomType;
    candidates: PropertyImageRoomType[];
    model: string;
    usageMetadata?: GeminiGenerateContentResponse["usageMetadata"];
}> {
    const model = String(input.model || "").trim();
    if (!model) {
        throw new Error("A compatible analysis model is required.");
    }

    const response = await callGeminiGenerateContent({
        apiKey: input.apiKey,
        model,
        body: {
            contents: [{
                parts: [
                    { text: buildRoomTypePredictionPrompt() },
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
                temperature: 0.1,
            },
        },
    });

    const textOutput = getTextPartsFromResponse(response).join("\n").trim();
    const parsedJson = parseJsonObjectFromModelText(textOutput) || {};
    const rawSuggested = normalizeRoomTypeCandidate(parsedJson.suggestedRoomType) || resolvePropertyImageRoomType();

    const rawCandidates = Array.isArray(parsedJson.candidates) ? parsedJson.candidates : [];
    const deduped = new Map<string, PropertyImageRoomType>();

    for (const item of rawCandidates) {
        const candidate = normalizeRoomTypeCandidate(item);
        if (!candidate) continue;
        if (!deduped.has(candidate.key)) {
            deduped.set(candidate.key, candidate);
        }
        if (deduped.size >= 5) break;
    }

    if (!deduped.has(rawSuggested.key)) {
        deduped.set(rawSuggested.key, {
            ...rawSuggested,
            confidence: clamp01(Number(rawSuggested.confidence)),
        });
    }

    const candidates = Array.from(deduped.values())
        .sort((a, b) => (Number(b.confidence || 0) - Number(a.confidence || 0)))
        .slice(0, 5);

    return {
        suggestedRoomType: {
            ...rawSuggested,
            confidence: clamp01(Number(rawSuggested.confidence || 0)),
        },
        candidates,
        model,
        usageMetadata: response.usageMetadata,
    };
}
