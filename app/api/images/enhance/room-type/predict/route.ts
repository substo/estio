import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyUserHasAccessToLocation } from "@/lib/auth/permissions";
import { getPropertyImageEnhancementModelCatalog } from "@/lib/ai/fetch-models";
import { resolveLocationGoogleAiApiKey } from "@/lib/ai/location-google-key";
import { fetchImageAsInlineData } from "@/lib/ai/property-image-enhancement";
import { predictPropertyImageRoomType } from "@/lib/ai/property-image-room-type";
import { resolveOwnedPropertyImageSource } from "../../_helpers";

const predictRoomTypeRequestSchema = z.object({
    locationId: z.string().trim().min(1),
    propertyId: z.string().trim().min(1),
    cloudflareImageId: z.string().trim().min(1).optional(),
    sourceUrl: z.string().trim().url().optional(),
    analysisModel: z.string().trim().min(1).max(200).optional(),
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

        const parsed = predictRoomTypeRequestSchema.safeParse(await req.json().catch(() => null));
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
                { error: "The selected analysis model is unavailable or incompatible with room type prediction." },
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
        const prediction = await predictPropertyImageRoomType({
            apiKey,
            model: analysisModel,
            sourceImageBase64: sourceImage.base64,
            sourceImageMimeType: sourceImage.mimeType,
        });

        return NextResponse.json({
            success: true,
            suggestedRoomType: prediction.suggestedRoomType,
            candidates: prediction.candidates,
            model: prediction.model,
        });
    } catch (error) {
        console.error("[/api/images/enhance/room-type/predict] Error:", error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Internal server error." },
            { status: 500 }
        );
    }
}
