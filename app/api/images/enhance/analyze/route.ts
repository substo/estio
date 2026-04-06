import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyUserHasAccessToLocation } from "@/lib/auth/permissions";
import { getPropertyImageEnhancementModelCatalog } from "@/lib/ai/fetch-models";
import { resolveLocationGoogleAiApiKey } from "@/lib/ai/location-google-key";
import {
    analyzeImageForEnhancement,
    fetchImageAsInlineData,
} from "@/lib/ai/property-image-enhancement";
import { securelyRecordAiUsage } from "@/lib/ai/usage-metering";
import { resolveOwnedPropertyImageSource } from "../_helpers";

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
        const session = await auth();
        const userId = session.userId;
        if (!userId) {
            return new NextResponse("Unauthorized", { status: 401 });
        }

        const parsed = analyzeRequestSchema.safeParse(await req.json().catch(() => null));
        if (!parsed.success) {
            return NextResponse.json(
                { error: "Invalid request payload.", issues: parsed.error.flatten() },
                { status: 400 }
            );
        }

        const hasAccess = await verifyUserHasAccessToLocation(userId, parsed.data.locationId);
        if (!hasAccess) {
            return new NextResponse("Forbidden", { status: 403 });
        }

        const ownedMedia = await resolveOwnedPropertyImageSource({
            locationId: parsed.data.locationId,
            propertyId: parsed.data.propertyId,
            cloudflareImageId: parsed.data.cloudflareImageId,
            sourceUrl: parsed.data.sourceUrl,
        });

        const apiKey = await resolveLocationGoogleAiApiKey(parsed.data.locationId);
        if (!apiKey) {
            return NextResponse.json(
                { error: "Google AI API key is not configured for this location." },
                { status: 400 }
            );
        }

        const modelCatalog = await getPropertyImageEnhancementModelCatalog(parsed.data.locationId);
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
        const result = await analyzeImageForEnhancement({
            apiKey,
            model: analysisModel,
            sourceImageBase64: sourceImage.base64,
            sourceImageMimeType: sourceImage.mimeType,
            priorPrompt: parsed.data.priorPrompt,
            userInstructions: parsed.data.userInstructions,
        });

        // Blocking AI usage telemetry to ensure it is not cancelled by the Next.js runtime.
        await securelyRecordAiUsage({
            locationId: parsed.data.locationId,
            userId,
            resourceType: "property",
            resourceId: parsed.data.propertyId,
            featureArea: "property_image_enhancement",
            action: "analyze",
            provider: "google_gemini",
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
        console.error("[/api/images/enhance/analyze] Error:", error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Internal server error." },
            { status: 500 }
        );
    }
}
