import { auth } from "@clerk/nextjs/server";
import db from "@/lib/db";
import { verifyUserHasAccessToLocation, verifyUserIsLocationAdmin } from "@/lib/auth/permissions";
import { verifyViewingSessionAccessToken } from "@/lib/viewings/sessions/security";

export type ViewingSessionRequestRole = "client" | "agent" | "admin";

export type ViewingSessionRequestContext = {
    sessionId: string;
    locationId: string;
    role: ViewingSessionRequestRole;
    clerkUserId: string | null;
    isAdmin: boolean;
};

function readBearerToken(request: Request): string | null {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.toLowerCase().startsWith("bearer ")) return null;
    const token = authHeader.slice("bearer ".length).trim();
    return token || null;
}

async function resolveContextFromSessionToken(args: {
    request: Request;
    expectedSessionId?: string | null;
    allowClientToken?: boolean;
    allowAgentToken?: boolean;
    tokenOverride?: string | null;
}): Promise<ViewingSessionRequestContext | null> {
    const bearer = String(args.tokenOverride || "").trim() || readBearerToken(args.request);
    if (!bearer) return null;

    try {
        const payload = verifyViewingSessionAccessToken(bearer);
        if (!payload?.sessionId || !payload?.locationId) return null;
        if (args.expectedSessionId && payload.sessionId !== args.expectedSessionId) return null;

        if (payload.role === "client" && args.allowClientToken === false) return null;
        if (payload.role === "agent" && args.allowAgentToken === false) return null;

        const session = await db.viewingSession.findUnique({
            where: { id: payload.sessionId },
            select: {
                id: true,
                locationId: true,
                tokenExpiresAt: true,
            },
        });
        if (!session) return null;
        if (session.locationId !== payload.locationId) return null;
        if (session.tokenExpiresAt.getTime() <= Date.now()) return null;

        return {
            sessionId: session.id,
            locationId: session.locationId,
            role: payload.role,
            clerkUserId: null,
            isAdmin: false,
        };
    } catch {
        return null;
    }
}

export async function resolveViewingSessionRequestContext(args: {
    request: Request;
    sessionId: string;
    requireAdmin?: boolean;
    allowClientToken?: boolean;
    allowAgentToken?: boolean;
    tokenOverride?: string | null;
}): Promise<ViewingSessionRequestContext | null> {
    const sessionId = String(args.sessionId || "").trim();
    if (!sessionId) return null;

    const tokenContext = await resolveContextFromSessionToken({
        request: args.request,
        expectedSessionId: sessionId,
        allowClientToken: args.allowClientToken !== false,
        allowAgentToken: args.allowAgentToken !== false,
        tokenOverride: args.tokenOverride,
    });

    if (tokenContext && !args.requireAdmin) {
        return tokenContext;
    }

    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) return null;

    const session = await db.viewingSession.findUnique({
        where: { id: sessionId },
        select: {
            id: true,
            locationId: true,
        },
    });
    if (!session) return null;

    const hasAccess = args.requireAdmin
        ? await verifyUserIsLocationAdmin(clerkUserId, session.locationId)
        : await verifyUserHasAccessToLocation(clerkUserId, session.locationId);

    if (!hasAccess) return null;

    return {
        sessionId: session.id,
        locationId: session.locationId,
        role: "admin",
        clerkUserId,
        isAdmin: true,
    };
}
