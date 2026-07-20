import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import db from "@/lib/db";
import { getLocationContext } from "@/lib/auth/location-context";
import { buildWhatsAppWebBridgeSessionId, stopWhatsAppWebBridgeSession } from "@/lib/whatsapp/web-bridge";
import { assignDeviceTunnelBindingToGateway } from "@/lib/device-tunnel/assignment";
import { resolveDeviceTunnelCanary } from "@/lib/device-tunnel/canary-control";
import { redactOperationalIdentifier } from "@/lib/device-tunnel/operational-redaction";

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
                gatewayNodeId: null,
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

    let canary;
    try {
        canary = resolveDeviceTunnelCanary({
            locationId: location.id,
            sessionId: bridgeSession.id,
            bindingId: binding.id,
        });
    } catch {
        return NextResponse.json({ error: "Device tunnel canary configuration is invalid" }, { status: 503 });
    }
    if (canary.selected && !canary.active) {
        return NextResponse.json({ error: "Device tunnel canary prerequisites are incomplete" }, { status: 503 });
    }

    if (canary.active) {
        try {
            binding = await assignDeviceTunnelBindingToGateway({
                db: db as any,
                bindingId: binding.id,
                region: String(process.env.DEVICE_TUNNEL_GATEWAY_REGION || "").trim() || null,
                requiredNodeId: canary.scope.gatewayNodeId,
            }) as any;
            if (binding.gatewayNode?.publicUrl !== canary.scope.gatewayUrl) {
                throw new Error("Canary gateway URL does not match the registered node URL");
            }
        } catch (error: any) {
            console.warn("[Device Tunnel] WhatsApp egress binding has no eligible gateway", {
                locationRef: redactOperationalIdentifier(location.id, "location"),
                bindingRef: redactOperationalIdentifier(binding.id, "binding"),
                reason: "assignment_failed",
            });
            return NextResponse.json({ error: "No healthy device tunnel gateway is available" }, { status: 503 });
        }
    }

    console.info("[Device Tunnel] WhatsApp egress binding changed", {
        actorRef: redactOperationalIdentifier(userId, "actor"),
        locationRef: redactOperationalIdentifier(location.id, "location"),
        deviceRef: redactOperationalIdentifier(deviceId, "device"),
        bindingRef: redactOperationalIdentifier(binding.id, "binding"),
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
                data: { egressMode: "device_tunnel", status: "disconnected" },
            }),
        ]);
    }
    return NextResponse.json({ success: true });
}
