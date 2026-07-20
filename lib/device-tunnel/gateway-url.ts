import { isIP } from "node:net";

export const DEVICE_TUNNEL_GATEWAY_PATH = "/device-tunnel";
export const DEVICE_TUNNEL_ANDROID_HOST_SUFFIX = "estio.co";
export const DEVICE_TUNNEL_TRUSTED_HOST_SUFFIXES_ENV = "DEVICE_TUNNEL_TRUSTED_HOST_SUFFIXES";

export function parseDeviceTunnelGatewayHostSuffixes(value: string | undefined) {
    const suffixes = String(value || "")
        .split(",")
        .map((entry) => entry.trim().toLowerCase().replace(/^\.+|\.+$/g, ""))
        .filter(Boolean);
    if (suffixes.some((suffix) => isIP(suffix) !== 0 || !/^[a-z0-9.-]+$/.test(suffix))) {
        throw new Error("Device tunnel trusted host suffixes are invalid");
    }
    return Array.from(new Set(suffixes));
}

export function isDeviceTunnelAndroidTrustedHostname(hostname: string) {
    const normalized = String(hostname || "").toLowerCase().replace(/\.$/, "");
    return normalized === DEVICE_TUNNEL_ANDROID_HOST_SUFFIX
        || normalized.endsWith(`.${DEVICE_TUNNEL_ANDROID_HOST_SUFFIX}`);
}

function hostMatchesSuffix(hostname: string, suffix: string) {
    return hostname === suffix || hostname.endsWith(`.${suffix}`);
}

export function validateDeviceTunnelGatewayUrl(value: string, production = process.env.NODE_ENV === "production") {
    const raw = String(value || "").trim();
    if (!raw) throw new Error("Device tunnel gateway URL is missing");

    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        throw new Error("Device tunnel gateway URL is invalid");
    }
    const allowedProtocols = production ? new Set(["wss:"]) : new Set(["ws:", "wss:"]);
    if (!allowedProtocols.has(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash) {
        throw new Error("Device tunnel gateway URL is not an allowed WebSocket endpoint");
    }
    return url.toString().replace(/\/$/, "");
}

export function validateTrustedDeviceTunnelGatewayUrl(args: {
    value: string;
    production?: boolean;
    trustedHostSuffixes: string[];
    expectedPath?: string;
}) {
    const canonical = validateDeviceTunnelGatewayUrl(args.value, args.production ?? true);
    const url = new URL(canonical);
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    const suffixes = args.trustedHostSuffixes.map((entry) => entry.toLowerCase().replace(/^\.+|\.+$/g, ""));
    const expectedPath = args.expectedPath || DEVICE_TUNNEL_GATEWAY_PATH;
    if (!suffixes.length) throw new Error("Device tunnel trusted host suffixes are not configured");
    if (isIP(hostname) !== 0 || !suffixes.some((suffix) => hostMatchesSuffix(hostname, suffix))) {
        throw new Error("Device tunnel gateway hostname is outside the trusted suffixes");
    }
    if (url.port && url.port !== "443") throw new Error("Device tunnel gateway URL uses an unexpected port");
    if (url.pathname !== expectedPath) throw new Error("Device tunnel gateway URL uses an unexpected endpoint");
    return canonical;
}
