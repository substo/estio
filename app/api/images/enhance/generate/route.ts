import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyUserHasAccessToLocation } from "@/lib/auth/permissions";
import { resolveLocationGoogleAiApiKey } from "@/lib/ai/location-google-key";
import {
    fetchImageAsInlineData,
    generateEnhancedImage,
    normalizeImageEnhancementAnalysis,
} from "@/lib/ai/property-image-enhancement";
import {
    ENHANCEMENT_AGGRESSION_LEVELS,
    ENHANCEMENT_MODEL_TIERS,
} from "@/lib/ai/property-image-enhancement-types";
import { getImageDeliveryUrl, uploadToCloudflare } from "@/lib/cloudflareImages";
import { resolveOwnedPropertyImageSource } from "../_helpers";

const generateRequestSchema = z.object({
    locationId: z.string().trim().min(1),
    propertyId: z.string().trim().min(1),
    cloudflareImageId: z.string().trim().min(1).optional(),
    sourceUrl: z.string().trim().url().optional(),
    analysis: z.unknown(),
    selectedFixIds: z.array(z.string().trim().min(1)).max(40).default([]),
    aggression: z.enum(ENHANCEMENT_AGGRESSION_LEVELS).default("balanced"),
    modelTier: z.enum(ENHANCEMENT_MODEL_TIERS).optional(),
    priorPrompt: z.string().trim().max(8000).optional(),
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

        const parsed = generateRequestSchema.safeParse(await req.json().catch(() => null));
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

        const sourceImage = await fetchImageAsInlineData(ownedMedia.sourceUrl);
        const normalizedAnalysis = normalizeImageEnhancementAnalysis(parsed.data.analysis);
        const generated = await generateEnhancedImage({
            apiKey,
            sourceImageBase64: sourceImage.base64,
            sourceImageMimeType: sourceImage.mimeType,
            analysis: normalizedAnalysis,
            selectedFixIds: parsed.data.selectedFixIds,
            aggression: parsed.data.aggression,
            modelTier: parsed.data.modelTier,
            priorPrompt: parsed.data.priorPrompt,
        });

        const bytes = Buffer.from(generated.imageBase64, "base64");
        if (!bytes.length) {
            throw new Error("Generated image is empty.");
        }
        const blob = new Blob([bytes], { type: generated.mimeType || "image/png" });
        const upload = await uploadToCloudflare(blob);
        const generatedImageUrl = getImageDeliveryUrl(upload.imageId, "public");

        return NextResponse.json({
            success: true,
            generatedImageId: upload.imageId,
            generatedImageUrl,
            actionLog: generated.actionLog,
            finalPrompt: generated.finalPrompt,
            model: generated.model,
        });
    } catch (error) {
        console.error("[/api/images/enhance/generate] Error:", error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Internal server error." },
            { status: 500 }
        );
    }
}
