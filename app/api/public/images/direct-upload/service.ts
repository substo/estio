import type { PublicSiteContextResult } from "@/lib/auth/public-site-contact-context";

export type PublicImageUploadDependencies = {
    getUserId: () => Promise<string | null>;
    resolveContext: (options: {
        assertedLocationId?: string | null;
        requestHeaders: Headers;
        userId: string;
    }) => Promise<PublicSiteContextResult>;
    createUploadUrl: (options: {
        requireSignedURLs: boolean;
        metadata: Record<string, unknown>;
    }) => Promise<unknown>;
};

function failureStatus(reason: string) {
    if (reason === "unauthenticated") return 401;
    if (reason === "unknown_domain") return 404;
    if (reason === "domain_unavailable") return 503;
    return 403;
}

export async function handlePublicImageDirectUpload(
    request: Request,
    dependencies: PublicImageUploadDependencies,
): Promise<Response> {
    const userId = await dependencies.getUserId();
    if (!userId) return new Response("Unauthorized", { status: 401 });

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return new Response("Invalid request body", { status: 400 });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
        return new Response("Invalid request body", { status: 400 });
    }

    const input = body as { locationId?: unknown; metadata?: unknown };
    if (input.locationId !== undefined &&
        (typeof input.locationId !== "string" || !input.locationId.trim())) {
        return new Response("Invalid locationId", { status: 400 });
    }

    const contextResult = await dependencies.resolveContext({
        assertedLocationId: input.locationId,
        requestHeaders: request.headers,
        userId,
    });
    if (!contextResult.ok || !contextResult.context.contact) {
        const reason = contextResult.ok ? "contact_not_found" : contextResult.reason;
        return new Response("Upload not authorized for this site", { status: failureStatus(reason) });
    }

    const callerMetadata = input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata)
        ? input.metadata as Record<string, unknown>
        : {};
    const result = await dependencies.createUploadUrl({
        requireSignedURLs: false,
        metadata: {
            ...callerMetadata,
            locationId: contextResult.context.locationId,
            uploadedBy: userId,
            source: "public-submission",
        },
    });

    return Response.json(result);
}
