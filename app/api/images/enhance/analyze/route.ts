import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyUserHasAccessToLocation } from "@/lib/auth/permissions";
import { resolveLocationGoogleAiApiKey } from "@/lib/ai/location-google-key";
import {
    analyzeImageForEnhancement,
    fetchImageAsInlineData,
} from "@/lib/ai/property-image-enhancement";
import { ENHANCEMENT_MODEL_TIERS } from "@/lib/ai/property-image-enhancement-types";
import { resolveOwnedPropertyImageSource } from "../_helpers";

const analyzeRequestSchema = z.object({
    locationId: z.string().trim().min(1),
    propertyId: z.string().trim().min(1),
    cloudflareImageId: z.string().trim().min(1).optional(),
    sourceUrl: z.string().trim().url().optional(),
    modelTier: z.enum(ENHANCEMENT_MODEL_TIERS).optional(),
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

        const sourceImage = await fetchImageAsInlineData(ownedMedia.sourceUrl);
        const result = await analyzeImageForEnhancement({
            apiKey,
            sourceImageBase64: sourceImage.base64,
            sourceImageMimeType: sourceImage.mimeType,
            modelTier: parsed.data.modelTier,
            priorPrompt: parsed.data.priorPrompt,
            userInstructions: parsed.data.userInstructions,
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
