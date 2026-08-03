import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import db from "@/lib/db";
import { getLocationContext } from "@/lib/auth/location-context";
import { verifyUserHasAccessToLocation, verifyUserIsLocationAdmin } from "@/lib/auth/permissions";
import {
    acceptCodexDeviceAuthAsPersonal,
    cancelCodexDeviceAuth,
    disconnectCodexConnection,
    readCodexDeviceAuth,
    startCodexDeviceAuth,
    type CodexConnectionScope,
} from "@/lib/ai/codex-device-auth";
import { SETTINGS_DOMAINS } from "@/lib/settings/constants";
import { settingsService } from "@/lib/settings/service";
import { canManageChatGptConnection } from "@/lib/ai/integration-access-policy";

async function resolveContext(scope: CodexConnectionScope) {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) throw new Error("Unauthorized");
    const location = await getLocationContext();
    const isMember = Boolean(location?.id) && await verifyUserHasAccessToLocation(clerkUserId, location!.id);
    const isAdmin = isMember && scope === "LOCATION"
        ? await verifyUserIsLocationAdmin(clerkUserId, location!.id)
        : false;
    if (!location?.id || !canManageChatGptConnection({
        scope,
        isActiveLocationMember: isMember,
        isActiveLocationAdmin: isAdmin,
        isCurrentUserScope: true,
    })) {
        throw new Error("Unauthorized");
    }
    const user = await db.user.findUnique({ where: { clerkId: clerkUserId }, select: { id: true } });
    if (!user?.id) throw new Error("User not found.");
    return { clerkUserId, userId: user.id, locationId: location.id };
}

function parseScope(value: unknown): CodexConnectionScope {
    return String(value || "").toUpperCase() === "LOCATION" ? "LOCATION" : "USER";
}

export async function GET(request: Request) {
    try {
        const url = new URL(request.url);
        const scope = parseScope(url.searchParams.get("scope"));
        const context = await resolveContext(scope);
        const attempt = readCodexDeviceAuth(url.searchParams.get("attemptId") || "", context.userId, context.locationId, scope);
        if (!attempt || attempt.scope !== scope) {
            return NextResponse.json({ success: false, error: "Sign-in attempt not found." }, { status: 404 });
        }
        return NextResponse.json({ success: true, attempt });
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error?.message || "Could not read sign-in status." }, { status: 401 });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => ({}));
        const scope = parseScope(body.scope);
        const operation = String(body.operation || "start").trim();
        const context = await resolveContext(scope);

        if (operation === "start") {
            const attempt = await startCodexDeviceAuth({
                actorClerkUserId: context.clerkUserId,
                actorUserId: context.userId,
                locationId: context.locationId,
                scope,
            });
            return NextResponse.json({ success: true, attempt });
        }
        if (operation === "cancel") {
            const cancelled = await cancelCodexDeviceAuth(String(body.attemptId || ""), context.userId, context.locationId, scope);
            return NextResponse.json({ success: cancelled });
        }
        if (operation === "save_personal" && scope === "LOCATION") {
            const attempt = await acceptCodexDeviceAuthAsPersonal({
                attemptId: String(body.attemptId || ""),
                actorUserId: context.userId,
                locationId: context.locationId,
            });
            if (!attempt) {
                return NextResponse.json({ success: false, error: "This personal sign-in offer expired or was already used." }, { status: 409 });
            }
            return NextResponse.json({ success: attempt.state === "connected", attempt }, { status: attempt.state === "connected" ? 200 : 409 });
        }
        if (operation === "preference" && scope === "USER") {
            const existing = await settingsService.getDocument<any>({
                scopeType: "USER",
                scopeId: context.userId,
                domain: SETTINGS_DOMAINS.USER_CHATGPT_SUBSCRIPTION_INTEGRATIONS,
            }).catch(() => null);
            await settingsService.upsertDocument({
                scopeType: "USER",
                scopeId: context.userId,
                domain: SETTINGS_DOMAINS.USER_CHATGPT_SUBSCRIPTION_INTEGRATIONS,
                payload: { ...(existing?.payload || {}), preferMyConnection: body.enabled === true },
                actorUserId: context.userId,
                expectedVersion: existing?.version ?? 0,
                schemaVersion: 1,
            });
            return NextResponse.json({ success: true });
        }
        if (operation === "disconnect") {
            await disconnectCodexConnection({
                actorUserId: context.userId,
                locationId: context.locationId,
                scope,
            });
            return NextResponse.json({ success: true, message: "Connection removed from Estio. Your ChatGPT account was not deleted." });
        }
        return NextResponse.json({ success: false, error: "Unsupported operation." }, { status: 400 });
    } catch (error: any) {
        const message = error?.message || "ChatGPT connection operation failed.";
        return NextResponse.json({ success: false, error: message }, { status: message === "Unauthorized" ? 401 : 400 });
    }
}
