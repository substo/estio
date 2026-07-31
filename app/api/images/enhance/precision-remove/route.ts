import { NextResponse } from "next/server";
import { z } from "zod";
import { PropertyAccessDeniedError, requirePropertyInActiveLocation } from "@/lib/properties/active-location-access";
import { getImageDeliveryUrl, uploadToCloudflare } from "@/lib/cloudflareImages";
import { fetchImageBuffer } from "@/lib/ai/property-image-enhancement";
import {
    IMAGE_TRANSFORM_ASPECT_RATIOS,
    IMAGE_TRANSFORM_ASPECT_RATIO_STRATEGIES,
    IMAGE_TRANSFORM_QUALITIES,
    IMAGE_UPSCALE_FACTORS,
} from "@/lib/ai/property-image-enhancement-types";
import { getPropertyImageEnhancementModelCatalog } from "@/lib/ai/fetch-models";
import { assertPrecisionRemoveEnabledForLocation } from "@/lib/ai/property-image-precision-remove-config";
import { removeImageContentWithPrecisionMask } from "@/lib/ai/property-image-precision-remove";
import { resolvePropertyImageGenerationModel } from "@/lib/ai/property-image-model-routing";
import { securelyRecordAiUsage } from "@/lib/ai/usage-metering";
import { PropertyMediaOwnershipError, resolveOwnedPropertyImageSource } from "../_helpers";

const ratioPattern = /^\d{1,2}(?:\.\d{1,2})?:\d{1,2}(?:\.\d{1,2})?$/;

const precisionRemoveRequestSchema = z.object({
    locationId: z.string().trim().min(1),
    propertyId: z.string().trim().min(1),
    cloudflareImageId: z.string().trim().min(1).optional(),
    sourceUrl: z.string().trim().url().optional(),
    maskMode: z.enum(["user_provided", "background", "foreground", "semantic"]).default("user_provided"),
    maskPngBase64: z.string().trim().min(1).optional(),
    editorWidth: z.number().int().min(1).max(4096).optional(),
    editorHeight: z.number().int().min(1).max(4096).optional(),
    semanticMaskClassIds: z.array(z.number().int().min(0).max(5000)).max(40).optional(),
    guidance: z.string().trim().max(500).optional(),
    generationModel: z.string().trim().min(1).max(200).optional(),
    outputIntent: z.object({
        aspectRatio: z.enum(IMAGE_TRANSFORM_ASPECT_RATIOS).default("original"),
        customAspectRatio: z.string().trim().max(16).optional(),
        aspectRatioStrategy: z.enum(IMAGE_TRANSFORM_ASPECT_RATIO_STRATEGIES).default("expand"),
        upscaleFactor: z.enum(IMAGE_UPSCALE_FACTORS).default("off"),
        quality: z.enum(IMAGE_TRANSFORM_QUALITIES).default("standard"),
    }).optional(),
}).superRefine((value, ctx) => {
    if (!value.cloudflareImageId && !value.sourceUrl) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["cloudflareImageId"],
            message: "Provide cloudflareImageId or sourceUrl.",
        });
    }

    if (value.maskMode === "user_provided" && !value.maskPngBase64) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["maskPngBase64"],
            message: "Mask is required for user_provided mode.",
        });
    }

    if ((value.editorWidth && !value.editorHeight) || (!value.editorWidth && value.editorHeight)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["editorWidth"],
            message: "Provide both editorWidth and editorHeight together.",
        });
    }

    if (value.outputIntent?.aspectRatio === "custom") {
        const custom = String(value.outputIntent.customAspectRatio || "").trim();
        if (!ratioPattern.test(custom)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["outputIntent", "customAspectRatio"],
                message: "Custom aspect ratio must look like 5:4 or 1.91:1.",
            });
        }
    }
});

export async function POST(req: Request) {
    try {
        const parsed = precisionRemoveRequestSchema.safeParse(await req.json().catch(() => null));
        if (!parsed.success) {
            return NextResponse.json(
                { error: "Invalid request payload.", issues: parsed.error.flatten() },
                { status: 400 }
            );
        }

        const { locationId, dbUserId } = await requirePropertyInActiveLocation(
            parsed.data.propertyId,
            { requestedLocationId: parsed.data.locationId },
        );

        await assertPrecisionRemoveEnabledForLocation(locationId);

        const modelCatalog = await getPropertyImageEnhancementModelCatalog(locationId);
        const requestedGenerationModel = String(parsed.data.generationModel || "").trim();
        const modelResolution = await resolvePropertyImageGenerationModel({
            locationId,
            requestedModel: requestedGenerationModel || modelCatalog.defaults.generation,
            fallbackModels: modelCatalog.generationModels,
        });
        if (!modelResolution?.model) {
            return NextResponse.json(
                { error: "No compatible image generation models are available for this location." },
                { status: 400 }
            );
        }
        if (modelResolution.provider !== "google_gemini") {
            return NextResponse.json(
                { error: "Precision Remove currently supports Gemini image models only. Select a Gemini image model for object removal." },
                { status: 400 }
            );
        }

        const ownedMedia = await resolveOwnedPropertyImageSource({
            locationId,
            propertyId: parsed.data.propertyId,
            cloudflareImageId: parsed.data.cloudflareImageId,
            sourceUrl: parsed.data.sourceUrl,
        });

        const sourceImage = await fetchImageBuffer(ownedMedia.sourceUrl);
        const result = await removeImageContentWithPrecisionMask({
            locationId,
            sourceImageBuffer: sourceImage.buffer,
            sourceImageMimeType: sourceImage.mimeType,
            maskPngBase64: parsed.data.maskPngBase64,
            editorWidth: parsed.data.editorWidth,
            editorHeight: parsed.data.editorHeight,
            maskMode: parsed.data.maskMode,
            semanticMaskClassIds: parsed.data.semanticMaskClassIds,
            guidance: parsed.data.guidance,
            generationModel: modelResolution.model,
            outputIntent: parsed.data.outputIntent,
        });

        const bytes = new Uint8Array(result.imageBuffer);
        const blob = new Blob([bytes], { type: result.mimeType });
        const upload = await uploadToCloudflare(blob, {
            metadata: {
                locationId,
                uploadedBy: dbUserId,
                purpose: "property_media",
                workflow: "property_precision_remove",
                propertyId: parsed.data.propertyId,
            },
        });
        const generatedImageUrl = getImageDeliveryUrl(upload.imageId, "public");

        // Blocking AI usage telemetry to ensure it is not cancelled by the Next.js runtime.
        await securelyRecordAiUsage({
            locationId,
            userId: dbUserId,
            resourceType: "property",
            resourceId: parsed.data.propertyId,
            featureArea: "property_image_enhancement",
            action: "precision_remove",
            provider: "google_gemini",
            model: result.model,
            inputTokens: result.usageMetadata?.promptTokenCount,
            outputTokens: result.usageMetadata?.candidatesTokenCount,
            outputTokenType: "image",
            quantity: 1,
            metadata: {
                sourceCloudflareImageId: ownedMedia.cloudflareImageId,
                resultCloudflareImageId: upload.imageId,
                maskCoverage: result.maskCoverage,
                outputIntent: parsed.data.outputIntent,
                modelWarning: modelResolution.warning,
            },
        });

        return NextResponse.json({
            success: true,
            generatedImageId: upload.imageId,
            generatedImageUrl,
            actionLog: result.actionLog,
            model: result.model,
            modelWarning: modelResolution.warning,
            maskCoverage: result.maskCoverage,
        });
    } catch (error) {
        if (error instanceof PropertyAccessDeniedError || error instanceof PropertyMediaOwnershipError) {
            return new NextResponse("Not found", { status: 404 });
        }
        console.error("[/api/images/enhance/precision-remove] Error:", error);
        const message = error instanceof Error ? error.message : "Internal server error.";
        const status = /disabled in ai settings/i.test(message)
            ? 403
            : /api key is not configured/i.test(message)
                ? 400
            : /not configured/i.test(message)
                ? 503
                : 500;
        return NextResponse.json({ error: message }, { status });
    }
}
