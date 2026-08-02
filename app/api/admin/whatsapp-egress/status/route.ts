import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import db from "@/lib/db";
import { getLocationContext } from "@/lib/auth/location-context";
import { getWhatsAppWebBridgeHealth } from "@/lib/whatsapp/web-bridge";
import { redactOperationalIdentifier } from "@/lib/device-tunnel/operational-redaction";
import { verifyUserIsLocationAdmin } from "@/lib/auth/permissions";

export const dynamic = "force-dynamic";

export async function GET() {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const location = await getLocationContext();
    if (!location) return NextResponse.json({ error: "No location" }, { status: 404 });
    if (!await verifyUserIsLocationAdmin(userId, location.id)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const [session, bridgeHealth] = await Promise.all([
        (db as any).whatsAppWebBridgeSession.findUnique({
            where: { locationId: location.id },
            include: {
                tunnelBinding: {
                    include: {
                        device: {
                            select: {
                                id: true,
                                label: true,
                                platform: true,
                                status: true,
                                paired: true,
                                capabilities: true,
                                appVersion: true,
                                lastSeenAt: true,
                                tunnelRevokedAt: true,
                            },
                        },
                    },
                },
                authPlacement: {
                    select: {
                        state: true,
                    },
                },
            },
        }),
        getWhatsAppWebBridgeHealth().catch(() => null),
    ]);
    const rawBinding = session?.tunnelBinding || null;
    const binding = rawBinding
        && rawBinding.status !== "revoked"
        && rawBinding.desiredState !== "disabled"
        && rawBinding.device.paired
        && !rawBinding.device.tunnelRevokedAt
        ? rawBinding
        : null;
    const sessionRef = redactOperationalIdentifier(session?.sessionId, "session");
    const locationRef = redactOperationalIdentifier(location.id, "location");
    const workerSession = (bridgeHealth?.sessions || []).find((candidate: any) =>
        candidate?.sessionId === session?.sessionId
        || candidate?.locationId === location.id
        || candidate?.sessionRef === sessionRef
        || candidate?.locationRef === locationRef
    );
    const fresh = Boolean(binding?.lastSeenAt && Date.now() - new Date(binding.lastSeenAt).getTime() < 45_000);
    const proof = binding?.lastVerifiedAt ? {
        verifiedAt: binding.lastVerifiedAt,
        networkType: binding.networkType,
    } : null;
    const serializableBinding = binding ? {
        device: {
            id: binding.device.id,
            label: binding.device.label,
            platform: binding.device.platform,
            appVersion: binding.device.appVersion,
            lastSeenAt: binding.device.lastSeenAt,
        },
        networkType: binding.networkType,
        lastConnectedAt: binding.lastConnectedAt,
        lastVerifiedAt: binding.lastVerifiedAt,
        lastSeenAt: binding.lastSeenAt,
        reconnectGeneration: binding.reconnectGeneration,
        lastReconnectRequestedAt: binding.lastReconnectRequestedAt,
        lastReconnectAttemptedAt: binding.lastReconnectAttemptedAt,
        lastReconnectErrorCode: binding.lastReconnectErrorCode,
        lastDeviceRuntimeState: binding.lastDeviceRuntimeState,
        batteryOptimizationIgnored: binding.batteryOptimizationIgnored,
    } : null;
    return NextResponse.json({
        egressMode: session?.egressMode || "server",
        browserStatus: workerSession?.ready
            ? "ready"
            : workerSession?.status || session?.status || "disconnected",
        tunnelStatus: binding?.status === "online" && fresh ? "online" : binding ? "offline" : "unbound",
        binding: serializableBinding,
        proof,
        protectedSession: {
            enabled: workerSession?.sessionAuthMode === "encrypted_snapshot"
                && workerSession?.runtimeLeaseEnforced === true,
            ready: workerSession?.authDurableReady === true
                && workerSession?.authState === "attached",
            state: workerSession?.authState || session?.authPlacement?.state || "unavailable",
        },
    });
}
