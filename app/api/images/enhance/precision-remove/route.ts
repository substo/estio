import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyUserHasAccessToLocation } from "@/lib/auth/permissions";
import { getImageDeliveryUrl, uploadToCloudflare } from "@/lib/cloudflareImages";
import { fetchImageBuffer } from "@/lib/ai/property-image-enhancement";
import { assertPrecisionRemoveEnabledForLocation } from "@/lib/ai/property-image-precision-remove-config";
import { removeImageContentWithPrecisionMask } from "@/lib/ai/property-image-precision-remove";
import { securelyRecordAiUsage } from "@/lib/ai/usage-metering";
import { resolveOwnedPropertyImageSource } from "../_helpers";

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
});

export async function POST(req: Request) {
    try {
        const session = await auth();
        const userId = session.userId;
        if (!userId) {
            return new NextResponse("Unauthorized", { status: 401 });
        }

        const parsed = precisionRemoveRequestSchema.safeParse(await req.json().catch(() => null));
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

        await assertPrecisionRemoveEnabledForLocation(parsed.data.locationId);

        const ownedMedia = await resolveOwnedPropertyImageSource({
            locationId: parsed.data.locationId,
            propertyId: parsed.data.propertyId,
            cloudflareImageId: parsed.data.cloudflareImageId,
            sourceUrl: parsed.data.sourceUrl,
        });

        const sourceImage = await fetchImageBuffer(ownedMedia.sourceUrl);
        const result = await removeImageContentWithPrecisionMask({
            locationId: parsed.data.locationId,
            sourceImageBuffer: sourceImage.buffer,
            sourceImageMimeType: sourceImage.mimeType,
            maskPngBase64: parsed.data.maskPngBase64,
            editorWidth: parsed.data.editorWidth,
            editorHeight: parsed.data.editorHeight,
            maskMode: parsed.data.maskMode,
            semanticMaskClassIds: parsed.data.semanticMaskClassIds,
            guidance: parsed.data.guidance,
        });

        const bytes = new Uint8Array(result.imageBuffer);
        const blob = new Blob([bytes], { type: result.mimeType });
        const upload = await uploadToCloudflare(blob);
        const generatedImageUrl = getImageDeliveryUrl(upload.imageId, "public");

        // Blocking AI usage telemetry (Imagen uses flat-rate pricing, no tokens)
        await securelyRecordAiUsage({
            locationId: parsed.data.locationId,
            userId,
            resourceType: "property",
            resourceId: parsed.data.propertyId,
            featureArea: "property_image_enhancement",
            action: "precision_remove",
            provider: "google_gemini",
            model: result.model,
            quantity: 1,
            metadata: {
                sourceCloudflareImageId: ownedMedia.cloudflareImageId,
                resultCloudflareImageId: upload.imageId,
                maskCoverage: result.maskCoverage,
            },
        });

        return NextResponse.json({
            success: true,
            generatedImageId: upload.imageId,
            generatedImageUrl,
            actionLog: result.actionLog,
            model: result.model,
            maskCoverage: result.maskCoverage,
        });
    } catch (error) {
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
