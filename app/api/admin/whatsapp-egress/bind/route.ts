import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import db from "@/lib/db";
import { getLocationContext } from "@/lib/auth/location-context";
import { buildWhatsAppWebBridgeSessionId, stopWhatsAppWebBridgeSession } from "@/lib/whatsapp/web-bridge";
import { assignDeviceTunnelBindingToGateway } from "@/lib/device-tunnel/assignment";
import { isDistributedDeviceTunnelPlacementEnabled } from "@/lib/device-tunnel/distributed-placement";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const location = await getLocationContext();
    if (!location) return NextResponse.json({ error: "No location" }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    const deviceId = String(body?.deviceId || "").trim();
    if (!deviceId) return NextResponse.json({ error: "Missing deviceId" }, { status: 400 });

    const device = await (db as any).smsRelayDevice.findFirst({
        where: {
            id: deviceId,
            locationId: location.id,
            paired: true,
            tunnelRevokedAt: null,
            capabilities: { has: "whatsapp_egress" },
        },
    });
    if (!device?.tunnelPublicKey) {
        return NextResponse.json({ error: "Device has not enrolled a tunnel key" }, { status: 409 });
    }

    const currentSession = await (db as any).whatsAppWebBridgeSession.findUnique({ where: { locationId: location.id } });
    if (currentSession && !["disconnected", "failed"].includes(String(currentSession.status || ""))) {
        await stopWhatsAppWebBridgeSession(location.id);
    }

    const bridgeSession = await (db as any).whatsAppWebBridgeSession.upsert({
        where: { locationId: location.id },
        create: {
            locationId: location.id,
            sessionId: buildWhatsAppWebBridgeSessionId(location.id),
            status: "disconnected",
            isDefaultOutbound: true,
            egressMode: "device_tunnel",
        },
        update: { egressMode: "device_tunnel" },
    });

    const distributedPlacement = isDistributedDeviceTunnelPlacementEnabled();
    let binding = await db.$transaction(async (tx: any) => {
        await tx.deviceTunnelBinding.deleteMany({
            where: {
                OR: [
                    { deviceId, sessionId: { not: bridgeSession.id } },
                    { sessionId: bridgeSession.id, deviceId: { not: deviceId } },
                ],
            },
        });
        return tx.deviceTunnelBinding.upsert({
            where: { sessionId: bridgeSession.id },
            create: {
                locationId: location.id,
                deviceId,
                sessionId: bridgeSession.id,
                status: "offline",
            },
            update: {
                deviceId,
                status: "offline",
                networkType: null,
                ...(!distributedPlacement ? { gatewayNodeId: null } : {}),
                egressIpMasked: null,
                lastConnectedAt: null,
                lastSeenAt: null,
                lastTrafficAt: null,
                lastVerifiedAt: null,
                lastProofMessageHash: null,
                lastProofBytesToDevice: null,
                lastProofBytesFromDevice: null,
                lastError: null,
            },
        });
    });

    if (distributedPlacement) {
        try {
            binding = await assignDeviceTunnelBindingToGateway({
                db: db as any,
                bindingId: binding.id,
                region: String(process.env.DEVICE_TUNNEL_GATEWAY_REGION || "").trim() || null,
            }) as any;
        } catch (error: any) {
            console.warn("[Device Tunnel] WhatsApp egress binding has no eligible gateway", {
                locationId: location.id,
                bindingId: binding.id,
                reason: error?.message || "assignment_failed",
            });
            return NextResponse.json({ error: "No healthy device tunnel gateway is available" }, { status: 503 });
        }
    }

    console.info("[Device Tunnel] WhatsApp egress binding changed", {
        actorUserId: userId,
        locationId: location.id,
        deviceId,
        bindingId: binding.id,
    });
    return NextResponse.json({ success: true, binding });
}

export async function DELETE() {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const location = await getLocationContext();
    if (!location) return NextResponse.json({ error: "No location" }, { status: 404 });

    const session = await (db as any).whatsAppWebBridgeSession.findUnique({ where: { locationId: location.id } });
    if (session) {
        if (!["disconnected", "failed"].includes(String(session.status || ""))) {
            await stopWhatsAppWebBridgeSession(location.id);
        }
        await db.$transaction([
            (db as any).deviceTunnelBinding.deleteMany({ where: { sessionId: session.id } }),
            (db as any).whatsAppWebBridgeSession.update({
                where: { id: session.id },
                data: { egressMode: "server", status: "disconnected" },
            }),
        ]);
    }
    return NextResponse.json({ success: true });
}
