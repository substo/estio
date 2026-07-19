import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { extractDeviceFromAuthHeader, hashDeviceToken } from "@/lib/sms-relay/auth";
import {
    generateTunnelChallenge,
    hashTunnelChallenge,
    issueDeviceTunnelToken,
    verifyTunnelChallengeSignature,
} from "@/lib/device-tunnel/auth";

export const dynamic = "force-dynamic";

function getBearerToken(authHeader: string | null) {
    return String(authHeader || "").replace(/^Bearer\s+/i, "").trim();
}

export async function POST(req: NextRequest) {
    const authHeader = req.headers.get("authorization");
    const payload = extractDeviceFromAuthHeader(authHeader);
    const rawDeviceToken = getBearerToken(authHeader);
    if (!payload || !rawDeviceToken) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "challenge").trim();
    const device = await (db as any).smsRelayDevice.findFirst({
        where: {
            id: payload.deviceId,
            locationId: payload.locationId,
            paired: true,
            deviceApiTokenHash: hashDeviceToken(rawDeviceToken),
            tunnelRevokedAt: null,
            capabilities: { has: "whatsapp_egress" },
        },
        include: { tunnelBinding: true },
    });
    if (!device?.tunnelPublicKey || !device?.tunnelBinding) {
        return NextResponse.json({ error: "Device is not bound for WhatsApp egress" }, { status: 403 });
    }

    if (action === "challenge") {
        const challenge = generateTunnelChallenge();
        await (db as any).smsRelayDevice.update({
            where: { id: device.id },
            data: {
                tunnelChallengeHash: challenge.challengeHash,
                tunnelChallengeExpiresAt: challenge.expiresAt,
            },
        });
        return NextResponse.json({
            challenge: challenge.challenge,
            expiresAt: challenge.expiresAt.toISOString(),
            credentialVersion: device.tunnelCredentialVersion,
        });
    }

    if (action !== "exchange") {
        return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
    }

    const challenge = String(body?.challenge || "").trim();
    const signature = String(body?.signature || "").trim();
    if (!challenge || !signature) {
        return NextResponse.json({ error: "Missing challenge or signature" }, { status: 400 });
    }
    if (
        device.tunnelChallengeHash !== hashTunnelChallenge(challenge)
        || !device.tunnelChallengeExpiresAt
        || new Date(device.tunnelChallengeExpiresAt).getTime() <= Date.now()
    ) {
        return NextResponse.json({ error: "Challenge is invalid or expired" }, { status: 401 });
    }
    if (!verifyTunnelChallengeSignature({
        publicKeyBase64: device.tunnelPublicKey,
        challenge,
        signatureBase64: signature,
    })) {
        return NextResponse.json({ error: "Invalid device signature" }, { status: 401 });
    }

    const claimed = await (db as any).smsRelayDevice.updateMany({
        where: {
            id: device.id,
            tunnelChallengeHash: device.tunnelChallengeHash,
            tunnelChallengeExpiresAt: { gt: new Date() },
            tunnelRevokedAt: null,
        },
        data: { tunnelChallengeHash: null, tunnelChallengeExpiresAt: null },
    });
    if (!Number(claimed?.count || 0)) {
        return NextResponse.json({ error: "Challenge was already used" }, { status: 409 });
    }

    const token = issueDeviceTunnelToken({
        deviceId: device.id,
        locationId: device.locationId,
        bindingId: device.tunnelBinding.id,
        credentialVersion: Number(device.tunnelCredentialVersion || 1),
    });
    const gatewayUrl = String(process.env.DEVICE_TUNNEL_PUBLIC_URL || "").trim();
    const validGatewayScheme = process.env.NODE_ENV === "production"
        ? gatewayUrl.startsWith("wss://")
        : /^wss?:\/\//.test(gatewayUrl);
    if (!gatewayUrl || !validGatewayScheme) {
        return NextResponse.json({ error: "Device tunnel gateway is not configured" }, { status: 503 });
    }

    return NextResponse.json({
        tunnelToken: token,
        gatewayUrl,
        expiresInSeconds: 15 * 60,
        bindingId: device.tunnelBinding.id,
    });
}
