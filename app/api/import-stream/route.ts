
import { NextRequest } from "next/server";
import { runImportWorkflow, runPasteImportWorkflow } from "@/lib/crm/import-workflow";
import { currentUser } from "@clerk/nextjs/server";
import db from "@/lib/db";
import { requireAuthenticatedLocationContext } from "@/lib/properties/active-location-access";
import { createImportStreamHandlers } from "@/lib/properties/import-stream-handler";

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes

const handlers = createImportStreamHandlers({
    getAuthenticatedUser: async () => {
        const user = await currentUser();
        return user ? { id: user.id } : null;
    },
    getActiveLocationId: async () => (await requireAuthenticatedLocationContext()).locationId,
    getDefaultModel: async (locationId) => {
        const config = await db.siteConfig.findUnique({ where: { locationId } }) as any;
        return config?.googleAiModel || "gemini-2.0-flash";
    },
    runUrlImport: ({ notionUrl, model, clerkUserId, hints, maxImages }) => (
        runImportWorkflow(notionUrl, model, clerkUserId, hints, maxImages)
    ),
    runPasteImport: ({ text, analysisImages, galleryImages, model, clerkUserId, hints }) => (
        runPasteImportWorkflow(text, analysisImages, galleryImages, model, clerkUserId, hints)
    ),
    logStreamError: (error) => console.error("Import stream error:", error),
});

export async function GET() {
    return handlers.GET();
}

export async function POST(req: NextRequest) {
    return handlers.POST(req);
}
