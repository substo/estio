import sharp from "sharp";
import { DEFAULT_EDITOR_MAX_LONG_EDGE, resolveEditorDimensions } from "@/lib/ai/property-image-editor";
import { resolveLocationGoogleAiApiKey } from "@/lib/ai/location-google-key";
import {
    assertPrecisionRemoveEnabledForLocation,
} from "@/lib/ai/property-image-precision-remove-config";

const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_PRECISION_REMOVE_MODEL = "gemini-2.5-flash-image";
const PRECISION_MASK_EXPANSION_RADIUS = 2;

export type PrecisionRemoveMaskMode = "user_provided" | "background" | "foreground" | "semantic";

type PrecisionRemoveInput = {
    sourceImageBuffer: Buffer;
    sourceImageMimeType: string;
    maskPngBase64?: string;
    editorWidth?: number;
    editorHeight?: number;
    guidance?: string;
    maskMode?: PrecisionRemoveMaskMode;
    semanticMaskClassIds?: number[];
    generationModel?: string;
};

type PrecisionRemoveResult = {
    imageBuffer: Buffer;
    mimeType: string;
    actionLog: string[];
    model: string;
    maskCoverage?: number;
};

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
};

function normalizeMaskBase64(input: string): string {
    const raw = String(input || "").trim();
    if (!raw) {
        throw new Error("Mask image is required.");
    }

    const dataPrefix = "base64,";
    const markerIndex = raw.indexOf(dataPrefix);
    return markerIndex >= 0 ? raw.slice(markerIndex + dataPrefix.length).trim() : raw;
}

export function buildPrecisionRemovePrompt(guidance?: string): string {
    return String(guidance || "").trim();
}

function buildPromptForMaskMode(input: {
    maskMode: PrecisionRemoveMaskMode;
    guidance?: string;
    semanticMaskClassIds?: number[];
}): string {
    const guidance = buildPrecisionRemovePrompt(input.guidance);

    const sharedInstructions = [
        "You are editing a real estate listing photo.",
        "Preserve photorealism, perspective, and lighting consistency.",
        "Avoid altering architecture, room geometry, camera framing, and untouched details.",
    ];

    let modeInstructions = "";
    if (input.maskMode === "user_provided") {
        modeInstructions = [
            "Two images are provided.",
            "Image 1 is the source photo. Image 2 is a binary mask.",
            "White mask pixels mark regions to remove. Black pixels should be preserved.",
            "Remove only the white-masked regions and inpaint naturally.",
        ].join(" ");
    } else if (input.maskMode === "background") {
        modeInstructions = [
            "Automatically detect the background and remove background clutter while preserving the main foreground subject.",
            "Keep the subject edges natural and avoid halo artifacts.",
        ].join(" ");
    } else if (input.maskMode === "foreground") {
        modeInstructions = [
            "Automatically detect foreground subjects and remove the unwanted ones while preserving believable context.",
            "Do not remove static architecture or structural room elements unless explicitly requested.",
        ].join(" ");
    } else {
        const semanticHint = input.semanticMaskClassIds?.length
            ? `Target semantic classes: ${input.semanticMaskClassIds.join(", ")}.`
            : "Target semantic classes should be treated as removal targets.";
        modeInstructions = [
            "Use semantic segmentation intent to identify removal targets.",
            semanticHint,
            "Remove only those semantic targets and preserve everything else.",
        ].join(" ");
    }

    return [
        ...sharedInstructions,
        modeInstructions,
        guidance ? `Additional guidance: ${guidance}` : null,
    ].filter(Boolean).join("\n");
}

function resolveEditorDimensionsFromInput(input: {
    sourceImageBuffer: Buffer;
    editorWidth?: number;
    editorHeight?: number;
}): Promise<{ width: number; height: number; scale: number }> {
    const providedWidth = Number(input.editorWidth);
    const providedHeight = Number(input.editorHeight);

    if (Number.isFinite(providedWidth) && providedWidth > 0 && Number.isFinite(providedHeight) && providedHeight > 0) {
        return Promise.resolve(resolveEditorDimensions(
            Math.round(providedWidth),
            Math.round(providedHeight),
            DEFAULT_EDITOR_MAX_LONG_EDGE
        ));
    }

    return sharp(input.sourceImageBuffer)
        .metadata()
        .then((metadata) => {
            if (!metadata.width || !metadata.height) {
                throw new Error("Unable to resolve editor dimensions for Precision Remove.");
            }
            return resolveEditorDimensions(metadata.width, metadata.height, DEFAULT_EDITOR_MAX_LONG_EDGE);
        });
}

export async function preparePrecisionRemoveMaskAlpha(
    maskBuffer: Buffer,
    width: number,
    height: number
): Promise<{
    rawMaskPngBuffer: Buffer;
    featheredMaskRawBuffer: Buffer;
    maskCoverage: number;
}> {
    const resizedMask = sharp(maskBuffer)
        .resize(width, height, {
            fit: "fill",
        })
        .ensureAlpha()
        .extractChannel(3);

    const rawAlpha = await resizedMask
        .raw()
        .toBuffer({ resolveWithObject: true });

    const binaryMaskRaw = Buffer.alloc(rawAlpha.data.length);
    for (let i = 0; i < rawAlpha.data.length; i += 1) {
        binaryMaskRaw[i] = rawAlpha.data[i] > 0 ? 255 : 0;
    }

    const expandedMaskRaw = await sharp(binaryMaskRaw, {
        raw: {
            width: rawAlpha.info.width,
            height: rawAlpha.info.height,
            channels: 1,
        },
    })
        // Expand user-painted masks so object edges are less likely to survive.
        .blur(PRECISION_MASK_EXPANSION_RADIUS)
        .threshold(1)
        .extractChannel(0)
        .raw()
        .toBuffer();

    let maskedPixels = 0;
    for (const alpha of expandedMaskRaw) {
        if (alpha > 0) maskedPixels += 1;
    }

    const pixelCount = Math.max(1, rawAlpha.info.width * rawAlpha.info.height);
    const maskCoverage = maskedPixels / pixelCount;
    if (maskCoverage <= 0) {
        throw new Error("Draw a mask before removing content.");
    }

    const rgbMaskData = Buffer.alloc(rawAlpha.info.width * rawAlpha.info.height * 3);
    for (let i = 0; i < expandedMaskRaw.length; i += 1) {
        const val = expandedMaskRaw[i] > 0 ? 255 : 0;
        rgbMaskData[i * 3] = val;
        rgbMaskData[i * 3 + 1] = val;
        rgbMaskData[i * 3 + 2] = val;
    }

    const rawMaskPngBuffer = await sharp(rgbMaskData, {
        raw: {
            width: rawAlpha.info.width,
            height: rawAlpha.info.height,
            channels: 3,
        },
    }).png().toBuffer();

    const featheredMaskRawBuffer = await sharp(rawMaskPngBuffer)
        .blur(1)
        .extractChannel(0)
        .raw()
        .toBuffer();

    return {
        rawMaskPngBuffer,
        featheredMaskRawBuffer,
        maskCoverage,
    };
}

async function resizeSourceForEditor(
    sourceImageBuffer: Buffer,
    width: number,
    height: number,
    sourceMimeType: string
): Promise<{ imageBuffer: Buffer; mimeType: string }> {
    const outputFormat = String(sourceMimeType || "").toLowerCase().includes("png")
        ? "png"
        : "jpeg";

    let pipeline = sharp(sourceImageBuffer)
        .rotate()
        .resize(width, height, {
            fit: "fill",
        });

    if (outputFormat === "png") {
        pipeline = pipeline.png();
    } else {
        pipeline = pipeline.jpeg({ quality: 92 });
    }

    return {
        imageBuffer: await pipeline.toBuffer(),
        mimeType: outputFormat === "png" ? "image/png" : "image/jpeg",
    };
}

function normalizeActionLog(lines: Array<string | null | undefined>): string[] {
    const cleaned = lines
        .flatMap((line) => String(line || "").split("\n"))
        .map((line) => line.replace(/^[-*•\d.\s]+/, "").trim())
        .filter(Boolean);

    return Array.from(new Set(cleaned)).slice(0, 12);
}

function defaultActionForMaskMode(maskMode: PrecisionRemoveMaskMode): string {
    if (maskMode === "background") return "Auto-removed background content.";
    if (maskMode === "foreground") return "Auto-removed detected foreground content.";
    if (maskMode === "semantic") return "Auto-removed semantic targets from the image.";
    return "Removed content from the selected mask area.";
}

async function callGeminiPrecisionRemove(input: {
    apiKey: string;
    model: string;
    sourceImageBase64: string;
    sourceImageMimeType: string;
    maskImageBase64?: string;
    prompt: string;
}): Promise<{ imageBuffer: Buffer; mimeType: string; textParts: string[] }> {
    const endpoint = `${GEMINI_API_BASE_URL}/${input.model}:generateContent`;

    const parts: Array<Record<string, unknown>> = [
        { text: input.prompt },
        {
            inline_data: {
                mime_type: input.sourceImageMimeType,
                data: input.sourceImageBase64,
            },
        },
    ];

    if (input.maskImageBase64) {
        parts.push({
            inline_data: {
                mime_type: "image/png",
                data: input.maskImageBase64,
            },
        });
    }

    const response = await fetch(endpoint, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": input.apiKey,
        },
        body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: {
                responseModalities: ["IMAGE", "TEXT"],
            },
        }),
    });

    if (!response.ok) {
        const responseText = await response.text().catch(() => "");
        throw new Error(`Gemini precision remove failed (${response.status}): ${responseText || response.statusText}`);
    }

    const parsed = await response.json() as GeminiGenerateContentResponse;

    const textParts: string[] = [];
    let imageData: string | null = null;
    let mimeType = "image/png";

    for (const candidate of parsed.candidates || []) {
        for (const part of candidate.content?.parts || []) {
            if (part.text?.trim()) {
                textParts.push(part.text.trim());
            }

            const inlineLegacy = part.inline_data;
            if (!imageData && inlineLegacy?.data) {
                imageData = inlineLegacy.data;
                mimeType = inlineLegacy.mime_type || mimeType;
            }

            const inlineCamel = part.inlineData;
            if (!imageData && inlineCamel?.data) {
                imageData = inlineCamel.data;
                mimeType = inlineCamel.mimeType || mimeType;
            }
        }
    }

    if (!imageData) {
        throw new Error("Gemini did not return an edited image.");
    }

    return {
        imageBuffer: Buffer.from(imageData, "base64"),
        mimeType,
        textParts,
    };
}

export async function blendEditedImageWithMask(input: {
    originalImageBuffer: Buffer;
    editedImageBuffer: Buffer;
    featheredMaskRawBuffer: Buffer;
    width: number;
    height: number;
}): Promise<Buffer> {
    const baseImage = await sharp(input.originalImageBuffer)
        .resize(input.width, input.height, {
            fit: "fill",
        })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

    const editedImage = await sharp(input.editedImageBuffer)
        .resize(input.width, input.height, {
            fit: "fill",
        })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

    const output = Buffer.alloc(input.width * input.height * 4);

    for (let pixelIndex = 0; pixelIndex < input.width * input.height; pixelIndex += 1) {
        const rgbaOffset = pixelIndex * 4;
        const maskAlpha = (input.featheredMaskRawBuffer[pixelIndex] || 0) / 255;

        for (let channel = 0; channel < 3; channel += 1) {
            const baseValue = baseImage.data[rgbaOffset + channel] || 0;
            const editedValue = editedImage.data[rgbaOffset + channel] || 0;
            output[rgbaOffset + channel] = Math.round(
                baseValue + ((editedValue - baseValue) * maskAlpha)
            );
        }

        const baseAlpha = baseImage.data[rgbaOffset + 3] || 255;
        const editedAlpha = editedImage.data[rgbaOffset + 3] || 255;
        output[rgbaOffset + 3] = Math.round(
            baseAlpha + ((editedAlpha - baseAlpha) * maskAlpha)
        );
    }

    return sharp(output, {
        raw: {
            width: input.width,
            height: input.height,
            channels: 4,
        },
    })
        .png()
        .toBuffer();
}

export async function removeImageContentWithPrecisionMask(
    input: PrecisionRemoveInput & { locationId: string }
): Promise<PrecisionRemoveResult> {
    await assertPrecisionRemoveEnabledForLocation(input.locationId);

    const apiKey = await resolveLocationGoogleAiApiKey(input.locationId);
    if (!apiKey) {
        throw new Error("Google AI API key is not configured for this location.");
    }

    const maskMode: PrecisionRemoveMaskMode = input.maskMode || "user_provided";
    const resolvedEditor = await resolveEditorDimensionsFromInput({
        sourceImageBuffer: input.sourceImageBuffer,
        editorWidth: input.editorWidth,
        editorHeight: input.editorHeight,
    });

    const preparedSource = await resizeSourceForEditor(
        input.sourceImageBuffer,
        resolvedEditor.width,
        resolvedEditor.height,
        input.sourceImageMimeType
    );

    let maskCoverage: number | undefined;
    let rawMaskPngBuffer: Buffer | null = null;
    let featheredMaskRawBuffer: Buffer | null = null;

    if (maskMode === "user_provided") {
        const normalizedMaskBase64 = normalizeMaskBase64(input.maskPngBase64 || "");
        const maskBuffer = Buffer.from(normalizedMaskBase64, "base64");
        if (!maskBuffer.length) {
            throw new Error("Mask image is empty.");
        }

        const preparedMask = await preparePrecisionRemoveMaskAlpha(maskBuffer, resolvedEditor.width, resolvedEditor.height);
        rawMaskPngBuffer = preparedMask.rawMaskPngBuffer;
        featheredMaskRawBuffer = preparedMask.featheredMaskRawBuffer;
        maskCoverage = preparedMask.maskCoverage;
    }

    const prompt = buildPromptForMaskMode({
        maskMode,
        guidance: input.guidance,
        semanticMaskClassIds: input.semanticMaskClassIds,
    });

    const geminiResult = await callGeminiPrecisionRemove({
        apiKey,
        model: String(input.generationModel || "").trim() || GEMINI_PRECISION_REMOVE_MODEL,
        sourceImageBase64: preparedSource.imageBuffer.toString("base64"),
        sourceImageMimeType: preparedSource.mimeType,
        maskImageBase64: rawMaskPngBuffer?.toString("base64"),
        prompt,
    });

    let outputBuffer: Buffer;
    if (maskMode === "user_provided" && featheredMaskRawBuffer) {
        outputBuffer = await blendEditedImageWithMask({
            originalImageBuffer: preparedSource.imageBuffer,
            editedImageBuffer: geminiResult.imageBuffer,
            featheredMaskRawBuffer,
            width: resolvedEditor.width,
            height: resolvedEditor.height,
        });
    } else {
        outputBuffer = await sharp(geminiResult.imageBuffer)
            .resize(resolvedEditor.width, resolvedEditor.height, { fit: "fill" })
            .png()
            .toBuffer();
    }

    const actionLog = normalizeActionLog([
        defaultActionForMaskMode(maskMode),
        input.guidance ? "Applied optional removal guidance." : null,
        ...geminiResult.textParts,
    ]);

    return {
        imageBuffer: outputBuffer,
        mimeType: "image/png",
        actionLog,
        model: String(input.generationModel || "").trim() || GEMINI_PRECISION_REMOVE_MODEL,
        maskCoverage,
    };
}
