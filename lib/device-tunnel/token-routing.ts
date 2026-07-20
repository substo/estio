import { validateDeviceTunnelGatewayUrl } from "./gateway-url";

export function resolveDeviceTunnelTokenRouting(args: {
    distributedPlacement: boolean;
    binding: {
        gatewayNodeId?: string | null;
        gatewayNode?: { publicUrl?: string | null } | null;
    };
    env?: NodeJS.ProcessEnv;
    productionUrls?: boolean;
}) {
    const env = args.env || process.env;
    const nodeId = args.distributedPlacement
        ? String(args.binding.gatewayNodeId || "").trim()
        : String(env.DEVICE_TUNNEL_GATEWAY_NODE_ID || "device-tunnel-gateway-single").trim();
    if (!nodeId) throw new Error("Device tunnel gateway node ID is not configured");
    const rawGatewayUrl = args.distributedPlacement
        ? String(args.binding.gatewayNode?.publicUrl || "")
        : String(env.DEVICE_TUNNEL_PUBLIC_URL || "").trim();
    return {
        nodeId,
        gatewayUrl: validateDeviceTunnelGatewayUrl(rawGatewayUrl, args.productionUrls),
    };
}
