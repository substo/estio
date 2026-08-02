import { randomUUID } from "crypto";
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import db from "@/lib/db";
import { createOAuth2Client } from "@/lib/google/auth";
import { disconnectGoogleLocally } from "@/lib/google/disconnect";
import { SETTINGS_DOMAINS, SETTINGS_SECRET_KEYS } from "@/lib/settings/constants";
import { settingsService } from "@/lib/settings/service";

async function readRevocationToken(user: {
    id: string;
    googleAccessToken: string | null;
    googleRefreshToken: string | null;
}) {
    const [accessToken, refreshToken] = await Promise.all([
        settingsService.getSecret({
            scopeType: "USER",
            scopeId: user.id,
            domain: SETTINGS_DOMAINS.USER_GOOGLE_INTEGRATIONS,
            secretKey: SETTINGS_SECRET_KEYS.GOOGLE_ACCESS_TOKEN,
        }),
        settingsService.getSecret({
            scopeType: "USER",
            scopeId: user.id,
            domain: SETTINGS_DOMAINS.USER_GOOGLE_INTEGRATIONS,
            secretKey: SETTINGS_SECRET_KEYS.GOOGLE_REFRESH_TOKEN,
        }),
    ]);

    return refreshToken || accessToken || user.googleRefreshToken || user.googleAccessToken || null;
}

export async function POST() {
    const requestId = randomUUID();
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const user = await db.user.findUnique({
        where: { clerkId: clerkUserId },
        select: { id: true, googleAccessToken: true, googleRefreshToken: true },
    });
    if (!user) {
        return NextResponse.json({ success: false, error: "User not found" }, { status: 404 });
    }

    let revocationToken: string | null = null;
    let tokenReadFailed = false;
    try {
        revocationToken = await readRevocationToken(user);
    } catch (error) {
        tokenReadFailed = true;
        console.error("[Google disconnect] Could not read token before local disconnect", {
            requestId,
            userId: user.id,
            error,
        });
    }

    try {
        await db.$transaction((tx) => disconnectGoogleLocally(tx, {
            userId: user.id,
            requestId,
        }));
    } catch (error) {
        console.error("[Google disconnect] Local transaction failed", {
            requestId,
            userId: user.id,
            error,
        });
        return NextResponse.json(
            { success: false, error: "Google could not be disconnected. No local changes were completed." },
            { status: 500 }
        );
    }

    let externalWarning: string | null = tokenReadFailed
        ? "Local Google access was removed, but remote token revocation needs attention."
        : null;
    if (revocationToken) {
        try {
            await createOAuth2Client().revokeToken(revocationToken);
        } catch (error) {
            console.error("[Google disconnect] Remote token revocation failed after local commit", {
                requestId,
                userId: user.id,
                error,
            });
            externalWarning = "Local Google access was removed, but remote token revocation needs attention.";
        }
    }

    return NextResponse.json({ success: true, externalWarning });
}
