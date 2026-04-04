import sharp from "sharp";
import { google } from "googleapis";
import { DEFAULT_EDITOR_MAX_LONG_EDGE, resolveEditorDimensions } from "@/lib/ai/property-image-editor";
import {
    assertPrecisionRemoveEnabledForLocation,
    type PrecisionRemoveConfig,
} from "@/lib/ai/property-image-precision-remove-config";

const IMAGEN_PRECISION_REMOVE_MODEL = "imagen-3.0-capability-001";
const IMAGEN_MASK_DILATION = 0.01;
const IMAGEN_BASE_STEPS = 12;
const IMAGEN_SAMPLE_COUNT = 1;
const CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";

type PrecisionRemoveInput = {
    sourceImageBuffer: Buffer;
    sourceImageMimeType: string;
    maskPngBase64: string;
    editorWidth: number;
    editorHeight: number;
    guidance?: string;
};

type PrecisionRemoveResult = {
    imageBuffer: Buffer;
    mimeType: string;
    actionLog: string[];
    model: string;
    maskCoverage: number;
};

type VertexImagenPredictResponse = {
    predictions?: Array<{
        bytesBase64Encoded?: string;
        mimeType?: string;
        raiFilteredReason?: string;
    }>;
    error?: {
        message?: string;
    };
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

async function getVertexAccessToken(): Promise<string> {
    const auth = new google.auth.GoogleAuth({
        scopes: [CLOUD_PLATFORM_SCOPE],
    });
    const client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();
    const token = typeof tokenResponse === "string"
        ? tokenResponse
        : tokenResponse?.token;

    if (!token) {
        throw new Error("Unable to acquire Vertex AI access token.");
    }

    return token;
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

    let maskedPixels = 0;
    for (const alpha of rawAlpha.data) {
        if (alpha > 0) maskedPixels += 1;
    }

    const pixelCount = Math.max(1, rawAlpha.info.width * rawAlpha.info.height);
    const maskCoverage = maskedPixels / pixelCount;
    if (maskCoverage <= 0) {
        throw new Error("Draw a mask before removing content.");
    }

    const rawMaskPngBuffer = await sharp(rawAlpha.data, {
        raw: {
            width: rawAlpha.info.width,
            height: rawAlpha.info.height,
            channels: 1,
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
): Promise<Buffer> {
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

    return pipeline.toBuffer();
}

async function callImagenPrecisionRemove(input: {
    config: PrecisionRemoveConfig;
    sourceImageBase64: string;
    maskImageBase64: string;
    guidance?: string;
}): Promise<{ imageBuffer: Buffer; mimeType: string }> {
    const accessToken = await getVertexAccessToken();
    const prompt = buildPrecisionRemovePrompt(input.guidance);
    const endpoint = `https://${input.config.location}-aiplatform.googleapis.com/v1/projects/${input.config.projectId}/locations/${input.config.location}/publishers/google/models/${IMAGEN_PRECISION_REMOVE_MODEL}:predict`;

    const body = {
        instances: [{
            prompt,
            referenceImages: [
                {
                    referenceType: "REFERENCE_TYPE_RAW",
                    referenceId: 1,
                    referenceImage: {
                        bytesBase64Encoded: input.sourceImageBase64,
                    },
                },
                {
                    referenceType: "REFERENCE_TYPE_MASK",
                    referenceId: 2,
                    referenceImage: {
                        bytesBase64Encoded: input.maskImageBase64,
                    },
                    maskImageConfig: {
                        maskMode: "MASK_MODE_USER_PROVIDED",
                        dilation: IMAGEN_MASK_DILATION,
                    },
                },
            ],
        }],
        parameters: {
            editConfig: {
                baseSteps: IMAGEN_BASE_STEPS,
            },
            editMode: "EDIT_MODE_INPAINT_REMOVAL",
            sampleCount: IMAGEN_SAMPLE_COUNT,
            outputOptions: {
                mimeType: "image/png",
            },
        },
    };

    const response = await fetch(endpoint, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
    });

    const responseText = await response.text().catch(() => "");
    if (!response.ok) {
        throw new Error(`Imagen precision remove failed (${response.status}): ${responseText || response.statusText}`);
    }

    const parsed = responseText
        ? JSON.parse(responseText) as VertexImagenPredictResponse
        : {} as VertexImagenPredictResponse;

    if (parsed.error?.message) {
        throw new Error(parsed.error.message);
    }

    const prediction = parsed.predictions?.[0];
    if (!prediction?.bytesBase64Encoded) {
        const filteredReason = String(prediction?.raiFilteredReason || "").trim();
        if (filteredReason) {
            throw new Error(`Precision Remove result was filtered by Vertex AI (${filteredReason}).`);
        }
        throw new Error("Imagen did not return an edited image.");
    }

    return {
        imageBuffer: Buffer.from(prediction.bytesBase64Encoded, "base64"),
        mimeType: prediction.mimeType || "image/png",
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
    const config = await assertPrecisionRemoveEnabledForLocation(input.locationId);
    const resolvedEditor = resolveEditorDimensions(
        input.editorWidth,
        input.editorHeight,
        DEFAULT_EDITOR_MAX_LONG_EDGE
    );

    const normalizedMaskBase64 = normalizeMaskBase64(input.maskPngBase64);
    const maskBuffer = Buffer.from(normalizedMaskBase64, "base64");
    if (!maskBuffer.length) {
        throw new Error("Mask image is empty.");
    }

    const preparedSourceBuffer = await resizeSourceForEditor(
        input.sourceImageBuffer,
        resolvedEditor.width,
        resolvedEditor.height,
        input.sourceImageMimeType
    );

    const {
        rawMaskPngBuffer,
        featheredMaskRawBuffer,
        maskCoverage,
    } = await preparePrecisionRemoveMaskAlpha(maskBuffer, resolvedEditor.width, resolvedEditor.height);

    const imagenResult = await callImagenPrecisionRemove({
        config,
        sourceImageBase64: preparedSourceBuffer.toString("base64"),
        maskImageBase64: rawMaskPngBuffer.toString("base64"),
        guidance: input.guidance,
    });

    const blendedBuffer = await blendEditedImageWithMask({
        originalImageBuffer: preparedSourceBuffer,
        editedImageBuffer: imagenResult.imageBuffer,
        featheredMaskRawBuffer,
        width: resolvedEditor.width,
        height: resolvedEditor.height,
    });

    const actionLog = [
        "Removed content from the selected mask area.",
        input.guidance ? "Applied optional removal guidance for the selected area." : null,
    ].filter(Boolean) as string[];

    return {
        imageBuffer: blendedBuffer,
        mimeType: "image/png",
        actionLog,
        model: IMAGEN_PRECISION_REMOVE_MODEL,
        maskCoverage,
    };
}
