import { NextResponse } from "next/server";
import { z } from "zod";
import { PropertyAccessDeniedError, requirePropertyInActiveLocation } from "@/lib/properties/active-location-access";
import { getPropertyImageEnhancementModelCatalog } from "@/lib/ai/fetch-models";
import { resolveLocationGoogleAiApiKey } from "@/lib/ai/location-google-key";
import {
    fetchImageAsInlineData,
    generateEnhancedImage,
    generateEnhancedImageWithChatGptSubscription,
    generateEnhancedImageWithOpenAi,
    normalizeImageEnhancementAnalysis,
} from "@/lib/ai/property-image-enhancement";
import { resolveOpenAiApiKey } from "@/lib/ai/openai-models";
import {
    ENHANCEMENT_AGGRESSION_LEVELS,
    IMAGE_TRANSFORM_ASPECT_RATIOS,
    IMAGE_TRANSFORM_ASPECT_RATIO_STRATEGIES,
    IMAGE_TRANSFORM_QUALITIES,
    IMAGE_UPSCALE_FACTORS,
} from "@/lib/ai/property-image-enhancement-types";
import { resolvePropertyImageGenerationModel } from "@/lib/ai/property-image-model-routing";
import { securelyRecordAiUsage } from "@/lib/ai/usage-metering";
import { getImageDeliveryUrl, uploadToCloudflare } from "@/lib/cloudflareImages";
import { PropertyMediaOwnershipError, resolveOwnedPropertyImageSource } from "../_helpers";

const ratioPattern = /^\d{1,2}(?:\.\d{1,2})?:\d{1,2}(?:\.\d{1,2})?$/;

const generateRequestSchema = z.object({
    locationId: z.string().trim().min(1),
    propertyId: z.string().trim().min(1),
    cloudflareImageId: z.string().trim().min(1).optional(),
    sourceUrl: z.string().trim().url().optional(),
    analysis: z.unknown(),
    selectedFixIds: z.array(z.string().trim().min(1)).max(40).default([]),
    removedDetectedElementIds: z.array(z.string().trim().min(1)).max(40).default([]),
    aggression: z.enum(ENHANCEMENT_AGGRESSION_LEVELS).default("balanced"),
    generationModel: z.string().trim().min(1).max(200).optional(),
    priorPrompt: z.string().trim().max(8000).optional(),
    userInstructions: z.string().trim().max(4000).optional(),
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
        const parsed = generateRequestSchema.safeParse(await req.json().catch(() => null));
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

        const ownedMedia = await resolveOwnedPropertyImageSource({
            locationId,
            propertyId: parsed.data.propertyId,
            cloudflareImageId: parsed.data.cloudflareImageId,
            sourceUrl: parsed.data.sourceUrl,
        });

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

        const sourceImage = await fetchImageAsInlineData(ownedMedia.sourceUrl);
        const normalizedAnalysis = normalizeImageEnhancementAnalysis(parsed.data.analysis);
        const generated = modelResolution.provider === "chatgpt_subscription"
            ? await generateEnhancedImageWithChatGptSubscription({
                model: modelResolution.model,
                sourceImageBase64: sourceImage.base64,
                sourceImageMimeType: sourceImage.mimeType,
                analysis: normalizedAnalysis,
                selectedFixIds: parsed.data.selectedFixIds,
                removedDetectedElementIds: parsed.data.removedDetectedElementIds,
                aggression: parsed.data.aggression,
                priorPrompt: parsed.data.priorPrompt,
                userInstructions: parsed.data.userInstructions,
                outputIntent: parsed.data.outputIntent,
            })
            : modelResolution.provider === "openai_api"
            ? await generateEnhancedImageWithOpenAi({
                apiKey: await resolveOpenAiApiKey(locationId).then((key) => {
                    if (!key) throw new Error("OpenAI API key is not configured for this location or user.");
                    return key;
                }),
                model: modelResolution.model,
                sourceImageBase64: sourceImage.base64,
                sourceImageMimeType: sourceImage.mimeType,
                analysis: normalizedAnalysis,
                selectedFixIds: parsed.data.selectedFixIds,
                removedDetectedElementIds: parsed.data.removedDetectedElementIds,
                aggression: parsed.data.aggression,
                priorPrompt: parsed.data.priorPrompt,
                userInstructions: parsed.data.userInstructions,
                outputIntent: parsed.data.outputIntent,
            })
            : await generateEnhancedImage({
                apiKey: await resolveLocationGoogleAiApiKey(locationId).then((key) => {
                    if (!key) throw new Error("Google AI API key is not configured for this location.");
                    return key;
                }),
                model: modelResolution.model,
                sourceImageBase64: sourceImage.base64,
                sourceImageMimeType: sourceImage.mimeType,
                analysis: normalizedAnalysis,
                selectedFixIds: parsed.data.selectedFixIds,
                removedDetectedElementIds: parsed.data.removedDetectedElementIds,
                aggression: parsed.data.aggression,
                priorPrompt: parsed.data.priorPrompt,
                userInstructions: parsed.data.userInstructions,
                outputIntent: parsed.data.outputIntent,
            });

        const bytes = Buffer.from(generated.imageBase64, "base64");
        if (!bytes.length) {
            throw new Error("Generated image is empty.");
        }
        const blob = new Blob([bytes], { type: generated.mimeType || "image/png" });
        const upload = await uploadToCloudflare(blob, {
            metadata: {
                locationId,
                uploadedBy: dbUserId,
                purpose: "property_media",
                workflow: "property_image_generation",
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
            action: "generate",
            provider: modelResolution.provider,
            model: generated.model,
            inputTokens: generated.usageMetadata?.promptTokenCount,
            outputTokens: generated.usageMetadata?.candidatesTokenCount,
            outputTokenType: "image",
            quantity: 1,
            metadata: {
                sourceCloudflareImageId: ownedMedia.cloudflareImageId,
                resultCloudflareImageId: upload.imageId,
                aggression: parsed.data.aggression,
                outputIntent: parsed.data.outputIntent,
                modelWarning: modelResolution.warning,
            },
        });

        return NextResponse.json({
            success: true,
            generatedImageId: upload.imageId,
            generatedImageUrl,
            actionLog: generated.actionLog,
            finalPrompt: generated.finalPrompt,
            reusablePrompt: generated.reusablePrompt,
            model: generated.model,
            modelWarning: modelResolution.warning,
        });
    } catch (error) {
        if (error instanceof PropertyAccessDeniedError || error instanceof PropertyMediaOwnershipError) {
            return new NextResponse("Not found", { status: 404 });
        }
        console.error("[/api/images/enhance/generate] Error:", error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Internal server error." },
            { status: 500 }
        );
    }
}
