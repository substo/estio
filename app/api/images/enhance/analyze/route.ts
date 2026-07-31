import { NextResponse } from "next/server";
import { z } from "zod";
import { PropertyAccessDeniedError, requirePropertyInActiveLocation } from "@/lib/properties/active-location-access";
import { getPropertyImageEnhancementModelCatalog } from "@/lib/ai/fetch-models";
import { resolveLocationGoogleAiApiKey } from "@/lib/ai/location-google-key";
import {
    analyzeImageForEnhancement,
    analyzeImageForEnhancementWithChatGptSubscription,
    fetchImageAsInlineData,
} from "@/lib/ai/property-image-enhancement";
import { securelyRecordAiUsage } from "@/lib/ai/usage-metering";
import { PropertyMediaOwnershipError, resolveOwnedPropertyImageSource } from "../_helpers";

const analyzeRequestSchema = z.object({
    locationId: z.string().trim().min(1),
    propertyId: z.string().trim().min(1),
    cloudflareImageId: z.string().trim().min(1).optional(),
    sourceUrl: z.string().trim().url().optional(),
    analysisModel: z.string().trim().min(1).max(200).optional(),
    priorPrompt: z.string().trim().max(8000).optional(),
    userInstructions: z.string().trim().max(4000).optional(),
}).superRefine((value, ctx) => {
    if (!value.cloudflareImageId && !value.sourceUrl) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["cloudflareImageId"],
            message: "Provide cloudflareImageId or sourceUrl.",
        });
    }
});

export async function POST(req: Request) {
    try {
        const parsed = analyzeRequestSchema.safeParse(await req.json().catch(() => null));
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
        const availableAnalysisModels = new Set(modelCatalog.analysisModels.map((model) => model.value));
        const requestedAnalysisModel = String(parsed.data.analysisModel || "").trim();

        if (requestedAnalysisModel && !availableAnalysisModels.has(requestedAnalysisModel)) {
            return NextResponse.json(
                { error: "The selected analysis model is unavailable or incompatible with structured image analysis." },
                { status: 400 }
            );
        }

        const analysisModel = requestedAnalysisModel || modelCatalog.defaults.analysis;
        if (!analysisModel) {
            return NextResponse.json(
                { error: "No compatible analysis models are available for this location." },
                { status: 400 }
            );
        }

        const sourceImage = await fetchImageAsInlineData(ownedMedia.sourceUrl);
        const provider = analysisModel.startsWith("chatgpt_subscription:")
            ? "chatgpt_subscription"
            : "google_gemini";
        const result = provider === "chatgpt_subscription"
            ? await analyzeImageForEnhancementWithChatGptSubscription({
                model: analysisModel,
                sourceImageBase64: sourceImage.base64,
                sourceImageMimeType: sourceImage.mimeType,
                priorPrompt: parsed.data.priorPrompt,
                userInstructions: parsed.data.userInstructions,
            })
            : await analyzeImageForEnhancement({
                apiKey: await resolveLocationGoogleAiApiKey(locationId).then((key) => {
                    if (!key) throw new Error("Google AI API key is not configured for this location.");
                    return key;
                }),
                model: analysisModel,
                sourceImageBase64: sourceImage.base64,
                sourceImageMimeType: sourceImage.mimeType,
                priorPrompt: parsed.data.priorPrompt,
                userInstructions: parsed.data.userInstructions,
            });

        // Blocking AI usage telemetry to ensure it is not cancelled by the Next.js runtime.
        await securelyRecordAiUsage({
            locationId,
            userId: dbUserId,
            resourceType: "property",
            resourceId: parsed.data.propertyId,
            featureArea: "property_image_enhancement",
            action: "analyze",
            provider,
            model: result.model,
            inputTokens: result.usageMetadata?.promptTokenCount,
            outputTokens: result.usageMetadata?.candidatesTokenCount,
            metadata: {
                sourceCloudflareImageId: ownedMedia.cloudflareImageId,
            },
        });

        return NextResponse.json({
            success: true,
            analysis: result.analysis,
            model: result.model,
        });
    } catch (error) {
        if (error instanceof PropertyAccessDeniedError || error instanceof PropertyMediaOwnershipError) {
            return new NextResponse("Not found", { status: 404 });
        }
        console.error("[/api/images/enhance/analyze] Error:", error);
        const message = error instanceof Error ? error.message : "Internal server error.";
        return NextResponse.json(
            { error: message },
            { status: /api key is not configured/i.test(message) ? 400 : 500 }
        );
    }
}
