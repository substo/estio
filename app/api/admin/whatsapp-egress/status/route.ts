import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import db from "@/lib/db";
import { getLocationContext } from "@/lib/auth/location-context";

export const dynamic = "force-dynamic";

export async function GET() {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const location = await getLocationContext();
    if (!location) return NextResponse.json({ error: "No location" }, { status: 404 });

    const session = await (db as any).whatsAppWebBridgeSession.findUnique({
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
                            capabilities: true,
                            appVersion: true,
                            lastSeenAt: true,
                            tunnelRevokedAt: true,
                        },
                    },
                },
            },
        },
    });
    const binding = session?.tunnelBinding || null;
    const fresh = Boolean(binding?.lastSeenAt && Date.now() - new Date(binding.lastSeenAt).getTime() < 45_000);
    const proof = binding?.lastVerifiedAt ? {
        verifiedAt: binding.lastVerifiedAt,
        trafficAt: binding.lastTrafficAt,
        messageHash: binding.lastProofMessageHash,
        bytesToDevice: binding.lastProofBytesToDevice?.toString() || "0",
        bytesFromDevice: binding.lastProofBytesFromDevice?.toString() || "0",
        egressIpMasked: binding.egressIpMasked,
        networkType: binding.networkType,
        gatewayNodeId: binding.gatewayNodeId,
    } : null;
    const serializableBinding = binding ? {
        ...binding,
        lastProofBytesToDevice: binding.lastProofBytesToDevice?.toString() || null,
        lastProofBytesFromDevice: binding.lastProofBytesFromDevice?.toString() || null,
    } : null;
    return NextResponse.json({
        egressMode: session?.egressMode || "server",
        browserStatus: session?.status || "disconnected",
        tunnelStatus: binding?.status === "online" && fresh ? "online" : binding ? "offline" : "unbound",
        binding: serializableBinding,
        proof,
    });
}
